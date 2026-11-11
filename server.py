#!/usr/bin/env python3
"""办公室服务器：静态页面 + 事件中继。

  Grok Bot --POST /api/events--> 本服务器（校验）--SSE /api/events/stream--> 浏览器

只用 Python 标准库。默认监听 127.0.0.1。
Mac mini 历史用法：python3 server.py --host 0.0.0.0 --port 8787
若设置 OFFICE_TOKEN，API 读写均需认证；浏览器可用口令换取只读会话。
不要把 token 写进仓库或聊天。
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import threading
import time
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie, CookieError
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from integration import connection_info
from task_state import TaskStore, TaskConflict, PHASES, SOURCES

ROOT = Path(__file__).resolve().parent
STATE_PATH = ROOT / "data" / "office-state.json"

# 必须和 src/config.js 的 STATES 一致（tests/test_server.py 会检查）
STATES = ("coding", "browsing", "terminal", "needsYou", "thinking", "error", "idle")
EVENT_TYPES = ("status", "handoff", "sync", "task", "heartbeat")
MAX_BODY = 16 * 1024
MAX_TEXT = 200
MAX_RECENT = 80


def _extract_bracket(src: str, start: int, open_ch="[", close_ch="]") -> str:
    i = src.index(open_ch, start)
    depth = 0
    for j in range(i, len(src)):
        ch = src[j]
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return src[i : j + 1]
    raise ValueError("unbalanced brackets")


def _str_field(block: str, key: str, default=""):
    m = re.search(rf"\b{key}:\s*'([^']*)'", block)
    return m.group(1) if m else default


def _list_strs(block: str, key: str) -> list[str]:
    m = re.search(rf"\b{key}:\s*\[(.*?)\]", block, flags=re.S)
    if not m:
        return []
    return re.findall(r"'([^']*)'", m.group(1))


def _top_objects(array_src: str) -> list[str]:
    inner = array_src.strip()
    if inner.startswith("["):
        inner = inner[1:-1]
    objs = []
    depth = 0
    start = None
    for i, ch in enumerate(inner):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objs.append(inner[start : i + 1])
                start = None
    return objs


def load_office(config_path=ROOT / "src" / "config.js"):
    """从 config.js 读出办公室名单。bot 名单只有这一处来源。"""
    src = Path(config_path).read_text(encoding="utf-8")
    owner_m = re.search(r"owner:\s*'([^']+)'", src)
    title_m = re.search(r"title:\s*'([^']+)'", src)
    stale_m = re.search(r"staleAfterSec:\s*(\d+)", src)
    off_m = re.search(r"offlineAfterSec:\s*(\d+)", src)

    agents_start = src.index("export const AGENTS")
    agents_arr = _extract_bracket(src, agents_start)
    agents = []
    roster = {}
    aliases = {}
    for block in _top_objects(agents_arr):
        aid = _str_field(block, "id")
        name = _str_field(block, "name")
        if not aid or not name:
            continue
        item = {
            "id": aid,
            "name": name,
            "role": _str_field(block, "role"),
            "kind": _str_field(block, "kind", "resident"),
            "contact": _str_field(block, "contact", "expected"),
            "color": _str_field(block, "color"),
            "aliases": _list_strs(block, "aliases"),
        }
        agents.append(item)
        roster[aid] = name
        for al in item["aliases"]:
            aliases[al.lower()] = aid
        aliases[aid] = aid
        aliases[name.lower()] = aid

    retired = []
    if "export const RETIRED" in src:
        retired_arr = _extract_bracket(src, src.index("export const RETIRED"))
        for block in _top_objects(retired_arr):
            rid = _str_field(block, "id")
            if not rid:
                continue
            retired.append(
                {
                    "id": rid,
                    "name": _str_field(block, "name"),
                    "reason": _str_field(block, "reason"),
                }
            )

    return {
        "owner": owner_m.group(1) if owner_m else "YOUNG NAF",
        "title": title_m.group(1) if title_m else "Bot 办公室",
        "freshness": {
            "staleAfterSec": int(stale_m.group(1)) if stale_m else 180,
            "offlineAfterSec": int(off_m.group(1)) if off_m else 900,
        },
        "agents": agents,
        "roster": roster,
        "aliases": aliases,
        "retired": retired,
    }


def load_roster(config_path=ROOT / "src" / "config.js"):
    return load_office(config_path)["roster"]


class EventError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status = status
        self.body = {"error": message, **extra}


class Hub:
    """保存每个 bot 的最新状态，并把事件广播给所有已连接的浏览器。"""

    def __init__(self, office, persist=False):
        self.office = office
        self.persist = persist
        self.roster = office["roster"]
        self.aliases = {k.lower(): v for k, v in office["aliases"].items()}
        self.retired = {r["id"].lower(): r for r in office["retired"]}
        for r in office["retired"]:
            if r.get("name"):
                self.retired[r["name"].lower()] = r
        self.last = {}  # agent_id -> 最近一条 status，或只有交接的 presence
        self.last_seen = {}  # agent_id -> unix ts
        self.recent = deque(maxlen=MAX_RECENT)
        self.tasks = TaskStore()
        self.runtime = {}  # independent observations; never claim tracked tasks completed
        self.diagnostics = {}
        self.receipts = {}  # bounded idempotency receipts, persisted with task state
        self.connector = {'state': 'not_configured', 'kind': 'grokbot-gateway', 'lastSuccessAt': None,
                          'message': '尚未配置 Grokbot 主机自动采集；可继续使用 Bot 主动上报。'}
        self.sequence = 0
        self.epoch = secrets.token_hex(16)
        self.subscribers = set()
        self.lock = threading.Lock()
        if persist:
            self._load_state()

    def resolve(self, ref):
        key = str(ref or "").strip().lower()
        if not key:
            return None
        if key in self.aliases:
            return self.aliases[key]
        for agent_id, name in self.roster.items():
            if key == agent_id or key == name.lower():
                return agent_id
        return None

    def retired_hit(self, ref):
        key = str(ref or "").strip().lower()
        return self.retired.get(key)

    def validate(self, payload):
        if not isinstance(payload, dict):
            raise EventError(400, "body must be a JSON object")
        etype = payload.get("type", "status")
        if not isinstance(etype, str) or etype not in EVENT_TYPES:
            raise EventError(422, f"unknown type {etype!r}", types=list(EVENT_TYPES))
        event = {"type": etype, "ts": time.time()}
        if etype == "sync":
            return event

        known = list(self.roster)
        raw_agent = payload.get("agent")
        retired = self.retired_hit(raw_agent)
        if retired:
            raise EventError(
                422,
                f"{retired['id']} 已撤席：{retired['reason']}",
                agents=known,
                retired=True,
            )
        agent = self.resolve(raw_agent)
        if agent is None:
            raise EventError(422, f"unknown agent {raw_agent!r}", agents=known)
        event["agent"] = agent
        source = payload.get('source', 'reporter')
        if not isinstance(source, str) or source not in SOURCES:
            raise EventError(422, 'source must be reporter, external or grokbot-gateway')
        event['source'] = source
        for field in ('eventId', 'taskId', 'nativeId'):
            value = payload.get(field)
            if value is not None:
                if not isinstance(value, str) or not re.fullmatch(r'[\w.:-]{1,128}', value, re.ASCII):
                    raise EventError(422, f'{field} must be a short identifier')
                event[field] = value

        text = payload.get("text", "")
        if not isinstance(text, str) or len(text) > MAX_TEXT:
            raise EventError(422, f"text must be a string up to {MAX_TEXT} characters")
        event["text"] = text.strip()

        state = payload.get("state")
        if etype == 'heartbeat':
            # A heartbeat proves contact, not progress on any task.
            return event
        if etype == 'task':
            phase = payload.get('phase')
            revision = payload.get('revision')
            if (not isinstance(phase, str) or phase not in PHASES or not event.get('taskId') or not event.get('eventId')
                    or type(revision) is not int or not 1 <= revision <= 2**53 - 1):
                raise EventError(422, 'task requires taskId, eventId, phase and positive integer revision')
            if state is not None and (not isinstance(state, str) or state not in STATES):
                raise EventError(422, 'invalid task state')
            if phase in ('started', 'progress') and state in ('idle', 'error', 'needsYou'):
                raise EventError(422, 'use a lifecycle phase for waiting, failure or completion')
            event.update(phase=phase, revision=revision)
            if state is not None:
                event['state'] = state
        elif etype == "status":
            if not isinstance(state, str) or state not in STATES:
                raise EventError(422, f"state must be one of {list(STATES)}", states=list(STATES))
            event["state"] = state
        else:
            raw_to = payload.get("to")
            retired_to = self.retired_hit(raw_to)
            if retired_to:
                raise EventError(
                    422,
                    f"{retired_to['id']} 已撤席：{retired_to['reason']}",
                    agents=known,
                    retired=True,
                )
            target = self.resolve(raw_to)
            if target is None or target == agent:
                raise EventError(422, "'to' must be a different known agent", agents=known)
            event["to"] = target
            if state is not None:
                if not isinstance(state, str) or state not in STATES:
                    raise EventError(422, f"state must be one of {list(STATES)}", states=list(STATES))
                event["state"] = state
        return event

    def publish(self, event):
        with self.lock:
            aid = event.get('agent')
            receipt_key = '\x1f'.join((aid, event['source'], event['eventId'])) if event.get('eventId') else None
            fingerprint = json.dumps({k: v for k, v in event.items() if k != 'ts'}, sort_keys=True, ensure_ascii=False)
            if receipt_key in self.receipts:
                previous = self.receipts[receipt_key]
                if previous['fingerprint'] != fingerprint:
                    raise EventError(409, 'eventId 已被其他内容使用。')
                return {**previous['event'], 'duplicate': True}
            if event['type'] == 'task':
                try:
                    verdict = self.tasks.check(event)
                except TaskConflict as exc:
                    raise EventError(409, str(exc)) from exc
                if verdict == 'outdated':
                    return {**event, 'ignored': True, 'reason': 'outdated_revision', 'seq': self.sequence}
            old = self.last.get(aid, {})
            if event.get('source') == 'grokbot-gateway' and event['type'] == 'status':
                old = self.runtime.get(aid, {})
            self.sequence += 1
            event.update(seq=self.sequence, epoch=self.epoch, ts=time.time())
            ts = event["ts"]
            if aid:
                diag = self.diagnostics.setdefault(aid, {})
                diag.update(lastAcceptedAt=ts, source=event['source'], nativeId=event.get('nativeId'),
                            acceptedCount=diag.get('acceptedCount', 0) + 1)
                if event['type'] in ('status', 'task'):
                    diag['lastTaskReportAt'] = ts
                if event['type'] == 'heartbeat':
                    diag['lastHeartbeatAt'] = ts
            if event['type'] == 'task':
                self.tasks.apply(event)
                task = self.tasks.items['\x1f'.join((aid, event['source'], event['taskId']))]
                self.last[aid] = {'type': 'status', 'agent': aid, 'state': task['state'], 'text': task['text'],
                                  'source': event['source'], 'ts': ts, 'seen': ts, 'seq': self.sequence, 'epoch': self.epoch}
                self.last_seen[aid] = ts
            if event["type"] == "status":
                if event['source'] == 'grokbot-gateway':
                    self.runtime[aid] = {k: event[k] for k in ('state', 'text', 'ts', 'source')}
                stored = dict(event)
                stored["seen"] = ts
                self.last[event["agent"]] = stored
                self.last_seen[event["agent"]] = ts
            elif event["type"] in ("handoff", "heartbeat"):
                self.last_seen[event["agent"]] = ts
                stored = self.last.setdefault(event["agent"], {
                    "type": "presence", "agent": event["agent"], "ts": ts,
                })
                stored.update(seen=ts, seq=self.sequence, epoch=self.epoch)
            if aid:
                # Older status clients cannot clear a task that has no terminal event.
                stale_after = self.office['freshness']['staleAfterSec']
                task = self.tasks.current(aid, ts, stale_after)
                if task:
                    focus = {'state': task['state'], 'text': task['text'], 'ts': task['updatedAt'], 'source': task['source']}
                    runtime = self.runtime.get(aid)
                    if ts - task['updatedAt'] >= stale_after and runtime and ts - runtime['ts'] < stale_after:
                        # Fresh observation may show real activity without falsely completing an old task.
                        focus = dict(runtime)
                    self.last[aid] = {'type': 'status', 'agent': aid, **focus,
                                      'seen': ts, 'seq': self.sequence, 'epoch': self.epoch}
                event['current'] = self._agent_snapshot_unlocked(aid)
            event['silent'] = event['type'] == 'heartbeat' or (event['type'] == 'status'
                and all(old.get(k) == event.get(k) for k in ('state', 'text', 'source')))
            if not event['silent']:
                self.recent.append({k: v for k, v in event.items() if k != 'current'})
            if receipt_key:
                self.receipts[receipt_key] = {'fingerprint': fingerprint,
                    'event': {k: v for k, v in event.items() if k != 'current'}}
                while len(self.receipts) > 512:
                    del self.receipts[next(iter(self.receipts))]
            self._save_state_unlocked()
            for q in list(self.subscribers):
                try:
                    q.put_nowait(("event", event))
                except queue.Full:
                    # 慢客户端重新拿完整快照，不能留下只发 ping 的假连接。
                    while True:
                        try:
                            q.get_nowait()
                        except queue.Empty:
                            break
                    q.put_nowait(("snapshot", self._office_payload_unlocked()))
            return event

    def _agent_snapshot_unlocked(self, agent_id):
        item = dict(self.last[agent_id])
        item['seen'] = self.last_seen.get(agent_id, item.get('ts'))
        item['epoch'] = self.epoch
        item['tasks'] = self.tasks.for_agent(agent_id)
        item['diagnostic'] = dict(self.diagnostics.get(agent_id, {}))
        item['runtime'] = dict(self.runtime[agent_id]) if agent_id in self.runtime else None
        return item

    def note_rejection(self, payload, status):
        if not isinstance(payload, dict):
            return
        aid = self.resolve(payload.get('agent'))
        if not aid:
            return
        with self.lock:
            diag = self.diagnostics.setdefault(aid, {})
            diag.update(lastRejectedAt=time.time(), lastError=f'HTTP {status}：事件字段或任务顺序不符合协议',
                        rejectedCount=diag.get('rejectedCount', 0) + 1)
            self._save_state_unlocked()
            self._broadcast_snapshot_unlocked()

    def _broadcast_snapshot_unlocked(self):
        packet = self._office_payload_unlocked()
        for q in list(self.subscribers):
            # Diagnostics do not create contact or task events.
            if q.full():
                while not q.empty():
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        break
                q.put_nowait(('snapshot', packet))
            else:
                q.put_nowait(('telemetry', {'diagnostics': packet['diagnostics'], 'connector': packet['connector']}))

    def set_connector(self, **changes):
        with self.lock:
            self.connector.update(changes)
            self._broadcast_snapshot_unlocked()

    def _snapshot_unlocked(self):
        out = []
        for agent_id, ev in self.last.items():
            out.append(self._agent_snapshot_unlocked(agent_id))
        return out

    def snapshot(self):
        with self.lock:
            return self._snapshot_unlocked()

    def office_payload(self):
        with self.lock:
            return self._office_payload_unlocked()

    def _office_payload_unlocked(self):
        return {
            "owner": self.office["owner"],
            "title": self.office["title"],
            "agents": {a["id"]: a["name"] for a in self.office["agents"]},
            "roster": self.office["agents"],
            "states": list(STATES),
            "types": list(EVENT_TYPES),
            "freshness": self.office["freshness"],
            "retired": self.office["retired"],
            "last": self._snapshot_unlocked(),
            "recent": list(self.recent),
            "lastSeen": dict(self.last_seen),
            "serverTime": time.time(),
            "seq": self.sequence,
            "epoch": self.epoch,
            'diagnostics': {k: dict(v) for k, v in self.diagnostics.items()},
            'connector': dict(self.connector),
            'taskProtocol': 1,
        }

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            # 同一临界区内捕获快照并注册订阅，不漏掉中间到达的事件。
            q.put(("snapshot", self._office_payload_unlocked()))
            self.subscribers.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.subscribers.discard(q)

    def _load_state(self):
        if not STATE_PATH.exists():
            return
        try:
            data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(data, dict):
            return
        last = data.get('last') if isinstance(data.get('last'), dict) else {}
        seen = data.get('lastSeen') if isinstance(data.get('lastSeen'), dict) else {}
        recent = data.get('recent') if isinstance(data.get('recent'), list) else []
        self.tasks.restore(data.get('tasks', []), self.roster)
        closed = data.get('closedTasks', [])
        if isinstance(closed, list):
            self.tasks.closed = {key: True for key in closed[-4096:] if isinstance(key, str)}
        for field in ('diagnostics', 'runtime'):
            values = data.get(field, {})
            if isinstance(values, dict):
                setattr(self, field, {k: v for k, v in values.items() if k in self.roster and isinstance(v, dict)})
        receipts = data.get('receipts', {})
        if isinstance(receipts, dict):
            self.receipts = {k: v for k, v in list(receipts.items())[-512:]
                             if isinstance(v, dict) and isinstance(v.get('event'), dict) and isinstance(v.get('fingerprint'), str)}
        for agent_id, ev in last.items():
            if agent_id in self.roster and isinstance(ev, dict):
                self.last[agent_id] = ev
        for agent_id, ts in seen.items():
            if agent_id in self.roster:
                try:
                    self.last_seen[agent_id] = float(ts)
                except (TypeError, ValueError):
                    pass
        for ev in recent[-MAX_RECENT:]:
            if isinstance(ev, dict):
                self.recent.append(ev)
        # 兼容旧版只有 lastSeen、没有 status 的交接记录。
        for agent_id, ts in self.last_seen.items():
            self.last.setdefault(agent_id, {"type": "presence", "agent": agent_id, "ts": ts})
        self.sequence = max(
            [0] + [ev.get("seq", 0) for ev in [*self.last.values(), *self.recent]
                   if isinstance(ev.get("seq", 0), int)]
        )

    def _save_state_unlocked(self):
        if not self.persist:
            return
        try:
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "last": self.last,
                "lastSeen": self.last_seen,
                "recent": list(self.recent),
                'tasks': list(self.tasks.items.values()),
                'closedTasks': list(self.tasks.closed),
                'runtime': self.runtime,
                'diagnostics': self.diagnostics,
                'receipts': self.receipts,
            }
            tmp = STATE_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(STATE_PATH)
        except OSError:
            pass


def make_handler(hub, token):
    session_secret = secrets.token_bytes(32)
    session_lifetime = 12 * 60 * 60
    public_files = {"/", "/index.html", "/style.css"}
    public_files.update(f"/src/{p.name}" for p in (ROOT / "src").glob("*.js"))

    def sign(expiry):
        return hmac.new(session_secret, expiry.encode(), hashlib.sha256).hexdigest()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def log_message(self, fmt, *args):
            if "/api/events/stream" not in str(args[0] if args else ""):
                super().log_message(fmt, *args)

        def bearer_ok(self):
            actual = self.headers.get("Authorization", "").encode()
            return not token or hmac.compare_digest(actual, f"Bearer {token}".encode())

        def read_authorized(self):
            if self.bearer_ok():
                return True
            try:
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                expiry, signature = cookie["office_session"].value.split(".", 1)
                return int(expiry) > time.time() and hmac.compare_digest(signature.encode(), sign(expiry).encode())
            except (CookieError, KeyError, ValueError):
                return False

        def send_head(self):
            # HEAD 和 GET 共用白名单，仓库、数据文件、目录索引都不可下载。
            path = unquote(urlsplit(self.path).path)
            target = ROOT / path.lstrip("/")
            if path not in public_files or target.resolve() != target:
                self.send_error(404, "File not found")
                return None
            return super().send_head()

        def reply(self, status, body, cookie=None):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/session":
                return self.reply(200, {"authenticationRequired": bool(token), "authenticated": self.read_authorized()})
            if path.startswith("/api/") and not self.read_authorized():
                return self.reply(401, {"error": "office authentication required"})
            if path == "/api/integration":
                query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
                refs = query.get("agent")
                agent_id = hub.resolve(refs[0]) if refs and len(refs) == 1 else None
                if refs is not None and agent_id is None:
                    return self.reply(422, {"error": "请选择当前工位名单中的一个 Bot"})
                return self.reply(200, connection_info(ROOT, self.server.server_port, hub.office, bool(token), agent_id))
            if path == "/api/health":
                with hub.lock:
                    nsub = len(hub.subscribers)
                    nlast = len(hub.last)
                return self.reply(
                    200,
                    {
                        "ok": True,
                        "subscribers": nsub,
                        "knownAgents": nlast,
                        "serverTime": time.time(),
                    },
                )
            if path == "/api/agents":
                office = hub.office_payload()
                return self.reply(
                    200,
                    {
                        "agents": office["agents"],
                        "states": office["states"],
                        "types": office["types"],
                        "roster": office["roster"],
                        "freshness": office["freshness"],
                    },
                )
            if path == "/api/office":
                return self.reply(200, hub.office_payload())
            if path == '/api/diagnostics':
                office = hub.office_payload()
                return self.reply(200, {'bots': office['diagnostics'], 'connector': office['connector']})
            if path == "/api/events/stream":
                return self.stream()
            if self.command == "HEAD":
                return super().do_HEAD()
            return super().do_GET()

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/session":
                if not self.bearer_ok():
                    return self.reply(401, {"error": "口令不正确，请重试"})
                expiry = str(int(time.time()) + session_lifetime)
                cookie = f"office_session={expiry}.{sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age={session_lifetime}"
                if self.headers.get("Origin", "").startswith("https://"):
                    cookie += "; Secure"
                return self.reply(200, {"ok": True}, cookie=cookie)
            if path != "/api/events":
                return self.reply(404, {"error": "not found"})
            payload = None
            authenticated = False
            try:
                if not self.bearer_ok():
                    raise EventError(401, "missing or wrong bearer token")
                authenticated = True
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise EventError(400, "bad Content-Length")
                if length <= 0:
                    raise EventError(400, "empty body")
                if length > MAX_BODY:
                    raise EventError(413, f"body larger than {MAX_BODY} bytes")
                try:
                    payload = json.loads(self.rfile.read(length))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    raise EventError(400, "body is not valid JSON")
                event = hub.validate(payload)
                event = hub.publish(event)
            except EventError as e:
                if authenticated:
                    hub.note_rejection(payload, e.status)
                return self.reply(e.status, e.body)
            self.reply(202, {"ok": True, "event": event, "watching": len(hub.subscribers)})

        def stream(self):
            if self.command == "HEAD":
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                return
            q = hub.subscribe()
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "keep-alive")
                self.send_header("X-Accel-Buffering", "no")
                self.end_headers()
                while True:
                    if not self.read_authorized():
                        self.wfile.write(b"event: auth-required\ndata: {}\n\n")
                        self.wfile.flush()
                        break
                    try:
                        kind, data = q.get(timeout=15)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        continue
                    # 等待新事件期间会话也可能到期，发送工作内容前再检查。
                    if not self.read_authorized():
                        continue
                    self.wfile.write(f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                hub.unsubscribe(q)

    return Handler


class OfficeServer(ThreadingHTTPServer):
    daemon_threads = True
    bridge = None

    def shutdown(self):
        if self.bridge:
            self.bridge.close()
        super().shutdown()

    def server_close(self):
        if self.bridge:
            self.bridge.close()
        super().server_close()


def make_server(host="127.0.0.1", port=8787, token=None, roster=None, office=None, persist=False, gateway_config=None):
    if office is None:
        office = load_office()
        if roster:
            office = dict(office)
            office["roster"] = roster
            office["agents"] = [
                {
                    "id": i,
                    "name": n,
                    "role": "",
                    "kind": "resident",
                    "contact": "expected",
                    "color": "",
                    "aliases": [],
                }
                for i, n in roster.items()
            ]
            office["aliases"] = {i: i for i in roster}
            office["aliases"].update({n.lower(): i for i, n in roster.items()})
    hub = Hub(office, persist=persist)
    server = OfficeServer((host, port), make_handler(hub, token))
    server.hub = hub
    if gateway_config:
        from grokbot_gateway import GatewayBridge
        server.bridge = GatewayBridge(hub, gateway_config)
        server.bridge.start()
    return server


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument('--grokbot-config', default=os.environ.get('OFFICE_GROKBOT_CONFIG'),
                    help='可选：只读网关采集器的本机 JSON 配置文件，不把口令写到命令行')
    args = ap.parse_args()
    token = os.environ.get("OFFICE_TOKEN") or None
    office = load_office()
    server = make_server(args.host, args.port, token, office=office, persist=True, gateway_config=args.grokbot_config)
    print(f"Office:  http://{args.host}:{args.port}/")
    print(f"Events:  POST http://{args.host}:{args.port}/api/events   (token {'required' if token else 'not required'})")
    print(f"Bots:    {', '.join(server.hub.roster)}")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not token:
        print("WARNING: 监听非本机地址且未设置 OFFICE_TOKEN，能访问该端口的人都能发事件。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
