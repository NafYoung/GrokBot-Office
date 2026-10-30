import http.client
import json
import re
import sys
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402


def start(token=None):
    srv = server.make_server("127.0.0.1", 0, token)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def stop(srv):
    srv.shutdown()
    srv.server_close()


def request(srv, method, path, body=None, headers=None, raw=None):
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
    data = raw if raw is not None else (json.dumps(body) if body is not None else None)
    conn.request(method, path, body=data, headers=headers or {})
    resp = conn.getresponse()
    text = resp.read().decode()
    conn.close()
    try:
        return resp.status, json.loads(text)
    except json.JSONDecodeError:
        return resp.status, text


class RosterAndConfigTest(unittest.TestCase):
    def test_roster_comes_from_config_js(self):
        roster = server.load_roster()
        self.assertEqual(len(roster), 8)
        self.assertEqual(roster["drone"], "Drone Business")
        self.assertIn("alfred", roster)

    def test_states_match_config_js(self):
        src = (ROOT / "src" / "config.js").read_text(encoding="utf-8")
        block = src[src.index("export const STATES"):src.index("};", src.index("export const STATES"))]
        js_states = re.findall(r"^\s+(\w+):\s*\{ label", block, flags=re.M)
        self.assertEqual(sorted(js_states), sorted(server.STATES))


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = start()

    @classmethod
    def tearDownClass(cls):
        stop(cls.srv)

    def post(self, body, **kw):
        return request(self.srv, "POST", "/api/events", body, {"Content-Type": "application/json"}, **kw)

    def test_valid_status_event(self):
        status, body = self.post({"agent": "Atlas", "state": "coding", "text": "  Drafting invites "})
        self.assertEqual(status, 202)
        ev = body["event"]
        self.assertEqual((ev["type"], ev["agent"], ev["state"], ev["text"]), ("status", "atlas", "coding", "Drafting invites"))

    def test_agent_can_be_referenced_by_display_name(self):
        status, body = self.post({"agent": "drone business", "state": "idle"})
        self.assertEqual(status, 202)
        self.assertEqual(body["event"]["agent"], "drone")

    def test_unknown_agent_lists_valid_ones(self):
        status, body = self.post({"agent": "nobody", "state": "coding"})
        self.assertEqual(status, 422)
        self.assertIn("atlas", body["agents"])

    def test_bad_state_rejected(self):
        status, body = self.post({"agent": "atlas", "state": "sleeping"})
        self.assertEqual(status, 422)
        self.assertIn("coding", body["states"])

    def test_text_too_long_rejected(self):
        status, _ = self.post({"agent": "atlas", "state": "coding", "text": "x" * 201})
        self.assertEqual(status, 422)

    def test_handoff_rules(self):
        ok, body = self.post({"type": "handoff", "agent": "fetch", "to": "claim", "text": "parcel"})
        self.assertEqual(ok, 202)
        self.assertEqual(body["event"]["to"], "claim")
        self.assertEqual(self.post({"type": "handoff", "agent": "fetch", "to": "fetch"})[0], 422)
        self.assertEqual(self.post({"type": "handoff", "agent": "fetch", "to": "ghost"})[0], 422)

    def test_sync_needs_no_agent(self):
        self.assertEqual(self.post({"type": "sync"})[0], 202)

    def test_unknown_type_rejected(self):
        self.assertEqual(self.post({"type": "explode"})[0], 422)

    def test_malformed_input(self):
        self.assertEqual(self.post(None, raw="not json")[0], 400)
        self.assertEqual(self.post(None, raw="[1,2]")[0], 400)
        self.assertEqual(self.post(None, raw="")[0], 400)

    def test_body_too_large(self):
        big = json.dumps({"agent": "atlas", "state": "coding", "text": "a", "pad": "x" * 20000})
        self.assertEqual(self.post(None, raw=big)[0], 413)

    def test_agents_endpoint_and_static(self):
        status, body = request(self.srv, "GET", "/api/agents")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["agents"]), 8)
        status, html = request(self.srv, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("Staff Virtual Office", html)


class TokenTest(unittest.TestCase):
    def test_token_required_when_configured(self):
        srv = start(token="s3cret")
        try:
            ev = {"agent": "atlas", "state": "coding"}
            self.assertEqual(request(srv, "POST", "/api/events", ev)[0], 401)
            self.assertEqual(request(srv, "POST", "/api/events", ev, {"Authorization": "Bearer nope"})[0], 401)
            self.assertEqual(request(srv, "POST", "/api/events", ev, {"Authorization": "Bearer s3cret"})[0], 202)
        finally:
            stop(srv)


class StreamTest(unittest.TestCase):
    def read_event(self, resp):
        """读一条 SSE 消息,返回 (event, data)。"""
        kind = data = None
        while True:
            line = resp.readline().decode().rstrip("\n")
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                kind = line[6:].strip()
            elif line.startswith("data:"):
                data = json.loads(line[5:])
            elif line == "" and kind:
                return kind, data

    def test_snapshot_then_live_events(self):
        srv = start()
        try:
            request(srv, "POST", "/api/events", {"agent": "atlas", "state": "coding", "text": "before"})

            conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
            conn.request("GET", "/api/events/stream")
            resp = conn.getresponse()
            self.assertEqual(resp.getheader("Content-Type"), "text/event-stream")

            kind, data = self.read_event(resp)  # 刷新页面时先收到现状
            self.assertEqual(kind, "snapshot")
            self.assertEqual([e["text"] for e in data], ["before"])

            _, ack = request(srv, "POST", "/api/events", {"agent": "scout", "state": "browsing", "text": "after"})
            self.assertEqual(ack["watching"], 1)
            kind, data = self.read_event(resp)
            self.assertEqual((kind, data["agent"], data["text"]), ("event", "scout", "after"))
            conn.close()
        finally:
            stop(srv)


if __name__ == "__main__":
    unittest.main()
