// 入口。默认是真实事件模式：没收到事件就显示未知/未连接，不自动演戏。
import { AGENTS, FRESHNESS } from './config.js';
import { World } from './world.js';
import { Agent } from './agent.js';
import { Simulation } from './sim.js';
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

function refreshPresence(nowSec = Date.now() / 1000) {
  for (const a of agents) {
    a.presence = classifyPresence({
      contact: a.cfg.contact,
      lastSeenTs: a.lastSeenTs,
      nowSec,
      staleAfterSec: freshness.staleAfterSec,
      offlineAfterSec: freshness.offlineAfterSec,
      demo: ui.mode === 'demo',
    });
  }
}

const ui = createUI(agents, {
  onMode: (m) => { tod = m; },
  onSelect: (id) => renderer.setSelected(id),
  onDemo: (on) => {
    if (on) {
      ui.clearLog();
      sim.start();
      refreshPresence();
    } else {
      sim.stop();
      ui.clearLog();
      refreshPresence();
      loadOfficeHistory();
      if (!es || es.readyState === EventSource.CLOSED) connectLive();
    }
  },
});

const sim = new Simulation({
  agents,
  onLog: (e) => {
    if (e.demo && ui.mode !== 'demo') return;
    if (!e.demo && ui.mode === 'demo') return;
    ui.addLog(e);
  },
});

const canvas = document.getElementById('office');
const renderer = createRenderer(canvas, agents);
new ResizeObserver(() => renderer.resize()).observe(canvas);

canvas.addEventListener('click', (e) => {
  const hit = renderer.hitTest(e.clientX, e.clientY);
  ui.select(hit ? hit.id : null);
  renderer.setSelected(ui.selectedId);
});

function onLiveEvent(ev, immediate = false) {
  if (ui.mode === 'demo') return;
  if (!sim.applyEvent(ev, { immediate })) console.warn('[office] ignored event', ev);
  refreshPresence();
}

async function loadOfficeHistory() {
  try {
    const res = await fetch('/api/office');
    if (!res.ok) return;
    const data = await res.json();
    for (const ev of data.last || []) onLiveEvent(ev, true);
    for (const ev of (data.recent || []).slice(-30)) {
      const agent = byId[ev.agent];
      if (!agent || !ev.text) continue;
      ui.addLog({ agent, text: ev.text, demo: false, ts: ev.ts });
    }
  } catch {
    // 没有服务器时保持未知
  }
}

function connectLive() {
  if (!window.EventSource) {
    ui.setFeed('noserver');
    return;
  }
  if (es) { es.close(); es = null; }
  ui.setFeed('connecting');
  es = new EventSource('/api/events/stream');
  es.addEventListener('event', (e) => onLiveEvent(JSON.parse(e.data), false));
  es.addEventListener('snapshot', (e) => {
    JSON.parse(e.data).forEach((ev) => onLiveEvent(ev, true));
    refreshPresence();
    ui.update();
  });
  es.onopen = () => ui.setFeed('open');
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) ui.setFeed('noserver');
    else ui.setFeed('closed');
  };
}

const wantDemo = new URLSearchParams(location.search).has('demo');
if (wantDemo) {
  ui.setUiMode('demo');
  sim.start();
} else {
  loadOfficeHistory();
  connectLive();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const nowSec = Date.now() / 1000;
  sim.update(dt, nowSec);
  for (const a of agents) a.update(dt);
  refreshPresence(nowSec);
  lerpLight(light, lightKey(tod), Math.min(1, dt * 3));
  renderer.draw(now / 1000, light);
  ui.update(nowSec);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.office = { world, agents, sim, ui, freshness, apply: (e) => sim.applyEvent(e) };
