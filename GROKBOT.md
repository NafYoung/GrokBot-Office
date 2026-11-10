# 把 Grok Bot 接到办公室

前提：这台机器上能跑 `curl`，并且办公室已启动：

```bash
python3 server.py --host 0.0.0.0 --port 8787
```

口令用环境变量，不要写进这份提示词、不要写进 `text`：

```bash
export OFFICE_TOKEN="$(cat ~/.config/grokbot-office/token)"
```

## 它是怎么连的

```
Bot --curl POST /api/events--> 本服务器（校验）--SSE--> 浏览器里的办公室
```

- 字段名是 **`agent`**（不是 bot / name）。
- 第一条真实事件不会自动打开演示；页面默认就是实时模式。
- 没发事件的工位会显示未知或未连接，不要靠随机走动假装在干活。
- 设了 `OFFICE_TOKEN` 时，POST 必须带 `Authorization: Bearer <token>`。

## Prompt for Grok Bot

```text
I run a live virtual office that shows what each of my bots is doing. Report work to it.

Server: http://127.0.0.1:8787  (use curl; if OFFICE_TOKEN is set, send Authorization: Bearer <token>)

1. Discover valid bot ids and states:
   curl -s http://127.0.0.1:8787/api/agents

2. When a bot starts or changes work, send a status event. The field is called "agent":
   curl -s -X POST http://127.0.0.1:8787/api/events \
     -H 'Content-Type: application/json' \
     -d '{"agent":"grok","state":"coding","text":"分派下一条请求"}'

   state is one of: coding, browsing, terminal, thinking, needsYou, error, idle
   - coding    writing or editing
   - browsing  reading the web or searching
   - terminal  running commands
   - thinking  planning, waiting on a model
   - needsYou  blocked on the human
   - error     the task failed
   - idle      nothing to do. While this stays fresh, the office may show them getting coffee, stretching, or sitting on the sofa. That loafing is not a task and does not mean they are working. Do not send a fake coding state just to look busy.

3. When one bot hands work to another:
   curl -s -X POST http://127.0.0.1:8787/api/events \
     -H 'Content-Type: application/json' \
     -d '{"type":"handoff","agent":"zhuxian","to":"ziliao","text":"把资料任务交给资料员"}'

4. Team meeting:
   curl -s -X POST http://127.0.0.1:8787/api/events \
     -H 'Content-Type: application/json' \
     -d '{"type":"sync"}'

Rules:
- "text" is a short plain description, max 200 characters. Chinese is fine.
- NEVER put secrets, tokens, passwords, file contents or private personal data in "text".
- The server answers 202 on success. On 422 it lists valid ids/states; fix the event, do not retry in a loop.
- Do not send more than about one event per bot every few seconds.
- If the server is not reachable, tell me once and carry on.
- Do not invent activity. If you are not doing work, send idle or send nothing (the office will show stale/offline).
```

## 事件格式

| type | 必填 | 可选 | 画面 |
|---|---|---|---|
| `status`（默认） | `agent`, `state` | `text` | 回工位、显示状态和文案 |
| `handoff` | `agent`, `to` | `text`, `state` | 走到对方工位交接再回来 |
| `sync` | 无 | 无 | Grok Bot 召集全员到前台开会 |

`agent` 可以写 id（`grok`）或显示名（`Grok Bot` / `主线学习总管`），不分大小写。
JD调研 会进 `diaoyan`（调研简报）。`python-roadmap`、论文证据核对员已撤席，会 422。

当前主工位：`grok` `newbee` `guan` `diaoyan` `zhuxian` `zhishiku` `mianshi` `qiwen`。
按需助手：`ziliao` `shiyan` `yanshou`。按需工具：`eggbot`。

名单只来自 `src/config.js`。改完重启 `server.py`。

## 自己试

```bash
python3 server.py --host 0.0.0.0 --port 8787
# 浏览器打开 http://127.0.0.1:8787/
curl -s -X POST http://127.0.0.1:8787/api/events \
  -H 'Content-Type: application/json' \
  -d '{"agent":"grok","state":"needsYou","text":"请确认下一步学习块"}'
```

云端 Bot 够不到你的 `127.0.0.1`。需要对外暴露时务必设 `OFFICE_TOKEN`。本仓库不负责装隧道。
