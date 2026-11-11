#!/usr/bin/env python3
"""Grokbot Shell 工具使用的办公室上报器，仅依赖 Python 标准库。

check 只检查连接；report 从标准输入读取一条真实事件 JSON。
地址必须显式指定，口令只从环境变量或本机口令文件读取。
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ReportError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 不能把上报口令重定向到另一个地址。
        return None


def normalize_url(value):
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise ReportError('办公室地址的端口无效。') from exc
    if (parts.scheme not in ('http', 'https') or not parts.hostname
            or parts.username is not None or parts.password is not None
            or parts.query or parts.fragment or parts.path not in ('', '/')
            or port == 0):
        raise ReportError('请使用办公室服务的根地址，不能包含口令、路径、查询参数或演示参数。')
    loopback = parts.hostname == 'localhost'
    try:
        loopback = loopback or ipaddress.ip_address(parts.hostname).is_loopback
    except ValueError:
        pass
    if parts.scheme == 'http' and not loopback:
        raise ReportError('远程办公室请使用 HTTPS；HTTP 仅用于同一台电脑上的本机服务。')
    return value.rstrip('/')


def read_token(token_file=None):
    token = os.environ.get('OFFICE_TOKEN', '').strip()
    if token:
        return token
    path = Path(token_file).expanduser() if token_file else Path.home() / '.config/grokbot-office/token'
    try:
        return path.read_text(encoding='utf-8').strip()
    except FileNotFoundError:
        if token_file:
            raise ReportError('指定的口令文件不存在。')
        return ''
    except (OSError, UnicodeError) as exc:
        raise ReportError('无法读取办公室口令文件，请检查本机文件权限。') from exc


class OfficeClient:
    def __init__(self, url, token='', expected_machine=None, timeout=5, agent=None):
        if agent is not None and (not isinstance(agent, str) or not agent.strip()):
            raise ReportError('绑定的 Bot ID 不能为空，请重新生成专属规则。')
        self.url = normalize_url(url)
        self.token = token
        self.expected_machine = expected_machine
        self.agent = agent
        self.timeout = timeout
        self.opener = build_opener(NoRedirect())

    def request(self, path, payload=None):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        try:
            with self.opener.open(Request(self.url + path, data=data, headers=headers), timeout=self.timeout) as response:
                expected = 202 if payload is not None else 200
                if response.status != expected:
                    raise ReportError(f'办公室返回非预期状态 HTTP {response.status}，不能确认上报成功。')
                raw = response.read(256 * 1024 + 1)
                if len(raw) > 256 * 1024:
                    raise ReportError('办公室响应过大。')
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise ReportError('办公室响应不是预期的 JSON 对象。')
                return result
        except HTTPError as exc:
            if exc.code in (401, 403):
                raise ReportError('办公室拒绝认证：请在运行上报器的电脑配置正确的 OFFICE_TOKEN 或本机口令文件。') from exc
            if exc.code == 404:
                raise ReportError('办公室接口不存在：请检查端口，并更新代码、重启 server.py。') from exc
            if exc.code == 422:
                raise ReportError('事件被拒绝：请用 agents 命令核对当前 Bot 名单，检查 state 和 text；已撤席 Bot 不能上报。') from exc
            if 300 <= exc.code < 400:
                raise ReportError('办公室返回重定向，已停止发送口令；请使用最终服务地址。') from exc
            raise ReportError(f'办公室返回 HTTP {exc.code}，本次上报未确认成功。') from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise ReportError('无法访问办公室：检查运行电脑和端口。云端的 127.0.0.1 不是你的 Mac；请在办公室所在电脑执行。') from exc
        except (ValueError, UnicodeError) as exc:
            raise ReportError('该地址没有返回办公室 JSON，请检查是否连接了错误服务。') from exc

    def check(self):
        info = self.request('/api/integration')
        if info.get('protocol') != 'grokbot-office-v1' or not isinstance(info.get('machine'), str):
            raise ReportError('该地址不是受支持的办公室接收服务。')
        if self.expected_machine and info['machine'] != self.expected_machine:
            raise ReportError('连接到了另一台电脑上的办公室，已停止上报；请重新从正在看的办公室生成接入指令。')
        if self.agent and not any(a.get('id') == self.agent for a in info.get('agents', [])):
            raise ReportError('绑定的 Bot 不在当前工位名单中，请更新服务并为这个 Bot 重新生成规则。')
        return {'ok': True, 'machine': info['machine'], 'url': self.url, 'agent': self.agent,
                'message': '连接检查通过；未写入任务事件，尚不代表 Bot 已配置自动上报。'}

    def agents(self):
        self.check()
        return self.request('/api/agents')

    def report(self, payload):
        if not isinstance(payload, dict) or payload.get('type', 'status') not in ('status', 'handoff', 'sync'):
            raise ReportError('需要一条 status、handoff 或 sync 事件 JSON；点击工位的 ping 不是任务状态。')
        if set(payload) - {'type', 'agent', 'state', 'text', 'to'}:
            raise ReportError('事件仅允许 type、agent、state、text、to 字段。')
        if self.agent:
            if payload.get('type') == 'sync':
                raise ReportError('专属上报命令用于此 Bot 的状态或交接，不能用来发起全员会议。')
            if 'agent' in payload and payload['agent'] != self.agent:
                raise ReportError('事件的 agent 与专属命令绑定的 Bot 不一致，未发送；不要沿用主 Bot 的 ID。')
            payload = {**payload, 'agent': self.agent}
        if len(json.dumps(payload, ensure_ascii=False).encode('utf-8')) > 16 * 1024:
            raise ReportError('事件过大；只发送简短任务描述。')
        self.check()
        result = self.request('/api/events', payload)
        if result.get('ok') is not True or not isinstance(result.get('event'), dict):
            raise ReportError('未收到有效的事件确认，不能声明同步成功。')
        event = result['event']
        return {'ok': True, 'agent': event.get('agent'), 'state': event.get('state'), 'seq': event.get('seq')}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('OFFICE_URL'), help='正在查看的办公室服务根地址；没有默认端口')
    parser.add_argument('--expect-machine', help='接收服务所在电脑的名称，防止发到旧电脑')
    parser.add_argument('--agent', help='固定此命令对应的 Bot 工位 ID；省略事件 agent 时自动补入，冲突则拒绝')
    parser.add_argument('--token-file', help='本机口令文件路径；不在命令行传口令内容')
    parser.add_argument('command', choices=('check', 'agents', 'report'))
    args = parser.parse_args(argv)
    try:
        if not args.url:
            raise ReportError('请显式提供 --url 或 OFFICE_URL；从正在看的办公室生成接入指令，避免用错端口。')
        client = OfficeClient(args.url, read_token(args.token_file), args.expect_machine, agent=args.agent)
        if args.command == 'check':
            result = client.check()
        elif args.command == 'agents':
            result = client.agents()
        else:
            if sys.stdin.isatty():
                raise ReportError('report 需要从标准输入接收 JSON；连接检查请用 check。')
            raw = sys.stdin.buffer.read(16 * 1024 + 1)
            if len(raw) > 16 * 1024:
                raise ReportError('事件超过 16 KiB。')
            try:
                payload = json.loads(raw)
            except (ValueError, UnicodeError) as exc:
                raise ReportError('请通过标准输入提供一条有效 JSON 事件。') from exc
            result = client.report(payload)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except ReportError as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
