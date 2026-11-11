import http.client
import json
import re
import sys
import threading
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402


def start(token=None):
    srv = server.make_server("127.0.0.1", 0, token, persist=False)
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
        office = server.load_office()
        roster = office["roster"]
        residents = [a for a in office["agents"] if a["kind"] == "resident"]
        self.assertEqual(len(residents), 8)
        self.assertEqual(roster["grok"], "Grok Bot")
        self.assertEqual(roster["zhuxian"], "主线学习总管")
        self.assertIn("diaoyan", roster)
        self.assertIn("ziliao", roster)
        self.assertIn("eggbot", roster)
        self.assertNotIn("python-roadmap", roster)
        self.assertNotIn("alfred", roster)
        self.assertNotIn("atlas", roster)
        diaoyan = next(a for a in office["agents"] if a["id"] == "diaoyan")
        mianshi = next(a for a in office["agents"] if a["id"] == "mianshi")
        self.assertEqual(diaoyan["contact"], "unconnected")
        self.assertEqual(mianshi["contact"], "unconnected")

    def test_states_match_config_js(self):
        src = (ROOT / "src" / "config.js").read_text(encoding="utf-8")
        block = src[src.index("export const STATES"):src.index("};", src.index("export const STATES"))]
        js_states = re.findall(r"^\s+(\w+):\s*\{ label", block, flags=re.M)
        self.assertEqual(sorted(js_states), sorted(server.STATES))

    def test_load_roster_wrapper(self):
        roster = server.load_roster()
        self.assertEqual(roster["qiwen"], "奇闻异事")


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
        status, body = self.post({"agent": "Grok Bot", "state": "coding", "text": "  写工位说明 "})
        self.assertEqual(status, 202)
        ev = body["event"]
        self.assertEqual((ev["type"], ev["agent"], ev["state"], ev["text"]), ("status", "grok", "coding", "写工位说明"))

    def test_agent_can_be_referenced_by_display_name(self):
        status, body = self.post({"agent": "观世界", "state": "idle"})
        self.assertEqual(status, 202)
        self.assertEqual(body["event"]["agent"], "guan")

    def test_jd_alias_maps_to_diaoyan(self):
        status, body = self.post({"agent": "JD调研", "state": "browsing", "text": "读论文"})
        self.assertEqual(status, 202)
        self.assertEqual(body["event"]["agent"], "diaoyan")

    def test_unknown_agent_lists_valid_ones(self):
        status, body = self.post({"agent": "nobody", "state": "coding"})
        self.assertEqual(status, 422)
        self.assertIn("grok", body["agents"])
        self.assertNotIn("atlas", body["agents"])

    def test_retired_agent_rejected_with_reason(self):
        status, body = self.post({"agent": "python-roadmap", "state": "coding", "text": "x"})
        self.assertEqual(status, 422)
        self.assertTrue(body.get("retired"))
        self.assertIn("撤席", body["error"])

    def test_bad_state_rejected(self):
        status, body = self.post({"agent": "grok", "state": "sleeping"})
        self.assertEqual(status, 422)
        self.assertIn("coding", body["states"])

    def test_text_too_long_rejected(self):
        status, _ = self.post({"agent": "grok", "state": "coding", "text": "x" * 201})
        self.assertEqual(status, 422)

    def test_handoff_rules(self):
        ok, body = self.post({"type": "handoff", "agent": "grok", "to": "zhuxian", "text": "材料"})
        self.assertEqual(ok, 202)
        self.assertEqual(body["event"]["to"], "zhuxian")
        self.assertEqual(self.post({"type": "handoff", "agent": "grok", "to": "grok"})[0], 422)
        self.assertEqual(self.post({"type": "handoff", "agent": "grok", "to": "ghost"})[0], 422)

    def test_sync_needs_no_agent(self):
        self.assertEqual(self.post({"type": "sync"})[0], 202)

    def test_unknown_type_rejected(self):
        self.assertEqual(self.post({"type": "explode"})[0], 422)

    def test_malformed_input(self):
        self.assertEqual(self.post(None, raw="not json")[0], 400)
        self.assertEqual(self.post(None, raw="[1,2]")[0], 400)
        self.assertEqual(self.post(None, raw="")[0], 400)

    def test_body_too_large(self):
        big = json.dumps({"agent": "grok", "state": "coding", "text": "a", "pad": "x" * 20000})
        self.assertEqual(self.post(None, raw=big)[0], 413)

    def test_agents_endpoint_and_static(self):
        status, body = request(self.srv, "GET", "/api/agents")
        self.assertEqual(status, 200)
        self.assertEqual(body["agents"]["grok"], "Grok Bot")
        self.assertEqual(len([a for a in body["roster"] if a["kind"] == "resident"]), 8)
        self.assertIn("staleAfterSec", body["freshness"])
        status, html = request(self.srv, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("办公室", html)
        self.assertIn("演示模式", html)
        self.assertIn('lang="zh-CN"', html)
        self.assertNotIn("Staff Virtual Office", html)

    def test_office_endpoint_has_server_time(self):
        self.post({"agent": "newbee", "state": "thinking", "text": "安排今天"})
        status, body = request(self.srv, "GET", "/api/office")
        self.assertEqual(status, 200)
        self.assertTrue(body["serverTime"])
        self.assertTrue(any(ev["agent"] == "newbee" for ev in body["last"]))


class TokenTest(unittest.TestCase):
    def test_token_required_when_configured(self):
        srv = start(token="s3cret")
        try:
            ev = {"agent": "grok", "state": "coding"}
            self.assertEqual(request(srv, "POST", "/api/events", ev)[0], 401)
            self.assertEqual(request(srv, "POST", "/api/events", ev, {"Authorization": "Bearer nope"})[0], 401)
            self.assertEqual(request(srv, "POST", "/api/events", ev, {"Authorization": "Bearer s3cret"})[0], 202)
        finally:
            stop(srv)

    def test_reads_require_bearer_or_browser_session(self):
        srv = start(token="test-office-token")
        try:
            for path in ["/api/office", "/api/agents", "/api/health", "/api/events/stream"]:
                for method in ["GET", "HEAD"]:
                    self.assertEqual(request(srv, method, path)[0], 401, path)
            self.assertEqual(request(srv, "GET", "/")[0], 200)
            self.assertFalse(request(srv, "GET", "/api/session")[1]["authenticated"])
            self.assertEqual(request(srv, "POST", "/api/session", headers={"Authorization": "Bearer wrong"})[0], 401)
            conn = http.client.HTTPConnection(*srv.server_address, timeout=5)
            conn.request("POST", "/api/session", headers={"Authorization": "Bearer test-office-token"})
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            cookie = response.getheader("Set-Cookie")
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=Strict", cookie)
            self.assertNotIn("test-office-token", cookie)
            response.read()
            conn.close()
            headers = {"Cookie": cookie.split(";", 1)[0]}
            self.assertEqual(request(srv, "GET", "/api/office", headers=headers)[0], 200)
            self.assertEqual(request(srv, "HEAD", "/api/events/stream", headers=headers)[0], 200)
            self.assertTrue(request(srv, "GET", "/api/session", headers=headers)[1]["authenticated"])
            self.assertEqual(request(srv, "POST", "/api/events", {"agent": "grok", "state": "idle"}, headers)[0], 401)
            self.assertEqual(request(srv, "GET", "/api/office", headers={"Authorization": "Bearer test-office-token"})[0], 200)
            self.assertEqual(request(srv, "GET", "/api/office", headers={"Cookie": "office_session=bad"})[0], 401)
            self.assertEqual(request(srv, "GET", "/api/office", headers={"Cookie": headers["Cookie"] + "tampered"})[0], 401)
            stream_conn = http.client.HTTPConnection(*srv.server_address, timeout=5)
            stream_conn.request("GET", "/api/events/stream", headers=headers)
            stream_response = stream_conn.getresponse()
            while stream_response.readline().strip():
                pass  # 消费初始快照，再让会话在等待新事件时过期。
            with patch.object(server.time, "time", return_value=server.time.time() + 13 * 60 * 60):
                self.assertEqual(request(srv, "GET", "/api/office", headers=headers)[0], 401)
                srv.hub.publish(srv.hub.validate({"agent": "grok", "state": "coding", "text": "expired-session-must-not-read"}))
                self.assertEqual(stream_response.readline().decode().strip(), "event: auth-required")
            stream_response.close()
            stream_conn.close()
        finally:
            stop(srv)


class StaticFilesTest(unittest.TestCase):
    def test_only_public_assets_are_served_and_missing_files_return_404(self):
        srv = start()
        try:
            for method in ["GET", "HEAD"]:
                for path in ["/server.py", "/.git/HEAD", "/.git/config", "/data/office-state.json", "/src/", "/missing", "/src/../server.py", "/%2egit/HEAD"]:
                    self.assertEqual(request(srv, method, path)[0], 404, (method, path))
                for path in ["/", "/index.html", "/style.css", "/src/main.js"]:
                    self.assertEqual(request(srv, method, path)[0], 200, (method, path))
        finally:
            stop(srv)


class HubConsistencyTest(unittest.TestCase):
    def test_handoff_only_presence_survives_restart_without_inventing_a_status(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, "STATE_PATH", Path(folder) / "state.json"):
            hub = server.Hub(server.load_office(), persist=True)
            event = hub.validate({"type": "handoff", "agent": "eggbot", "to": "grok"})
            hub.publish(event)
            restored = server.Hub(server.load_office(), persist=True)
            item = restored.snapshot()[0]
            self.assertEqual(item["agent"], "eggbot")
            self.assertEqual(item["type"], "presence")
            self.assertNotIn("state", item)
            self.assertEqual(item["seen"], event["ts"])
            next_event = restored.validate({"agent": "eggbot", "state": "coding"})
            restored.publish(next_event)
            self.assertGreater(next_event["seq"], event["seq"])
            self.assertNotEqual(next_event["epoch"], event["epoch"])

    def test_legacy_last_seen_only_is_restored(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(server, "STATE_PATH", Path(folder) / "state.json"):
            server.STATE_PATH.write_text(json.dumps({"last": {}, "lastSeen": {"eggbot": 123}, "recent": []}))
            hub = server.Hub(server.load_office(), persist=True)
            self.assertEqual(hub.snapshot()[0]["seen"], 123)
            self.assertEqual(hub.snapshot()[0]["type"], "presence")

    def test_event_during_subscription_is_delivered_after_snapshot(self):
        hub = server.Hub(server.load_office())
        hub.publish(hub.validate({"agent": "grok", "state": "coding"}))
        captured = threading.Event()
        release = threading.Event()
        publishing = threading.Event()
        original = hub._office_payload_unlocked
        result = []
        def delayed_snapshot():
            snapshot = original()
            captured.set()
            self.assertTrue(release.wait(3))
            return snapshot
        def publish():
            publishing.set()
            hub.publish(hub.validate({"agent": "grok", "state": "needsYou"}))
        with patch.object(hub, "_office_payload_unlocked", delayed_snapshot):
            subscriber = threading.Thread(target=lambda: result.append(hub.subscribe()))
            subscriber.start()
            self.assertTrue(captured.wait(3))
            publisher = threading.Thread(target=publish)
            publisher.start()
            self.assertTrue(publishing.wait(3))
            release.set()
            subscriber.join(3)
            publisher.join(3)
        q = result[0]
        kind, data = q.get(timeout=1)
        self.assertEqual((kind, data["last"][0]["state"]), ("snapshot", "coding"))
        kind, data = q.get(timeout=1)
        self.assertEqual((kind, data["state"]), ("event", "needsYou"))

    def test_slow_subscriber_gets_replacement_snapshot_and_keeps_receiving(self):
        hub = server.Hub(server.load_office())
        q = hub.subscribe()
        for i in range(205):
            hub.publish(hub.validate({"agent": "grok", "state": "coding", "text": str(i)}))
        kind, snapshot = q.get_nowait()
        self.assertEqual(kind, "snapshot")
        self.assertTrue(snapshot["last"])
        self.assertIn(q, hub.subscribers)
        while not q.empty():
            q.get_nowait()
        hub.publish(hub.validate({"agent": "grok", "state": "needsYou"}))
        self.assertEqual(q.get_nowait()[1]["state"], "needsYou")


class StreamTest(unittest.TestCase):
    def read_event(self, resp):
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
            request(srv, "POST", "/api/events", {"agent": "grok", "state": "coding", "text": "before"})

            conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=5)
            conn.request("GET", "/api/events/stream")
            resp = conn.getresponse()
            self.assertEqual(resp.getheader("Content-Type"), "text/event-stream")

            kind, data = self.read_event(resp)
            self.assertEqual(kind, "snapshot")
            self.assertEqual([e["text"] for e in data["last"]], ["before"])
            self.assertIn("seen", data["last"][0])
            self.assertEqual(data["recent"][0]["text"], "before")
            self.assertTrue(data["epoch"])

            _, ack = request(srv, "POST", "/api/events", {"agent": "guan", "state": "browsing", "text": "after"})
            self.assertEqual(ack["watching"], 1)
            kind, data = self.read_event(resp)
            self.assertEqual((kind, data["agent"], data["text"]), ("event", "guan", "after"))
            conn.close()
        finally:
            stop(srv)


if __name__ == "__main__":
    unittest.main()
