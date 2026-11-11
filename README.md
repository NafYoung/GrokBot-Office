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

设置口令后，网页会显示「解锁办公室」。输入口令后，浏览器通过有效期 12 小时的
HttpOnly、SameSite 会话读取实时状态；口令不会写进 URL 或浏览器本地存储。
API 的读取（包括 `/api/agents`、`/api/office` 和事件流）也需要认证；命令行继续使用
`Authorization: Bearer $OFFICE_TOKEN`。浏览器会话只允许读取，不能代替 Bot 的上报口令。
未设置口令时仍可直接访问。对外部署请通过 HTTPS 反向代理访问。

静态服务只开放页面、样式和前端 JS，不开放仓库、目录列表和状态文件。

## 默认是实时，演示要自己开

| 模式 | 怎么进 | 画面上会看到 |
|---|---|---|
| 实时（默认） | 直接打开页面 | 「等待事件」；没数据就是未知/未连接 |
| 演示 | 点「进入演示模式」，或 `http://127.0.0.1:8787/?demo=1` | 顶部黄条：**演示模式 · 示例数据，不是实时状态** |
| 休息演示 | 点「看看休息日常」，或 `http://127.0.0.1:8787/?demo=idle` | 顶部黄条：**休息演示 · 空闲活动示例，不是实时状态**；只看休息，不安排假任务 |

演示不会向 `/api/events` 写数据。退出演示后恢复真实快照。

验收过期/离线（不用真等 3/15 分钟）：

```
http://127.0.0.1:8787/?stale=3&offline=8
```

发一条事件，等几秒就会从「实时」变成「过期」再变成「离线」。

## 连接 Grok Bot

名单、名字和工位来自 `src/config.js`，不是从 Grokbot 应用自动同步的。仓库提供状态接收服务和 `office_report.py` 上报器；在页面右侧展开「连接 Grokbot 的真实任务」，选择具体 Bot，生成对应当前电脑、端口和工位 ID 的专属规则，直接保存到这个 Bot 的长期指令中，再通过它已连接的本机 Shell 上报。每个成员需要分别配置，主 Bot 的规则与工具权限不会自动继承给其他 Bot。

已有的「机器人办公室面板」Webhook 只处理点击通知，不会自动触发普通聊天任务的状态同步。不要沿用旧电脑的 machineId 或旧端口；生成器会给出当前配置。具体设置与旧 Webhook 的修订见 [GROKBOT.md](GROKBOT.md)。生成配置不会自动修改 Grokbot 应用。

页面会分别说明办公室服务是否连上、是否收到 Bot 的任务状态。仅打开网页、收到交接事件或进入演示，都不代表真实任务已经同步。完整验收需要在 Grokbot 应用内执行任务，确认开始、完成和失败状态到达对应工位；测试脚本的 HTTP 上报只验证办公室接收端。

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

先查合法 id：`GET /api/agents`（设了口令时同样带 Authorization）。

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

角色采用圆润小机器人造型，办公室人物和侧栏头像共用同一套绘制。可在 `src/config.js` 中修改各角色的 `color` 和 `look`：`accessory` 控制耳机、眼镜、天线等配饰，`badge` 控制胸前图标。
机器人会眨眼、随步伐摆动手脚；休息时露出笑眼，需要帮助或出错时改变表情，非实时状态则变暗。点击人物头部也可以选中。

## 新鲜度

| 显示 | 含义 |
|---|---|
| 未知 | 预期会联系，但还没收到过事件 |
| 未连接 | 配置里保留了席位，当前不在可联系名单 |
| 实时 | 最近 `staleAfterSec`（默认 180 秒）内有事件 |
| 过期 | 超过 180 秒没新事件，仍显示上次工作内容 |
| 离线 | 超过 900 秒没新事件 |

屏幕发光只在「实时 + 正在工作」。未知、未连接、过期、离线的人留在座位上，不会自己走动。

