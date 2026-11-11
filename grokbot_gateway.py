"""Optional, read-only Grokbot host adapter (community gateway protocol).

Only listAgents/getAsyncTasks/getSubagents are called. No chat, creation,
interrupt, transcript, credential-store or filesystem mutation commands exist
in this adapter. See GROKBOT.md for compatibility and setup boundaries.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import Counter
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener
from office_report import NoRedirect, normalize_url, ReportError

READ_COMMANDS = frozenset(('listAgents', 'getAsyncTasks', 'getSubagents'))
MAX_RESPONSE = 2 * 1024 * 1024


class GatewayError(Exception):
    pass


def load_config(filename):
    try:
        path = Path(filename).expanduser()
        config = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(config, dict) or set(config) - {'gatewayUrl', 'tokenFile', 'discoveryFile', 'mappings', 'intervalSeconds'}:
            raise ValueError()
        config['_base'] = path.parent
        mappings = config.get('mappings', {})
        if not isinstance(mappings, dict) or len(mappings) > 128 or not all(isinstance(k, str) and isinstance(v, str) for k, v in mappings.items()):
            raise ValueError()
        interval = config.get('intervalSeconds', 15)
        if type(interval) not in (int, float) or not 5 <= interval <= 300:
            raise ValueError()
        return config
    except (OSError, UnicodeError, ValueError, TypeError) as exc:
        raise GatewayError('网关配置无法读取或字段不正确，请检查本机配置文件。') from exc


class GatewayClient:
    def __init__(self, config):
        self.config = config
        self.opener = build_opener(NoRedirect())

    def _path(self, value):
        p = Path(value).expanduser()
        return p if p.is_absolute() else self.config['_base'] / p

    def credentials(self):
        c = self.config
        url = c.get('gatewayUrl')
        token = os.environ.get('GROKBOT_GATEWAY_TOKEN', '').strip()
        try:
            if c.get('discoveryFile'):
                # Read only the explicitly selected file; never scan accounts or disks.
                discovery = json.loads(self._path(c['discoveryFile']).read_text(encoding='utf-8'))
                host = discovery.get('host', '127.0.0.1')
                if host in ('0.0.0.0', '::', '[::]'):
                    host = '127.0.0.1'
                port = discovery['port']
                if type(port) is not int or not 1 <= port <= 65535 or not isinstance(host, str):
                    raise ValueError()
                host = f'[{host}]' if ':' in host and not host.startswith('[') else host
                discovered_url = f"{discovery.get('scheme', 'http')}://{host}:{port}"
                # Do not send a discovery file's token to an unrelated override URL.
                if url and normalize_url(url) != normalize_url(discovered_url):
                    raise GatewayError('gatewayUrl 与 discoveryFile 指向不同主机，请只配置一种来源。')
                url = discovered_url
                token = token or discovery.get('token', '')
            if c.get('tokenFile'):
                token = token or self._path(c['tokenFile']).read_text(encoding='utf-8').strip()
            if not isinstance(token, str) or not token or '\n' in token or '\r' in token:
                raise GatewayError('缺少网关口令；请使用本机 tokenFile、discoveryFile 或 GROKBOT_GATEWAY_TOKEN。')
            if not isinstance(url, str):
                raise ValueError()
            return normalize_url(url), token
        except GatewayError:
            raise
        except (OSError, UnicodeError, ValueError, KeyError, TypeError, ReportError) as exc:
            raise GatewayError('无法读取网关地址或口令文件；远程网关需 HTTPS，本机转发可用 loopback HTTP。') from exc

    def read(self, command, body=None):
        if command not in READ_COMMANDS:
            raise GatewayError('此适配器只允许读取运行状态。')
        url, token = self.credentials()
        req = Request(url + '/api/' + command, data=json.dumps(body or {}).encode(), headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
            'Accept': 'application/json', 'x-sand-slim-avatars': '1',
        })
        try:
            with self.opener.open(req, timeout=5) as response:
                if response.status != 200:
                    raise GatewayError('网关响应状态不符合协议。')
                raw = response.read(MAX_RESPONSE + 1)
                if len(raw) > MAX_RESPONSE:
                    raise GatewayError('网关响应过大，未更新 Bot 状态。')
                result = json.loads(raw)
                if not isinstance(result, list) or len(result) > 512 or not all(isinstance(x, dict) for x in result):
                    raise GatewayError('网关响应结构不兼容，未更新 Bot 状态。')
                return result
        except HTTPError as exc:
            labels = {401: '网关口令被拒绝', 403: '网关读取权限不足', 404: '当前主机不支持所需状态接口', 429: '网关请求限流'}
            raise GatewayError(labels.get(exc.code, f'网关返回 HTTP {exc.code}；未更新状态。')) from exc
        except (URLError, OSError, TimeoutError) as exc:
            raise GatewayError('无法连接 Grokbot 运行主机；请检查主机在线状态、网关地址或隧道。') from exc
        except (ValueError, UnicodeError) as exc:
            raise GatewayError('网关没有返回有效 JSON，未更新 Bot 状态。') from exc


def observed_status(row, tasks, subagents):
    if (type(row.get('isRunning')) is not bool or type(row.get('isComposingMessage')) is not bool
            or 'awaitingUserResponse' not in row):
        raise GatewayError('Bot 运行状态字段缺失，未猜测忙闲。')
    if not all(t.get('status') == 'running' and isinstance(t.get('id'), str) for t in tasks):
        raise GatewayError('后台任务状态格式不兼容，未猜测任务是否结束。')
    if not all(isinstance(t.get('status'), str) for t in subagents):
        raise GatewayError('子智能体状态格式不兼容。')
    subs = sum(t['status'] == 'running' for t in subagents)
    busy = row['isRunning'] or row['isComposingMessage'] or bool(tasks) or subs > 0
    waiting = row['awaitingUserResponse'] is not None and row['awaitingUserResponse'] is not False
    if waiting:
        return 'needsYou', '运行主机报告正在等待你的回复或确认'
    if busy:
        suffix = f"；后台任务 {len(tasks)} 项，运行中子智能体 {subs} 个" if tasks or subs else '；未提供具体任务内容'
        return 'thinking', '运行主机确认正在工作' + suffix
    return 'idle', '运行主机确认当前没有执行中的任务（不代表上一任务已成功）'


class GatewayBridge:
    def __init__(self, hub, filename):
        self.hub = hub
        self.filename = filename
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, name='grokbot-read-only-bridge', daemon=True)

    def start(self):
        self.thread.start()

    def close(self):
        self.stop_event.set()

    def poll(self, client, config):
        rows = client.read('listAgents')
        if not all(isinstance(r.get('id'), str) and isinstance(r.get('name'), str) for r in rows):
            raise GatewayError('网关名单缺少 Bot ID 或名字，未执行自动匹配。')
        ids = Counter(r['id'] for r in rows)
        if any(n > 1 for n in ids.values()):
            raise GatewayError('网关名单包含重复 ID，未执行自动匹配。')
        mappings = config.get('mappings', {})
        if any(v not in self.hub.roster for v in mappings.values()):
            raise GatewayError('mappings 包含未知工位 ID，请按办公室当前名单修改。')
        reserved = set(mappings.values())
        candidates = []
        for row in rows:
            if row.get('isGroup'):
                continue
            aid = mappings.get(row['id'])
            if aid is None:
                candidate = self.hub.resolve(row['name'])
                aid = candidate if candidate not in reserved else None
            candidates.append((row, aid))
        counts = Counter(aid for _, aid in candidates if aid)
        unmapped, ambiguous, failed, synced = [], [], [], []
        unmapped_agents, ambiguous_agents = [], []
        for row, aid in candidates:
            if self.stop_event.is_set():
                return
            if not aid:
                unmapped.append(row['name'][:80])
                unmapped_agents.append({'id': row['id'][:128], 'name': row['name'][:80]})
                continue
            if counts[aid] > 1:
                ambiguous.append(row['name'][:80])
                ambiguous_agents.append({'id': row['id'][:128], 'name': row['name'][:80]})
                continue
            try:
                tasks = client.read('getAsyncTasks', {'id': row['id']})
                subs = client.read('getSubagents', {'id': row['id']})
                state, text = observed_status(row, tasks, subs)
                if self.stop_event.is_set():
                    return
                event = self.hub.validate({'type': 'status', 'agent': aid, 'state': state, 'text': text,
                                           'source': 'grokbot-gateway', 'nativeId': row['id']})
                self.hub.publish(event)
                synced.append(aid)
            except GatewayError as exc:
                failed.append(f"{self.hub.roster[aid]}：{exc}")
            except Exception:
                # Do not leak upstream payloads, tokens or exception traces into the UI.
                failed.append(f'{self.hub.roster[aid]}：状态结构不兼容，未更新')
        partial = bool(failed or ambiguous or unmapped or not synced)
        self.hub.set_connector(state='partial' if partial else 'connected', lastSuccessAt=time.time(),
                               syncedAgents=len(synced), syncedIds=synced, unmappedNames=unmapped[:20], ambiguousNames=ambiguous[:20],
                               unmappedAgents=unmapped_agents[:20], ambiguousAgents=ambiguous_agents[:20],
                               message='；'.join(failed[:3]) if failed else f'已读取运行主机，{len(synced)} 个 Bot 与工位匹配并同步。未匹配成员不会自动冒用其他工位。')

    def run(self):
        self.hub.set_connector(state='connecting', message='正在读取 Grokbot 主机状态…')
        while not self.stop_event.is_set():
            interval = 15
            try:
                config = load_config(self.filename)
                interval = config.get('intervalSeconds', 15)
                self.poll(GatewayClient(config), config)
            except GatewayError as exc:
                self.hub.set_connector(state='error', message=str(exc), syncedAgents=0, syncedIds=[])
                interval = max(interval, 30)
            except Exception:
                self.hub.set_connector(state='error', message='采集器遇到不兼容响应，已停止本轮状态更新。', syncedAgents=0, syncedIds=[])
                interval = 30
            self.stop_event.wait(interval)
