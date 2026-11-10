# YOUNG NAF 的 Bot 办公室

等距工位看板：每个 bot 有自己的座位，真实事件来了会走路、显示任务浮泡。
**默认不是演戏。** 没收到事件就显示未知 / 未连接 / 过期 / 离线。示例数据只出现在明确标记的演示模式。

Owner：YOUNG NAF。浏览器里不依赖 CDN 或 npm。

## 启动

只需要 Python 3（标准库）：

```bash
cd ~/GrokBot-Office   # 或本仓库目录
python3 server.py --host 0.0.0.0 --port 8787
# 本机打开 http://127.0.0.1:8787/
```

局域网其它设备用这台机器的 IP 加 `:8787`。不要把 token 写进命令行历史以外的聊天或仓库。

可选口令（推荐在 `0.0.0.0` 上开着时设置）：

```bash
export OFFICE_TOKEN="$(cat ~/.config/grokbot-office/token)"   # 在你自己的电脑上读，不要发给别人
python3 server.py --host 0.0.0.0 --port 8787
```

服务器不会去读那份 token 文件；只认环境变量 `OFFICE_TOKEN`。

## 默认是实时，演示要自己开

| 模式 | 怎么进 | 画面上会看到 |
|---|---|---|
| 实时（默认） | 直接打开页面 | 「等待事件」；没数据就是未知/未连接 |
| 演示 | 点「进入演示模式」，或 `http://127.0.0.1:8787/?demo=1` | 顶部黄条：**演示模式 · 示例数据，不是实时状态** |

演示不会向 `/api/events` 写数据。退出演示后恢复真实快照。

验收过期/离线（不用真等 3/15 分钟）：

```
http://127.0.0.1:8787/?stale=3&offline=8
```

发一条事件，等几秒就会从「实时」变成「过期」再变成「离线」。

## 连接 Grok Bot

事件契约没变：`POST /api/events`，字段名是 **`agent`**，成功 **202**。完整提示词见 [GROKBOT.md](GROKBOT.md)。

```bash
curl -s -X POST http://127.0.0.1:8787/api/events \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $OFFICE_TOKEN" \
  -d '{"agent":"grok","state":"coding","text":"分派下一条请求"}'
```

没设 `OFFICE_TOKEN` 时可以不带 Authorization。`text` 会显示在屏幕上，不要放密钥。

| type | 作用 |
|---|---|
| `status`（默认） | 回工位并显示状态 |
| `handoff` | 走到对方工位交接 |
| `sync` | Grok Bot 召集全员到前台开会 |

`state`：`coding` `browsing` `terminal` `thinking` `needsYou` `error` `idle`

先查合法 id：`GET /api/agents`。

## 工位怎么排

主工位八席（改 `src/config.js` 的 `AGENTS` 即可）：

| id | 名字 | 说明 |
|---|---|---|
| grok | Grok Bot | 前台总管，召集开会 |
| newbee | newbee naf | 个人助理 |
| guan | 观世界 | AI 资讯 |
| diaoyan | 调研简报 | 席位保留，当前按未连接显示 |
| zhuxian | 主线学习总管 | 主线教务 |
| zhishiku | 知识库 | 知识管理 |
| mianshi | 面试陪练 | 席位保留，当前按未连接显示 |
| qiwen | 奇闻异事 | 观点闲聊 |

按需助手不占主席，坐休息区：`ziliao` 主线资料员、`shiyan` 主线实验助教、`yanshou` 主线验收员。
`eggbot`（Dr Eggbot）是按需设计工具，默认不站楼面，有事件才出现。
Python Roadmap、论文证据核对员已撤席。JD调研已合并到调研简报（别名仍可用）。

## 新鲜度

| 显示 | 含义 |
|---|---|
| 未知 | 预期会联系，但还没收到过事件 |
| 未连接 | 配置里保留了席位，当前不在可联系名单 |
| 实时 | 最近 `staleAfterSec`（默认 180 秒）内有事件 |
| 过期 | 超过 180 秒没新事件，仍显示上次工作内容 |
| 离线 | 超过 900 秒没新事件 |

屏幕发光只在「实时 + 正在工作」。未知、未连接、过期、离线的人留在座位上，不会自己走动。

实时并且状态是空闲时，人会自己去倒咖啡、伸懒腰或在沙发坐一会儿。浮泡和名单会写成「摸鱼」，工作状态仍是空闲，也不会写进最近活动。这不是新任务。

刷新页面会从内存或本地 `data/office-state.json` 恢复上次状态，不会假装大家正在打字。

长时间同一状态也想保持「在岗」，请偶尔再发一条 `idle` 或当前 state，否则会过期。这是故意的。

## 结构

```
server.py        静态页面 + 事件校验 + SSE（标准库）
src/config.js    唯一名单来源：谁、坐哪、新鲜度、演示文案
src/presence.js  未知/过期/离线
src/ambient.js   实时空闲时的摸鱼（咖啡、伸展、沙发）
src/world.js     格子 + 寻路
src/agent.js     走路动作队列
src/sim.js       演示随机排班 + applyEvent(真实事件)
src/render.js    等距渲染、任务浮泡
src/ui.js        中文面板、桌面/手机布局
```

## 测试

```bash
node --test "tests/*.test.mjs"                       # Node 22+
python3 -m unittest discover -s tests -p "test_*.py"
```

## 已知限制

- 2D Canvas 等距，不是真 3D。
- 云端 Bot 访问不到你电脑的 `127.0.0.1`。需要对外暴露时务必设 `OFFICE_TOKEN`；本仓库不安装隧道。
- 本机 token 文件在 `~/.config/grokbot-office/token`，由你自己导出到环境变量。
