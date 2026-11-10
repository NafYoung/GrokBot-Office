#!/usr/bin/env python3
"""办公室服务器：静态页面 + 事件中继。

  Grok Bot --POST /api/events--> 本服务器（校验）--SSE /api/events/stream--> 浏览器

只用 Python 标准库。默认监听 127.0.0.1。
Mac mini 历史用法：python3 server.py --host 0.0.0.0 --port 8787
若设置环境变量 OFFICE_TOKEN，POST 必须带 Authorization: Bearer <token>。
不要把 token 写进仓库或聊天。
"""
from __future__ import annotations

import argparse
import json
import os
import queue
import re
import threading
import time
from collections import deque
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_PATH = ROOT / "data" / "office-state.json"

# 必须和 src/config.js 的 STATES 一致（tests/test_server.py 会检查）
STATES = ("coding", "browsing", "terminal", "needsYou", "thinking", "error", "idle")
EVENT_TYPES = ("status", "handoff", "sync")
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
        self.last = {}  # agent_id -> 最近一条 status
        self.last_seen = {}  # agent_id -> unix ts
        self.recent = deque(maxlen=MAX_RECENT)
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
        if etype not in EVENT_TYPES:
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

        text = payload.get("text", "")
        if not isinstance(text, str) or len(text) > MAX_TEXT:
            raise EventError(422, f"text must be a string up to {MAX_TEXT} characters")
        event["text"] = text.strip()

        state = payload.get("state")
        if etype == "status":
            if state not in STATES:
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
                if state not in STATES:
                    raise EventError(422, f"state must be one of {list(STATES)}", states=list(STATES))
                event["state"] = state
        return event

    def publish(self, event):
        with self.lock:
            ts = event["ts"]
            if event["type"] == "status":
                stored = dict(event)
                stored["seen"] = ts
                self.last[event["agent"]] = stored
                self.last_seen[event["agent"]] = ts
            elif event["type"] == "handoff":
                self.last_seen[event["agent"]] = ts
                if event["agent"] in self.last:
                    self.last[event["agent"]]["seen"] = ts
            self.recent.append(event)
            self._save_state_unlocked()
            for q in list(self.subscribers):
                try:
                    q.put_nowait(("event", event))
                except queue.Full:
                    self.subscribers.discard(q)

    def snapshot(self):
        with self.lock:
            out = []
            for agent_id, ev in self.last.items():
                item = dict(ev)
                item["seen"] = self.last_seen.get(agent_id, ev.get("ts"))
                out.append(item)
            return out

    def office_payload(self):
        with self.lock:
            last = []
            for agent_id, ev in self.last.items():
                item = dict(ev)
                item["seen"] = self.last_seen.get(agent_id, ev.get("ts"))
                last.append(item)
            return {
                "owner": self.office["owner"],
                "title": self.office["title"],
                "agents": {a["id"]: a["name"] for a in self.office["agents"]},
                "roster": self.office["agents"],
                "states": list(STATES),
                "types": list(EVENT_TYPES),
                "freshness": self.office["freshness"],
                "retired": self.office["retired"],
                "last": last,
                "recent": list(self.recent),
                "lastSeen": dict(self.last_seen),
                "serverTime": time.time(),
            }

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        snap = self.snapshot()
        with self.lock:
            self.subscribers.add(q)
            q.put(("snapshot", snap))
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
        last = data.get("last") or {}
        seen = data.get("lastSeen") or {}
        recent = data.get("recent") or []
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

    def _save_state_unlocked(self):
        if not self.persist:
            return
        try:
            STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "last": self.last,
                "lastSeen": self.last_seen,
                "recent": list(self.recent),
            }
            tmp = STATE_PATH.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(STATE_PATH)
        except OSError:
            pass


def make_handler(hub, token):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            if "/api/events/stream" not in (args[0] if args else ""):
                super().log_message(fmt, *args)

        def reply(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
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
            if path == "/api/events/stream":
                return self.stream()
            return super().do_GET()

        def do_POST(self):
            if self.path.split("?", 1)[0] != "/api/events":
                return self.reply(404, {"error": "not found"})
            try:
                if token and self.headers.get("Authorization") != f"Bearer {token}":
                    raise EventError(401, "missing or wrong bearer token")
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
            except EventError as e:
                return self.reply(e.status, e.body)
            hub.publish(event)
            self.reply(202, {"ok": True, "event": event, "watching": len(hub.subscribers)})

        def stream(self):
            q = hub.subscribe()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                while True:
                    try:
                        kind, data = q.get(timeout=15)
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        continue
                    self.wfile.write(f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                hub.unsubscribe(q)

    return Handler


def make_server(host="127.0.0.1", port=8787, token=None, roster=None, office=None, persist=False):
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
    server = ThreadingHTTPServer((host, port), make_handler(hub, token))
    server.daemon_threads = True
    server.hub = hub
    return server


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    args = ap.parse_args()
    token = os.environ.get("OFFICE_TOKEN") or None
    office = load_office()
    server = make_server(args.host, args.port, token, office=office, persist=True)
    print(f"Office:  http://{args.host}:{args.port}/")
    print(f"Events:  POST http://{args.host}:{args.port}/api/events   (token {'required' if token else 'not required'})")
    print(f"Bots:    {', '.join(server.hub.roster)}")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not token:
        print("WARNING: 监听非本机地址且未设置 OFFICE_TOKEN，能访问该端口的人都能发事件。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
