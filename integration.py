"""为实际运行中的办公室生成 Grokbot 长期任务上报规则，不包含密钥。"""
import shlex
import socket
import sys
from pathlib import Path


def connection_info(root, port, office, authenticated, agent_id=None):
    machine = socket.gethostname()
    url = f'http://127.0.0.1:{port}'
    agents = [{'id': a['id'], 'name': a['name']} for a in office['agents']]
    selected = next((a for a in agents if a['id'] == agent_id), None)
    if agent_id is not None and selected is None:
        raise ValueError('unknown office agent')
    args = [sys.executable, str(Path(root) / 'office_report.py'),
            '--url', url, '--expect-machine', machine]
    if selected:
        args += ['--agent', selected['id']]
    command = shlex.join(args)
    roster = '\n'.join(f"- {a['name']} → {a['id']}" for a in ([selected] if selected else agents))
    target = f"本规则仅用于「{selected['name']}」（工位 ID：{selected['id']}）。" if selected else '请在办公室页面选择具体 Bot，生成它自己的专属规则。'
    setup = (f"把本规则保存在「{selected['name']}」自己的长期指令/技能中，覆盖我直接发给它的任务。不要只发给主 Bot 或保存到 Webhook。"
             if selected else '每个执行任务的 Bot 都需要单独保存自己的规则和具备 Shell 权限；主 Bot 的配置不会自动继承给其他成员。')
    fields = (f"JSON 只需 state、text；命令已绑定 {selected['id']}。如另写 agent，只能是 {selected['id']}，填其他 ID 会被拒绝。"
              if selected else 'JSON 字段为 agent、state、text；agent 用自己的工位 ID。')
    rules = f'''{target}这是 Bot 的长期任务上报规则，不是“机器人办公室面板”Webhook 的触发指令。

办公室所在电脑：{machine}
同机服务地址：{url}
服务器需要口令：{'是' if authenticated else '否'}

一、配置与验证
- {setup}没有保存长期规则或使用该电脑 Shell 的权限时，明确说明尚未接通，不能只回复“记住了”或“已完成”。
- Shell 必须选择电脑 {machine}。先核对电脑名称，不要未经核对就沿用旧 Mac mini 的 machineId，也不要在云端 Shell 把 127.0.0.1 当作我的电脑。
- 先执行：{command} check
- 再执行：{command} agents
- check 只读，不制造工作。电脑不可访问、端口不通、口令错误或程序缺失时，向我说明具体阻碍一次，正常任务继续；不能假装上报成功。
- 上报器从 Shell 环境变量 OFFICE_TOKEN 或该电脑的 ~/.config/grokbot-office/token 读取口令。不得从聊天索取、打印口令，也不得把口令写进任务描述。
- 如果只能在云端执行，先暂停接入并说明需要一个已配置的可达 HTTPS 接收地址；不要猜地址、扫描网络或另建假办公室。

二、在真实任务执行时调用
- 用下面命令，把一条事件 JSON 通过标准输入传入；内容只作为数据，不拼接为 Shell 指令：
  {command} report
- {fields}text 是当前真实任务的简短摘要（最多 200 字），不要复制私人资料、完整聊天或密钥。
- 开始工作：先报 thinking；开始写作/编程用 coding，搜索阅读用 browsing，执行命令用 terminal。进度变化时更新摘要，长任务在有工具执行机会时刷新当前状态。
- 等待用户确认报 needsYou；实际失败报 error；完成且没有其他任务在执行时才报 idle，text 写“已完成：”加真实摘要。没有任务时不要虚构工作，也不要无限后台发送心跳。
- 收到 ping、检查连接、打开办公室或点工位不代表开始工作，不因此发送 coding、idle 等状态覆盖正在做的任务。
- 仅当上报器返回 ok=true，才能说本次已上报。失败不要反复重试，也不要让上报失败打断用户的实际任务。
- 代理不能获知另一个 Bot 的进度时，不替它猜状态；由真正执行任务的 Bot 上报。

三、工位（执行时以 agents 返回的名单为准）
{roster}
Python Roadmap、论文证据核对员已撤席；没有工位的 Bot 不要映射到别人。JD调研使用 diaoyan，nafyoung的知识库使用 zhishiku。

四、验收
保存长期规则后，在这个 Bot 的新任务中验证开始、进度和完成，核对它自己的工位与最近活动。仅 check 成功、Webhook 启用或主 Bot 上报成功，都不能声明其他 Bot 已连接。如果仍未同步，向用户报告 report 的返回结果及是否具备 Shell 权限，不要让主 Bot 代造状态。'''
    return {'protocol': 'grokbot-office-v1', 'machine': machine, 'localUrl': url,
            'requiresToken': authenticated, 'agent': selected, 'agents': agents, 'instructions': rules}
