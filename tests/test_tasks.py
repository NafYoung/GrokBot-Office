import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server
from office_report import OfficeClient, ReportError
import test_reporting


class TaskStateTest(unittest.TestCase):
    def setUp(self):
        self.hub = server.Hub(server.load_office())

    def send(self, task='a', phase='started', revision=1, **extra):
        return self.hub.publish(self.hub.validate(dict(
            type='task', agent='guan', taskId=task, phase=phase, revision=revision,
            eventId=f'{task}.{revision}', text=f'{task}:{phase}', **extra)))

    def test_parallel_lifecycle_and_other_bots_are_independent(self):
        self.send('a', state='coding')
        self.send('b', state='browsing')
        self.hub.publish(self.hub.validate({'agent': 'grok', 'state': 'idle'}))
        self.send('a', 'completed', 2)
        current = self.hub.last['guan']
        self.assertEqual(current['state'], 'browsing')
        self.assertEqual(current['text'], 'b:started')
        self.assertEqual(len(self.hub.tasks.for_agent('guan')), 2)
        self.send('b', 'completed', 2)
        self.assertEqual(self.hub.last['guan']['state'], 'idle')

    def test_waiting_then_progress_and_legacy_idle(self):
        self.send('a', state='coding')
        self.send('b')
        self.send('a', 'waiting', 2)
        self.assertEqual(self.hub.last['guan']['state'], 'needsYou')
        self.hub.publish(self.hub.validate({'agent': 'guan', 'state': 'idle', 'text': '旧客户端'}))
        self.assertEqual(self.hub.last['guan']['state'], 'needsYou')
        self.send('a', 'progress', 3)
        self.assertEqual(self.hub.last['guan']['state'], 'thinking')
        self.send('a', 'failed', 4)
        self.assertEqual(self.hub.last['guan']['text'], 'b:started')
        self.send('b', 'cancelled', 2)
        self.assertEqual(self.hub.last['guan']['state'], 'idle')

    def test_duplicates_and_delayed_updates_do_not_touch_freshness(self):
        first = self.send()
        duplicate = self.send()
        self.assertTrue(duplicate['duplicate'])
        self.assertEqual(self.hub.sequence, 1)
        self.assertEqual(self.hub.last_seen['guan'], first['ts'])
        self.send('a', 'progress', 3)
        seq = self.hub.sequence
        old = self.send('a', 'progress', 2)
        self.assertTrue(old['ignored'])
        self.assertEqual(self.hub.sequence, seq)
        self.send('a', 'completed', 4)
        with self.assertRaises(server.EventError) as context:
            self.send('a', 'progress', 5)
        self.assertEqual(context.exception.status, 409)
        with self.assertRaises(server.EventError):
            self.send('missing', 'completed', 2)
        with self.assertRaises(server.EventError):
            self.send('a', state='browsing')  # same eventId, different payload

    def test_heartbeat_and_gateway_observation_do_not_renew_old_task(self):
        self.send()
        task_ts = self.hub.last['guan']['ts']
        event = self.hub.publish(self.hub.validate({'type': 'heartbeat', 'agent': 'guan'}))
        self.assertEqual(event['current']['ts'], task_ts)
        self.assertGreaterEqual(event['current']['seen'], task_ts)
        self.assertTrue(event['silent'])
        status = {'agent': 'guan', 'source': 'grokbot-gateway', 'state': 'idle', 'text': '主机确认空闲'}
        self.hub.publish(self.hub.validate(status))
        repeated = self.hub.publish(self.hub.validate(status))
        self.assertTrue(repeated['silent'])
        self.assertEqual(repeated['current']['state'], 'thinking')
        self.assertEqual(repeated['current']['runtime']['state'], 'idle')
        self.assertEqual(repeated['current']['ts'], task_ts)
        self.assertEqual(len(self.hub.recent), 2)

    def test_presence_only_heartbeat_and_atomic_telemetry(self):
        q = self.hub.subscribe()
        snapshot = q.get()[1]
        self.hub.set_connector(state='connected', syncedIds=['guan'])
        telemetry = q.get()[1]
        self.hub.set_connector(state='error', syncedIds=[])
        self.assertEqual(snapshot['connector']['state'], 'not_configured')
        self.assertEqual(telemetry['connector']['state'], 'connected')
        self.hub.publish(self.hub.validate({'type': 'heartbeat', 'agent': 'guan'}))
        self.assertEqual(self.hub.last['guan']['type'], 'presence')
        self.assertEqual(len(self.hub.recent), 0)
        self.assertNotIn('guan', snapshot['diagnostics'])

    def test_stale_waiting_does_not_mask_new_work_or_fresh_host_observation(self):
        with patch.object(server.time, 'time', return_value=1000):
            self.send('a')
            self.send('a', 'waiting', 2)
        with patch.object(server.time, 'time', return_value=1300):
            self.send('b', state='coding')
            self.assertEqual(self.hub.last['guan']['state'], 'coding')
        with patch.object(server.time, 'time', return_value=1600):
            observed = self.hub.publish(self.hub.validate({'agent':'guan', 'source':'grokbot-gateway',
                                                          'state':'idle', 'text':'主机当前确认空闲'}))
            self.assertEqual(observed['current']['state'], 'idle')
            self.assertEqual({t['phase'] for t in observed['current']['tasks']}, {'waiting', 'started'})
            self.assertEqual(len(self.hub.tasks.items), 2)

    def test_persistence_restores_tasks_receipts_and_archived_ids(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'STATE_PATH', Path(directory) / 'state.json'):
            self.hub.persist = True
            self.send('a')
            self.send('b')
            self.send('a', 'completed', 2)
            restored = server.Hub(server.load_office(), persist=True)
            self.assertEqual(len(restored.tasks.for_agent('guan')), 2)
            self.assertEqual(restored.last['guan']['text'], 'b:started')
            self.hub = restored
            self.assertTrue(self.send('a', 'completed', 2)['duplicate'])
            for i in range(42):
                self.send(f'archive{i}')
                self.send(f'archive{i}', 'completed', 2)
            self.hub = server.Hub(server.load_office(), persist=True)
            with self.assertRaises(server.EventError):
                self.send('a', revision=6)
            self.assertTrue(self.hub.tasks.current('guan'))

    def test_bad_types_are_rejected_and_old_saved_data_is_compatible(self):
        for payload in ({'type': []}, {'agent': 'guan', 'state': []},
                        {'type': 'task', 'agent': 'guan', 'phase': [], 'revision': True}):
            with self.assertRaises(server.EventError):
                self.hub.validate(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(server, 'STATE_PATH', Path(directory) / 'state.json'):
            for data in ([], {'last': [], 'tasks': [{'agent': []}], 'diagnostics': [], 'receipts': []},
                         {'last': {'guan': {'type': 'status', 'agent': 'guan', 'state': 'coding', 'ts': 1}}}):
                server.STATE_PATH.write_text(json.dumps(data))
                restored = server.Hub(server.load_office(), persist=True)
                self.assertEqual(len(restored.tasks.items), 0)

    def test_active_limit_and_source_namespacing(self):
        self.send('a')
        self.send('a', source='external')
        self.assertEqual(len(self.hub.tasks.items), 2)
        for i in range(30):
            self.send(f't{i}')
        with self.assertRaises(server.EventError):
            self.send('over-limit')


# Reuse only setup/teardown, without inheriting and rerunning all reporting tests.
class TaskHTTPTest(unittest.TestCase):
    setUp = test_reporting.ReportingTest.setUp
    tearDown = test_reporting.ReportingTest.tearDown

    def test_cli_protocol_and_diagnostic_auth(self):
        client = OfficeClient(self.url, self.token, agent='guan')
        payload = {'type': 'task', 'taskId': 'http-task', 'eventId': 'http-event', 'revision': 1,
                   'phase': 'started', 'text': '真实测试任务', 'state': 'coding'}
        self.assertEqual(client.report(payload)['taskId'], 'http-task')
        self.assertTrue(client.report(payload)['duplicate'])
        with self.assertRaises(ReportError):
            client.report({**payload, 'text': '冲突'})
        diagnostic = client.request('/api/diagnostics')
        self.assertEqual(diagnostic['bots']['guan']['rejectedCount'], 1)
        with self.assertRaises(ReportError):
            OfficeClient(self.url, 'wrong').request('/api/diagnostics')
        with self.assertRaises(ReportError):
            OfficeClient(self.url, 'wrong').request('/api/events', {**payload, 'agent': 'guan'})
        self.assertEqual(self.server.hub.diagnostics['guan']['rejectedCount'], 1)
        for path in ('/grokbot_gateway.py', '/task_state.py', '/grokbot-gateway.local.json'):
            with self.assertRaises(ReportError):
                client.request(path)