联系时间与任务上报时间分开计算：新交接只刷新发起者的联系时间，不会把旧任务变成最新，也不代表接收者已经开始工作。若有新联系但任务超时，显示「在岗 · 任务状态过期」，旧内容保留供查看，不计入当前工作、空闲或告警数。任务列表标出任务时间，详情另显示联系时间。

交接和会议文字只属于活动动画，不覆盖真实工作内容；连续交接、会议互相打断也不会留下旧动画状态。全员同步只带动最近有联系的成员，主持人未知或过期时不播放会议。

实时并且 `idle` 上报仍新鲜时，Bot 会在 2–7 秒后自己起来活动：

- 喝咖啡：走到咖啡区，端杯喝几口，杯子冒着热气，再带回工位。
- 伸懒腰：去空地活动肩膀和手臂。
- 休息区坐坐：在休息位坐下放空一会儿，再走回座位。
- 散步：沿可走的通道溜达，停下来看看四周。

每次回来停留 6–14 秒，再挑下一种活动；休息位置有人时会换位置。
浮泡和名单会写成「摸鱼」，工作状态仍是空闲，也不会写进最近活动。
新任务会立即更新状态并打断休息，过期或离线则停止活动、回到座位。
手机上默认最多显示一个休息气泡；点选 Bot 可以查看它当前的活动。

还没接入 Bot 时，点「看看休息日常」即可预览这些动作；预览不会向服务器写入事件。

刷新页面会从内存或本地 `data/office-state.json` 恢复上次状态，不会假装大家正在打字。
只有交接事件、尚未上报工作状态的 bot 会恢复为「在岗 · 未上报状态」，不会自动摸鱼。

事件流连接和重连时，会在同一个 `snapshot` 消息中恢复状态与最近活动。
消息内容是包含 `last`、`recent`、`lastSeen`、`seq`、`epoch` 等字段的对象；
后续 `event` 带有服务器分配的 `seq` 和 `epoch`。`POST /api/events` 的字段和 202 响应保持兼容。
旧版 SSE 客户端若直接遍历快照数组，需要改为遍历 `snapshot.last`。

页面首次检查服务失败、请求超时或事件流因 HTTP 错误关闭后，会自动重试（间隔逐步增加，最多 15 秒）。退出真实模式会取消重试；口令失效时等待重新解锁。

长时间同一状态也想保持「在岗」，请偶尔再发一条 `idle` 或当前 state，否则会过期。这是故意的。

## 结构

```
server.py        静态页面 + 事件校验 + SSE（标准库）
integration.py   根据实际电脑、端口和名单生成长期上报规则（不含密钥）
office_report.py Grokbot Shell 上报工具：check / agents / report
src/config.js    唯一名单来源：谁、坐哪、新鲜度、演示文案
src/presence.js  未知/过期/离线
src/ambient.js   实时空闲时的摸鱼（咖啡、伸展、坐坐、散步）与休息位占用
src/world.js     格子 + 寻路
src/agent.js     走路动作队列
src/sim.js       演示随机排班 + applyEvent(真实事件)
src/render.js    等距渲染、任务浮泡
src/robot.js     圆润机器人、表情和动作、共用头像
src/ui.js        中文面板、桌面/手机布局
src/integration.js  页面内生成、复制接入规则
```

## 测试

```bash
node --test "tests/*.test.mjs"                       # Node 22+
python3 -m unittest discover -s tests -p "test_*.py"
```

可选浏览器回归（需要另行安装 Python Playwright 与 Chromium，不影响运行时零依赖）：

```bash
python3 tests/browser_checks.py --screenshots /tmp/grokbot-office-shots
```

覆盖口令登录、断线重连、演示切换、按需工具恢复，以及桌面和多种手机/平板尺寸。

## 已知限制

- 2D Canvas 等距，不是真 3D。
- 云端 Bot 访问不到你电脑的 `127.0.0.1`。需要对外暴露时务必设 `OFFICE_TOKEN`；本仓库不安装隧道。
- 本机 token 文件在 `~/.config/grokbot-office/token`，由你自己导出到环境变量。
