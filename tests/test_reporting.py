import json
import os
import socket
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server
from office_report import OfficeClient, ReportError


class ReportingTest(unittest.TestCase):
    def setUp(self):
        self.token = 'reporting-integration-test-token'
        self.server = server.make_server('127.0.0.1', 0, token=self.token, persist=False)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
        self.client = OfficeClient(self.url, self.token, socket.gethostname())

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_generated_setup_targets_this_machine_and_port_without_credentials(self):
        info = self.client.request('/api/integration')
        self.assertEqual(info['localUrl'], self.url)
        self.assertEqual(info['machine'], socket.gethostname())
        self.assertIn(self.url, info['instructions'])
        self.assertNotIn(self.token, json.dumps(info))
        self.assertNotIn('57612994-5d82-4f6d-abdb-ef75f2051c69', info['instructions'])
        self.assertTrue(self.client.check()['ok'])
        self.assertIn('grok', self.client.agents()['agents'])
        self.assertEqual(self.server.hub.sequence, 0)
        self.assertFalse(self.server.hub.last)

    def test_authenticated_report_lifecycle_and_current_alias(self):
        for state in ('thinking', 'coding', 'needsYou', 'error', 'idle'):
            ack = self.client.report({'agent': 'nafyoung的知识库', 'state': state, 'text': f'实际测试任务：{state}'})
            self.assertEqual(ack['agent'], 'zhishiku')
            self.assertEqual(ack['state'], state)
            current = self.server.hub.snapshot()[0]
            self.assertEqual(current['state'], state)
        self.assertEqual(self.server.hub.sequence, 5)

    def test_each_agent_setup_has_its_own_fixed_identity(self):
        for agent in ('grok', 'guan', 'shiyan'):
            config = self.client.request('/api/integration?agent=' + agent)
            self.assertEqual(config['agent']['id'], agent)
            self.assertIn('--agent ' + agent, config['instructions'])
            self.assertIn(config['agent']['name'], config['instructions'])
            if agent != 'grok':
                self.assertNotIn('--agent grok', config['instructions'])
        for query in ('agent=python', 'agent=', 'agent=grok&agent=guan'):
            with self.assertRaises(ReportError):
                self.client.request('/api/integration?' + query)
        self.assertEqual(self.server.hub.sequence, 0)

    def test_bound_reporter_rejects_wrong_identity_without_touching_main_bot(self):
        client = OfficeClient(self.url, self.token, agent='guan')
        self.assertEqual(client.check()['agent'], 'guan')
        self.client.report({'agent': 'grok', 'state': 'thinking', 'text': '主 Bot 原任务'})
        with self.assertRaisesRegex(ReportError, '不一致'):
            client.report({'agent': 'grok', 'state': 'coding', 'text': '不能串到主 Bot'})
        self.assertEqual(self.server.hub.sequence, 1)
        client.report({'state': 'browsing', 'text': '观世界自己的任务'})
        snapshots = {item['agent']: item for item in self.server.hub.snapshot()}
        self.assertEqual(snapshots['grok']['text'], '主 Bot 原任务')
        self.assertEqual(snapshots['guan']['text'], '观世界自己的任务')
        with self.assertRaises(ReportError):
            OfficeClient(self.url, self.token, agent='python').report({'state': 'idle'})

    def test_all_current_bots_keep_independent_statuses(self):
        ids = list(self.server.hub.roster)
        for agent in ids:
            OfficeClient(self.url, self.token, agent=agent).report({'state': 'coding', 'text': agent + ' 的任务'})
        self.assertEqual(len(self.server.hub.snapshot()), len(ids))
        OfficeClient(self.url, self.token, agent='grok').report({'state': 'idle', 'text': '主 Bot 完成'})
        for item in self.server.hub.snapshot():
            if item['agent'] == 'grok':
                self.assertEqual(item['state'], 'idle')
            else:
                self.assertEqual(item['state'], 'coding')
                self.assertEqual(item['text'], item['agent'] + ' 的任务')

    def test_bound_cli_supplies_agent_when_json_omits_it(self):
        result = subprocess.run([sys.executable, str(ROOT / 'office_report.py'), '--url', self.url,
                                 '--agent', 'shiyan', 'report'],
                                env={**os.environ, 'OFFICE_TOKEN': self.token},
                                input=json.dumps({'state': 'terminal', 'text': '实验助教独立任务'}),
                                text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['agent'], 'shiyan')
        self.assertEqual(self.server.hub.snapshot()[0]['agent'], 'shiyan')

    def test_wrong_token_or_machine_does_not_publish(self):
        for client in (OfficeClient(self.url, 'wrong'), OfficeClient(self.url, self.token, 'another-mac')):
            with self.assertRaises(ReportError):
                client.report({'agent': 'grok', 'state': 'coding', 'text': '不得写入'})
        self.assertEqual(self.server.hub.sequence, 0)

    def test_ping_retired_and_extra_fields_do_not_become_work(self):
        for payload in (
            {'action': 'ping', 'bot': 'Grok Bot'},
            {'agent': 'Python Roadmap', 'state': 'coding'},
            {'agent': 'python', 'state': 'coding'},
            {'agent': '论文数据小组', 'state': 'coding'},
            {'agent': 'grok', 'state': 'coding', 'ts': 123},
        ):
            with self.assertRaises(ReportError):
                self.client.report(payload)
        self.assertEqual(self.server.hub.sequence, 0)

    def test_cli_reports_json_stdin_and_never_echoes_token(self):
        base = [sys.executable, str(ROOT / 'office_report.py'), '--url', self.url,
                '--expect-machine', socket.gethostname()]
        env = {**os.environ, 'OFFICE_TOKEN': self.token}
        check = subprocess.run(base + ['check'], env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertEqual(self.server.hub.sequence, 0)
        # Shell 特殊字符始终留在 JSON 数据中，不执行、不改写。
        text = '整理笔记；$(echo unsafe) `echo unsafe` "双引号"'
        result = subprocess.run(base + ['report'], env=env, text=True, capture_output=True, timeout=10,
                                input=json.dumps({'agent': 'grok', 'state': 'coding', 'text': text}))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.hub.snapshot()[0]['text'], text)
        self.assertTrue(json.loads(result.stdout)['ok'])
        self.assertNotIn(self.token, result.stdout + result.stderr + check.stdout + check.stderr)

    def test_missing_explicit_url_and_invalid_input_fail_without_sending(self):
        env = {key: value for key, value in os.environ.items() if key not in ('OFFICE_URL', 'OFFICE_TOKEN')}
        missing = subprocess.run([sys.executable, str(ROOT / 'office_report.py'), 'check'],
                                 env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(missing.returncode, 1)
        self.assertIn('显式提供', missing.stderr)
        invalid = subprocess.run([sys.executable, str(ROOT / 'office_report.py'), '--url', self.url, 'report'],
                                 input='not-json', env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(invalid.returncode, 1)
        self.assertEqual(self.server.hub.sequence, 0)

    def test_urls_with_embedded_credentials_and_remote_plain_http_are_rejected(self):
        for url in ('http://example.com', 'https://user:secret@example.com', self.url + '/?token=secret',
                    self.url + '/api/events', 'http://[bad', self.url + '/?demo=idle'):
            with self.assertRaises(ReportError):
                OfficeClient(url)

    def test_redirect_is_not_followed_with_credentials(self):
        received = []
        class Target(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.headers.get('Authorization'))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')
            def log_message(self, *args):
                pass
        target = ThreadingHTTPServer(('127.0.0.1', 0), Target)
        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header('Location', f'http://127.0.0.1:{target.server_port}/')
                self.end_headers()
            def log_message(self, *args):
                pass
        redirect = ThreadingHTTPServer(('127.0.0.1', 0), Redirect)
        for srv in (target, redirect):
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with self.assertRaisesRegex(ReportError, '重定向'):
                OfficeClient(f'http://127.0.0.1:{redirect.server_port}', self.token).check()
            self.assertFalse(received)
        finally:
            for srv in (target, redirect):
                srv.shutdown()
                srv.server_close()


if __name__ == '__main__':
    unittest.main()
