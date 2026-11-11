// 默认是真实事件模式。初始快照和后续事件共用一条有序的 SSE 连接。
import { AGENTS, FRESHNESS } from './config.js';
import { World } from './world.js';
import { Agent } from './agent.js';
import { Simulation } from './sim.js';
import { createRenderer, lightKey, makeLight, lerpLight } from './render.js';
import { createUI } from './ui.js';
import { parseFreshnessParams } from './presence.js';
import { setupIntegration } from './integration.js';
import { eventText } from './telemetry.js';

const freshness = parseFreshnessParams(location.search, FRESHNESS);
setupIntegration();
const world = new World();
const agents = AGENTS.map((c) => new Agent(c, world));
const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
let tod = 'now';
const light = makeLight(lightKey(tod));
let es = null;
let generation = 0;
let retryTimer = null;
let retryDelay = 1000;
let sessionAbort = null;

function refreshPresence(nowSec = Date.now() / 1000) {
  sim.refreshPresence(nowSec);
}

function closeLive() {
  generation++;
  es?.close();
  es = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  sessionAbort?.abort();
  sessionAbort = null;
}

const ui = createUI(agents, {
  freshness,
  onMode: (m) => { tod = m; },
  onSelect: (id) => renderer.setSelected(id),
  onAction: (id, kind) => sim.sceneAction(id, kind),
  onDemo: (on, kind = 'work') => {
    closeLive();
    sim.stop();
    ui.clearLog();
    if (on) sim.start({ rest: kind === 'rest' });
    else startLive();
    refreshPresence();
    ui.update();
  },
});

const sim = new Simulation({
  agents, freshness,
  onLog: (e) => {
    if (Boolean(e.demo) !== (ui.mode === 'demo')) return;
    ui.addLog(e);
  },
});

const canvas = document.getElementById('office');
const renderer = createRenderer(canvas, agents);
const resizeObserver = new ResizeObserver(() => renderer.resize());
resizeObserver.observe(canvas);
resizeObserver.observe(document.querySelector('.topbar'));
canvas.addEventListener('click', (e) => {
  if (ui.feed === 'locked' && ui.mode !== 'demo') return;
  const hit = renderer.pick(e.clientX, e.clientY);
  if (hit?.kind === 'agent') ui.select(hit.agent.id);
  else if (hit?.kind === 'furniture') {
    const item = hit.item;
    if (item.agentId && item.agentId !== ui.selectedId) ui.select(item.agentId);
    else if (!ui.selectedId) ui.actionFeedback({ok:false, message:`先选一个 Bot，再点${item.label}。`});
    else ui.performAction(item.action);
  } else ui.select(null);
});
canvas.addEventListener('pointermove', e => {
  const hit = renderer.pick(e.clientX,e.clientY);
  renderer.setHovered(hit);
  canvas.style.cursor = hit ? 'pointer' : 'default';
  canvas.title = hit?.kind === 'agent' ? `选中 ${hit.agent.name}`
    : hit?.kind === 'furniture' ? (hit.item.agentId ? `${byId[hit.item.agentId].name} 的工位`
      : `${hit.item.label} · ${ui.selectedId ? '点击安排日常' : '先选一个 Bot'}`) : '';
});
canvas.addEventListener('pointerleave', () => { renderer.setHovered(null); canvas.title = ''; });

function onLiveEvent(ev, immediate = false) {
  if (ui.mode === 'demo') return;
  const current = ev.type === 'handoff' ? { ...ev, tasks: ev.current?.tasks, diagnostic: ev.current?.diagnostic }
    : ev.current || ev;
  const hadManualAction = byId[ev.agent]?.manualAction;
  if (!sim.applyEvent(current, { immediate, quiet: true, keepPose: ev.silent })) console.warn('[office] ignored event', ev);
  if (!immediate && hadManualAction && !byId[ev.agent]?.manualAction && ui.selectedId === ev.agent) {
    ui.actionFeedback({ok:true, message:'收到新的任务或交接状态，已结束日常安排。'});
  }
  if (!immediate && !ev.silent && ev.type !== 'sync') {
    const agent = byId[ev.agent];
    if (agent) ui.addLog({ agent, text: eventText(ev), demo: false, ts: ev.ts });
  }
  refreshPresence();
  ui.update();
}

