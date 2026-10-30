#!/usr/bin/env python3
"""办公室服务器:静态页面 + 事件中继。

  Grok Bot --POST /api/events--> 本服务器(校验) --SSE /api/events/stream--> 浏览器里的办公室

只用 Python 标准库。默认只监听 127.0.0.1,所以只有本机进程能发事件。
如果设置了环境变量 OFFICE_TOKEN,POST 必须带 `Authorization: Bearer <token>`。
"""
import argparse
import json
import os
import queue
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# 必须和 src/config.js 的 STATES 一致(tests/test_server.py 会检查)
STATES = ("coding", "browsing", "terminal", "needsYou", "thinking", "error", "idle")
EVENT_TYPES = ("status", "handoff", "sync")
MAX_BODY = 16 * 1024
MAX_TEXT = 200


def load_roster(config_path=ROOT / "src" / "config.js"):
    """从 config.js 读出 {id: name}。这样"有哪些 bot"只有一个来源。"""
    src = Path(config_path).read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in re.finditer(r"\bid:\s*'([^']+)',\s*name:\s*'([^']+)'", src)}


class EventError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status = status
        self.body = {"error": message, **extra}


class Hub:
    """保存每个 bot 的最新状态,并把事件广播给所有已连接的浏览器。"""

    def __init__(self, roster):
        self.roster = roster
        self.last = {}  # agent_id -> 最近一条 status 事件
        self.subscribers = set()
        self.lock = threading.Lock()

    def resolve(self, ref):
        key = str(ref or "").strip().lower()
        for agent_id, name in self.roster.items():
            if key == agent_id or key == name.lower():
                return agent_id
        return None

    def validate(self, payload):
        """把外部传来的 JSON 变成干净的事件;不合法就抛 EventError。"""
        if not isinstance(payload, dict):
            raise EventError(400, "body must be a JSON object")
        etype = payload.get("type", "status")
        if etype not in EVENT_TYPES:
            raise EventError(422, f"unknown type {etype!r}", types=list(EVENT_TYPES))
        event = {"type": etype, "ts": time.time()}
        if etype == "sync":
            return event

        known = list(self.roster)
        agent = self.resolve(payload.get("agent"))
        if agent is None:
            raise EventError(422, f"unknown agent {payload.get('agent')!r}", agents=known)
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
        else:  # handoff
            target = self.resolve(payload.get("to"))
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
            if event["type"] == "status":
                self.last[event["agent"]] = event
            for q in list(self.subscribers):
                try:
                    q.put_nowait(("event", event))
                except queue.Full:  # 浏览器卡死了,丢掉它,不拖累别人
                    self.subscribers.discard(q)

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            self.subscribers.add(q)
            q.put(("snapshot", list(self.last.values())))  # 刷新页面后能立刻恢复现状
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.subscribers.discard(q)


def make_handler(hub, token):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")  # 开发期不缓存,改了代码刷新就生效
            super().end_headers()

        def log_message(self, fmt, *args):
            if "/api/events/stream" not in (args[0] if args else ""):
                super().log_message(fmt, *args)

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/api/health":
                return self.reply(200, {"ok": True, "subscribers": len(hub.subscribers)})
            if path == "/api/agents":
                return self.reply(200, {"agents": hub.roster, "states": list(STATES), "types": list(EVENT_TYPES)})
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
                        self.wfile.write(b": ping\n\n")  # 心跳,防止中间层把空闲连接掐掉
                        self.wfile.flush()
                        continue
                    self.wfile.write(f"event: {kind}\ndata: {json.dumps(data)}\n\n".encode())
                    self.wfile.flush()
            except OSError:  # 浏览器关了页面
                pass
            finally:
                hub.unsubscribe(q)

    return Handler


def make_server(host="127.0.0.1", port=8787, token=None, roster=None):
    hub = Hub(roster or load_roster())
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
    server = make_server(args.host, args.port, token)
    print(f"Office:  http://{args.host}:{args.port}/")
    print(f"Events:  POST http://{args.host}:{args.port}/api/events   (token {'required' if token else 'not required'})")
    print(f"Bots:    {', '.join(server.hub.roster)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
