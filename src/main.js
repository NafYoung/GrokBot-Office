// 入口:把 world / agents / sim / renderer / ui 接起来,跑主循环。
// 数据来源有两个,谁来都行:
//   - sim.js 的随机模拟(默认)
//   - server.py 推来的真实事件(收到第一条就自动切到 Live)
import { AGENTS, DESKS } from './config.js';
import { World } from './world.js';
import { Agent } from './agent.js';
import { Simulation } from './sim.js';
import { createRenderer, lightKey, makeLight, lerpLight } from './render.js';
import { createUI } from './ui.js';

const world = new World();
const agents = AGENTS.map((c) => new Agent(c, DESKS[c.id], world));

let mode = 'now';
const light = makeLight(lightKey(mode));

const ui = createUI(agents, {
  onMode: (m) => { mode = m; },
  onToggleSim: (on) => (on ? sim.start() : sim.stop()),
});
const sim = new Simulation({ agents, onLog: (e) => ui.addLog(e) });
sim.start();

// ---- 真实事件 ----
function onLiveEvent(ev) {
  if (ui.mode !== 'live') {
    // 第一条真实事件:关掉随机模拟,大家先回工位待命
    sim.stop('Waiting for events');
    ui.clearLog(); // 去掉切换前模拟产生的假记录,日志里只留真实事件
    ui.setMode('live');
  }
  if (!sim.applyEvent(ev)) console.warn('[office] ignored event', ev);
}

function connectLive() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/events/stream');
  es.addEventListener('event', (e) => onLiveEvent(JSON.parse(e.data)));
  // 刷新页面后,服务器会先发一份每个 bot 的最新状态
  es.addEventListener('snapshot', (e) => JSON.parse(e.data).forEach(onLiveEvent));
  // 没有 server.py(比如用 python -m http.server 打开)时会 404,EventSource 会进入 CLOSED,
  // 此时保持纯模拟模式;连接中断则浏览器会自动重连。
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) console.info('[office] no live feed, staying in simulation'); };
}
connectLive();

const canvas = document.getElementById('office');
const renderer = createRenderer(canvas, agents);
new ResizeObserver(() => renderer.resize()).observe(canvas);

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1); // 切标签页回来时不要一次性跳很多
  last = now;
  sim.update(dt);
  for (const a of agents) a.update(dt);
  lerpLight(light, lightKey(mode), Math.min(1, dt * 3));
  renderer.draw(now / 1000, light);
  ui.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 控制台调试:office.sim.applyEvent({type:'status', agent:'atlas', state:'coding', text:'x'})
window.office = { world, agents, sim };