function restoreOffice(data) {
  sim.stop();
  ui.clearLog();
  for (const ev of data.last || []) onLiveEvent(ev, true);
  ui.setTelemetry(data);
  for (const ev of (data.recent || []).slice(-50)) {
    const agent = byId[ev.agent] || (ev.type === 'sync' ? sim.convene() : null);
    if (!agent) continue;
    const text = eventText(ev);
    ui.addLog({ agent, text, demo: false, ts: ev.ts });
  }
  refreshPresence();
  ui.update();
}

function requireLogin() {
  closeLive();
  sim.stop();
  ui.clearLog();
  ui.setFeed('locked');
  refreshPresence();
  ui.update();
}

async function startLive() {
  closeLive();
  const current = generation;
  const active = () => current === generation && ui.mode === 'live';
  const retry = () => {
    if (!active() || retryTimer != null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (active()) startLive();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };
  const readSession = async () => {
    const controller = new AbortController();
    sessionAbort = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/session', { signal: controller.signal });
      if (!response.ok) throw new Error('session unavailable');
      return await response.json();
    } finally {
      clearTimeout(timeout);
      if (sessionAbort === controller) sessionAbort = null;
    }
  };
  ui.setFeed('connecting');
  try {
    const session = await readSession();
    if (!active()) return;
    if (!session.authenticated) { requireLogin(); return; }
    if (!window.EventSource) { ui.setFeed('noserver'); return; }
    es = new EventSource('/api/events/stream');
    es.addEventListener('snapshot', (e) => {
      if (active()) restoreOffice(JSON.parse(e.data));
    });
    es.addEventListener('event', (e) => {
      if (active()) onLiveEvent(JSON.parse(e.data));
    });
    es.addEventListener('telemetry', (e) => {
      if (active()) { ui.setTelemetry(JSON.parse(e.data)); ui.update(); }
    });
    es.addEventListener('auth-required', () => { if (active()) requireLogin(); });
    let probing = false;
    es.onopen = () => {
      if (!active()) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      retryDelay = 1000;
      ui.setFeed('open');
    };
    es.onerror = async () => {
      if (!active()) return;
      ui.setFeed('closed');
      // 网络中断由 EventSource 重连；HTTP 错误等使它彻底关闭时重新建立连接。
      if (es.readyState === EventSource.CLOSED) retry();
      if (probing) return;
      probing = true;
      try {
        const session = await readSession();
        if (active() && !session.authenticated) requireLogin();
      } catch { /* EventSource 自行重连，保留上次状态及其新鲜度。 */ }
      finally { probing = false; }
    };
  } catch {
    if (active()) { ui.setFeed('noserver'); retry(); }
  }
}

const login = document.getElementById('authForm');
login.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('officeToken');
  const button = login.querySelector('button');
  const message = document.getElementById('authMessage');
  button.disabled = true;
  message.textContent = '';
  try {
    const response = await fetch('/api/session', {
      method: 'POST', headers: { Authorization: `Bearer ${input.value}` },
    });
    input.value = '';
    if (!response.ok) {
      message.textContent = response.status === 401 ? '口令不正确，请重试。' : '暂时无法连接，请稍后重试。';
      return;
    }
    if (ui.mode === 'live') await startLive();
  } catch {
    input.value = '';
    message.textContent = '无法连接办公室服务，请稍后重试。';
  } finally {
    button.disabled = false;
  }
});

const query = new URLSearchParams(location.search);
if (query.has('demo')) {
  const rest = query.get('demo') === 'idle';
  ui.setUiMode('demo', rest ? 'rest' : 'work');
  sim.start({ rest });
} else {
  startLive();
}

let last = performance.now();
let nextUiUpdate = 0;
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const nowSec = Date.now() / 1000;
  if (now >= nextUiUpdate) refreshPresence(nowSec);
  sim.update(dt, nowSec);
  for (const a of agents) a.update(dt);
  lerpLight(light, lightKey(tod), Math.min(1, dt * 3));
  renderer.draw(now / 1000, light);
  if (now >= nextUiUpdate) {
    ui.update(nowSec);
    nextUiUpdate = now + 250;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.office = { world, agents, sim, ui, renderer, freshness, apply: (e) => sim.applyEvent(e) };
