"""Task lifecycle reducer. All mutations run under Hub.lock.

Tasks are keyed by bot, source and task ID. A terminal task cannot be resurrected
by a delayed progress report; a new run must use a new ID.
"""
from __future__ import annotations
import math
import re

ACTIVE = {'started', 'progress', 'waiting'}
TERMINAL = {'completed', 'failed', 'cancelled'}
PHASES = ACTIVE | TERMINAL
MAX_ACTIVE = 32
MAX_FINISHED = 40
MAX_TOMBSTONES = 4096
SOURCES = {'reporter': 'Bot 主动上报', 'external': '外部事件接入', 'grokbot-gateway': 'Grokbot 主机只读采集'}


def task_key(event):
    return '\x1f'.join((event['agent'], event['source'], event['taskId']))


class TaskConflict(ValueError):
    pass


class TaskStore:
    def __init__(self):
        self.items = {}
        self.closed = {}

    def check(self, event):
        if task_key(event) in self.closed:
            raise TaskConflict('任务已归档；新任务请使用新的 taskId。')
        old = self.items.get(task_key(event))
        if old:
            if event['revision'] <= old['revision']:
                return 'outdated'
            if old['phase'] in TERMINAL:
                raise TaskConflict('任务已结束；新任务请使用新的 taskId。')
            if event['phase'] == 'started':
                raise TaskConflict('任务已经开始，请发送 progress 或使用新的 taskId。')
        elif event['phase'] != 'started':
            raise TaskConflict('找不到此任务的开始记录，请先发送 started。')
        elif sum(t['agent'] == event['agent'] and t['phase'] in ACTIVE for t in self.items.values()) >= MAX_ACTIVE:
            raise TaskConflict('此 Bot 同时进行的任务已达上限，请先结束已有任务。')
        return 'accept'

    def apply(self, event):
        key = task_key(event)
        old = self.items.get(key)
        state = event.get('state') or (old or {}).get('state', 'thinking')
        if event['phase'] == 'waiting':
            state = 'needsYou'
        elif event['phase'] == 'progress' and state in ('needsYou', 'error', 'idle'):
            state = 'thinking'
        elif event['phase'] in TERMINAL:
            state = 'error' if event['phase'] == 'failed' else 'idle'
        self.items[key] = {
            'agent': event['agent'], 'source': event['source'], 'taskId': event['taskId'],
            'phase': event['phase'], 'revision': event['revision'], 'state': state,
            'text': event['text'] or (old or {}).get('text', '未提供任务摘要'),
            'startedAt': (old or {}).get('startedAt', event['ts']), 'updatedAt': event['ts'],
            'finishedAt': event['ts'] if event['phase'] in TERMINAL else None,
        }
        finished = sorted((k for k, t in self.items.items() if t['agent'] == event['agent'] and t['phase'] in TERMINAL),
                          key=lambda k: self.items[k]['updatedAt'], reverse=True)
        for key in finished[MAX_FINISHED:]:
            self.closed[key] = True
            del self.items[key]
        while len(self.closed) > MAX_TOMBSTONES:
            del self.closed[next(iter(self.closed))]

    def for_agent(self, agent):
        return sorted((dict(t) for t in self.items.values() if t['agent'] == agent),
                      key=lambda t: (t['phase'] in ACTIVE, t['updatedAt']), reverse=True)

    def current(self, agent, now=None, stale_after=180):
        active = [t for t in self.items.values() if t['agent'] == agent and t['phase'] in ACTIVE]
        return max(active, key=lambda t: (now is None or now - t['updatedAt'] < stale_after,
                                         t['phase'] == 'waiting', t['updatedAt'])) if active else None

    def restore(self, items, roster):
        for t in items if isinstance(items, list) else []:
            if not isinstance(t, dict) or not all(isinstance(t.get(k), str) for k in ('agent', 'source', 'taskId', 'phase', 'text', 'state')):
                continue
            if (t['agent'] in roster and t['source'] in SOURCES and t['phase'] in PHASES
                    and re.fullmatch(r'[\w.:-]{1,128}', t['taskId'], re.ASCII)
                    and type(t.get('revision')) is int and t['revision'] > 0
                    and all(type(t.get(k)) in (int, float) and math.isfinite(t[k]) for k in ('startedAt', 'updatedAt'))
                    and t['state'] in ('coding', 'browsing', 'terminal', 'thinking', 'needsYou', 'idle', 'error')):
                self.items[task_key(t)] = dict(t)
