# Connect your Grok Bot to the Virtual Office

> 把下面 "Prompt for Grok Bot" 整段发给 Grok Bot 即可。前提:Grok Bot 能在**这台 Mac 上**执行 shell 命令(`curl`),
> 并且办公室服务器在运行:`cd grokbot-office && python3 server.py`。

## 它是怎么连的

```
Grok Bot --curl POST--> http://127.0.0.1:8787/api/events --校验--> 浏览器里的办公室
```

- 服务器只监听 `127.0.0.1`,只有本机进程能发事件。
- 第一条真实事件到达时,页面自动从 Simulation 切到 **Live**,随机模拟停止。
- 想加口令:启动前 `export OFFICE_TOKEN=xxxx`,然后请求要带 `-H "Authorization: Bearer xxxx"`。口令不要写进聊天记录或代码里。

## Prompt for Grok Bot

```text
I run a live "virtual office" that shows what each of my bots is doing. Please report your work to it.

Server: http://127.0.0.1:8787  (runs on this Mac; use curl)

1. First, discover the valid bot ids and states:
   curl -s http://127.0.0.1:8787/api/agents

2. Whenever a bot starts or changes what it is doing, send a status event:
   curl -s -X POST http://127.0.0.1:8787/api/events \
     -H 'Content-Type: application/json' \
     -d '{"agent":"atlas","state":"coding","text":"Drafting meeting invites"}'

   state is one of: coding, browsing, terminal, thinking, needsYou, error, idle
   - coding    writing or editing code/documents
   - browsing  reading the web or searching
   - terminal  running commands
   - thinking  planning, waiting on a model
   - needsYou  blocked until the human approves or answers   (shows an orange alert)
   - error     the task failed                                (shows a red alert)
   - idle      nothing to do

3. When one bot hands work to another bot, send a handoff (the bot physically walks to the other's desk):
   curl -s -X POST http://127.0.0.1:8787/api/events \
     -H 'Content-Type: application/json' \
     -d '{"type":"handoff","agent":"fetch","to":"claim","text":"Dropped off a parcel for Claim"}'

4. When all bots are coordinated together (a team meeting), send:
   curl -s -X POST http://127.0.0.1:8787/api/events -H 'Content-Type: application/json' -d '{"type":"sync"}'

Rules:
- "text" is a short plain-English description, max 200 characters.
- NEVER put secrets, tokens, passwords, file contents or private personal data in "text". It is shown on screen.
- The server answers 202 on success. On 422 it tells you the valid ids/states; fix the event, do not retry in a loop.
- Do not send more than about one event per bot every few seconds.
- If the server is not reachable, tell me once and carry on with your normal work.
```

## 事件格式参考

| type | 必填字段 | 可选 | 画面效果 |
|---|---|---|---|
| `status`(默认) | `agent`, `state` | `text` | 该 bot 回工位、显示状态和文案 |
| `handoff` | `agent`, `to` | `text`, `state` | 带包裹走到对方工位,交接后回来,状态恢复原样 |
| `sync` | 无 | 无 | Alfred 召集全员进办公室开会,散会后恢复各自状态 |

`agent` 可以写 id(`atlas`)或显示名(`Drone Business`),不分大小写。有哪些 bot 由 `src/config.js` 的 `AGENTS` 决定,
**如果你真实的 bot 名字和这 8 个不同,改 `AGENTS`(和 `DESKS`)就行**,服务器会自动读取新名单。

## 自己试一下(不需要 Grok Bot)

```bash
python3 server.py                      # 终端 1
open http://127.0.0.1:8787             # 浏览器
curl -s -X POST http://127.0.0.1:8787/api/events \
  -H 'Content-Type: application/json' \
  -d '{"agent":"atlas","state":"needsYou","text":"Approve the budget?"}'
```

## 如果 Grok Bot 其实跑在云端

云端的 Bot 访问不到你电脑上的 `127.0.0.1`。那就需要把本机端口暴露出去(例如 Cloudflare Tunnel),
**并且必须设置 `OFFICE_TOKEN`**,否则互联网上任何人都能往你的办公室发事件。需要时再做,先别开放。
