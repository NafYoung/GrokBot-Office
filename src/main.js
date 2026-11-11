// 默认是真实事件模式。初始快照和后续事件共用一条有序的 SSE 连接。
import { AGENTS, FRESHNESS, STATES } from './config.js';
import { World } from './world.js';
import { Agent } from './agent.js';
import { Simulation, SYNC } from './sim.js';
import { createRenderer, lightKey, makeLight, lerpLight } from './render.js';
import { createUI } from './ui.js';
import { classifyPresence, parseFreshnessParams } from './presence.js';

const freshness = parseFreshnessParams(location.search, FRESHNESS);
const world = new World();
const agents = AGENTS.map((c) => new Agent(c, world));
const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
let tod = 'now';
const light = makeLight(lightKey(tod));
let es = null;
let generation = 0;

function refreshPresence(nowSec = Date.now() / 1000) {
  for (const a of agents) {
    a.presence = classifyPresence({
      contact: a.cfg.contact, lastSeenTs: a.lastSeenTs, nowSec,
      ...freshness, demo: ui.mode === 'demo',
    });
  }
}

function closeLive() {
  generation++;
  es?.close();
  es = null;
}

const ui = createUI(agents, {
  onMode: (m) => { tod = m; },
  onSelect: (id) => renderer.setSelected(id),
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
  agents,
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
  const hit = renderer.hitTest(e.clientX, e.clientY);
  ui.select(hit ? hit.id : null);
});

function onLiveEvent(ev, immediate = false) {
  if (ui.mode === 'demo') return;
  if (!sim.applyEvent(ev, { immediate })) console.warn('[office] ignored event', ev);
  refreshPresence();
  ui.update();
}

function restoreOffice(data) {
  sim.stop();
  ui.clearLog();
  for (const ev of data.last || []) onLiveEvent(ev, true);
  for (const ev of (data.recent || []).slice(-50)) {
    const agent = byId[ev.agent] || (ev.type === 'sync' ? sim.convene() : null);
    if (!agent) continue;
    const text = ev.text || (ev.type === 'sync' ? SYNC.log
      : ev.type === 'handoff' ? `把材料交给 ${byId[ev.to]?.name || ev.to}`
        : STATES[ev.state]?.label);
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
  ui.setFeed('connecting');
  try {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('session unavailable');
    const session = await response.json();
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
    es.addEventListener('auth-required', () => { if (active()) requireLogin(); });
    es.onopen = () => { if (active()) ui.setFeed('open'); };
    es.onerror = async () => {
      if (!active()) return;
      ui.setFeed('closed');
      try {
        const response = await fetch('/api/session');
        if (!response.ok) return;
        const session = await response.json();
        if (active() && !session.authenticated) requireLogin();
      } catch { /* EventSource 自行重连，保留上次状态及其新鲜度。 */ }
    };
  } catch {
    if (active()) ui.setFeed('noserver');
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

window.office = { world, agents, sim, ui, freshness, apply: (e) => sim.applyEvent(e) };
