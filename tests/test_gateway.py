import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server
from grokbot_gateway import GatewayClient, GatewayBridge, GatewayError, load_config, observed_status


def bot(identity='native-guan', name='观世界', **fields):
    return dict(id=identity, name=name, isRunning=False, isComposingMessage=False,
                awaitingUserResponse=None, isGroup=False, **fields)


class StubClient:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.async_tasks = {}
        self.subagents = {}
        self.fail = set()

    def read(self, command, body=None):
        self.calls.append((command, body))
        if command == 'listAgents':
            return self.rows
        identity = body['id']
        if identity in self.fail:
            raise GatewayError('测试：网关不可达')
        return (self.async_tasks if command == 'getAsyncTasks' else self.subagents).get(identity, [])


class GatewayProjectionTest(unittest.TestCase):
    def setUp(self):
        self.hub = server.Hub(server.load_office())
        self.bridge = GatewayBridge(self.hub, '/unused')

    def test_all_bots_independent_and_background_tasks_keep_parent_busy(self):
        rows = [bot('native-' + aid, name) for aid, name in self.hub.roster.items()]
        client = StubClient(rows)
        client.async_tasks['native-guan'] = [{'id': 'task1', 'status': 'running'}]
        client.subagents['native-shiyan'] = [{'status': 'running'}]
        self.bridge.poll(client, {})
        self.assertEqual(self.hub.connector['state'], 'connected')
        self.assertEqual(self.hub.connector['syncedAgents'], len(rows))
        self.assertEqual(self.hub.last['grok']['state'], 'idle')
        for aid in ('guan', 'shiyan'):
            self.assertEqual(self.hub.last[aid]['state'], 'thinking')
        count = len(self.hub.recent)
        self.bridge.poll(client, {})
        self.assertEqual(len(self.hub.recent), count)
        self.assertEqual(set(command for command, _ in client.calls), {'listAgents', 'getAsyncTasks', 'getSubagents'})

    def test_duplicate_names_need_explicit_binding_and_unknowns_not_misassigned(self):
        client = StubClient([bot(), bot('native-second'), bot('unknown', '论文数据小组')])
        self.bridge.poll(client, {})
        self.assertEqual(self.hub.last, {})
        self.assertEqual(len(self.hub.connector['ambiguousNames']), 2)
        self.assertEqual(self.hub.connector['ambiguousAgents'][0]['id'], 'native-guan')
        self.bridge.poll(client, {'mappings': {'native-guan': 'guan'}})
        self.assertEqual(list(self.hub.last), ['guan'])
        self.assertEqual(self.hub.diagnostics['guan']['nativeId'], 'native-guan')
        self.assertEqual(self.hub.connector['state'], 'partial')
        with self.assertRaises(GatewayError):
            self.bridge.poll(client, {'mappings': {'native-guan': 'missing'}})

    def test_failed_or_incompatible_reads_do_not_report_idle_or_contact(self):
        row = bot()
        row['isRunning'] = True
        client = StubClient([row])
        self.bridge.poll(client, {})
        before = self.hub.office_payload()
        client.fail.add('native-guan')
        self.bridge.poll(client, {})
        self.assertEqual(self.hub.last_seen, before['lastSeen'])
        self.assertEqual(self.hub.last['guan']['state'], 'thinking')
        self.assertEqual(self.hub.connector['state'], 'partial')
        client.fail.clear()
        del row['isRunning']
        self.bridge.poll(client, {})
        self.assertEqual(self.hub.last_seen, before['lastSeen'])
        self.assertIn('字段缺失', self.hub.connector['message'])
        self.assertEqual(self.hub.connector['syncedAgents'], 0)

    def test_waiting_and_busy_do_not_invent_task_text(self):
        row = bot(lastMessagePreview='过期聊天不是当前任务')
        row['isRunning'] = True
        state, text = observed_status(row, [], [])
        self.assertEqual(state, 'thinking')
        self.assertIn('未提供具体任务内容', text)
        self.assertNotIn('过期聊天', text)
        row['awaitingUserResponse'] = {'question': 'secret private chat'}
        self.assertEqual(observed_status(row, [], [])[0], 'needsYou')
        self.assertNotIn('secret', observed_status(row, [], [])[1])
        with self.assertRaises(GatewayError):
            observed_status(row, [{'id': 'task', 'status': 'unknown'}], [])

    def test_stopping_adapter_prevents_new_events(self):
        self.bridge.close()
        self.bridge.poll(StubClient([bot()]), {})
        self.assertEqual(self.hub.sequence, 0)


class GatewayHTTPTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.base = Path(self.directory.name)
        self.calls = []
        self.mode = 'ok'
        self.poll_done = threading.Event()
        test = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.calls.append((self.path, body, self.headers.get('Authorization')))
                if test.mode == 'redirect':
                    self.send_response(302)
                    self.send_header('Location', '/forbidden')
                    self.end_headers()
                    return
                if self.headers.get('Authorization') != 'Bearer local-test-secret':
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b'upstream-private-message')
                    return
                if test.mode == 'bad-shape':
                    result = {'agents': [bot()]}
                elif self.path == '/api/listAgents':
                    result = [bot()]
                elif self.path in ('/api/getAsyncTasks', '/api/getSubagents'):
                    result = []
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(result).encode())
                if self.path == '/api/getSubagents':
                    test.poll_done.set()
        self.gateway = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.gateway.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.gateway.server_port}'
        (self.base / 'gateway.token').write_text('local-test-secret')
        self.filename = self.base / 'adapter.json'
        self.filename.write_text(json.dumps({'gatewayUrl': self.url, 'tokenFile': 'gateway.token', 'intervalSeconds': 5}))
        self.env = patch.dict(os.environ, {'GROKBOT_GATEWAY_TOKEN': ''})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.gateway.shutdown()
        self.gateway.server_close()
        self.directory.cleanup()

    def test_authenticated_read_only_protocol_and_server_bridge(self):
        config = load_config(self.filename)
        self.assertEqual(GatewayClient(config).read('listAgents')[0]['name'], '观世界')
        with self.assertRaises(GatewayError):
            GatewayClient(config).read('createAgent', {'name': 'forbidden'})
        updated = threading.Event()
        original = server.Hub.set_connector
        def observe(hub, **changes):
            original(hub, **changes)
            if changes.get('state') == 'connected':
                updated.set()
        with patch.object(server.Hub, 'set_connector', observe):
            srv = server.make_server(port=0, gateway_config=self.filename)
            try:
                self.assertTrue(updated.wait(5))
                self.assertEqual(srv.hub.last['guan']['state'], 'idle')
                self.assertEqual(srv.hub.diagnostics['guan']['source'], 'grokbot-gateway')
                self.assertTrue(all(path in ('/api/listAgents', '/api/getAsyncTasks', '/api/getSubagents') for path, _, _ in self.calls))
                self.assertTrue(all(auth == 'Bearer local-test-secret' for _, _, auth in self.calls))
            finally:
                srv.server_close()
                srv.bridge.thread.join(5)

    def test_token_errors_redirect_and_shape_never_leak_or_fall_back(self):
        client = GatewayClient(load_config(self.filename))
        (self.base / 'gateway.token').write_text('wrong-private-token')
        with self.assertRaises(GatewayError) as context:
            client.read('listAgents')
        self.assertNotIn('private', str(context.exception))
        (self.base / 'gateway.token').write_text('local-test-secret')
        self.mode = 'redirect'
        before = len(self.calls)
        with self.assertRaises(GatewayError):
            client.read('listAgents')
        self.assertEqual(len(self.calls), before + 1)
        self.mode = 'bad-shape'
        with self.assertRaises(GatewayError):
            client.read('listAgents')

    def test_explicit_discovery_and_secure_destination(self):
        discovery = self.base / 'host.json'
        discovery.write_text(json.dumps({'port': self.gateway.server_port, 'host': '0.0.0.0', 'token': 'local-test-secret'}))
        config = {'_base': self.base, 'discoveryFile': 'host.json'}
        self.assertEqual(GatewayClient(config).credentials(), (self.url, 'local-test-secret'))
        with self.assertRaises(GatewayError):
            GatewayClient({**config, 'gatewayUrl': 'https://another-host.example'}).credentials()
        with self.assertRaises(GatewayError):
            GatewayClient({'_base': self.base, 'gatewayUrl': 'http://remote-host.example', 'tokenFile': 'gateway.token'}).credentials()
        self.filename.write_text('{"unknownOption":true}')
        with self.assertRaises(GatewayError):
            load_config(self.filename)
