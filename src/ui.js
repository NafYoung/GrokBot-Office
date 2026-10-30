// 右侧面板 + 顶栏统计 + 控件。只读 agent 的字段,不参与模拟。
import { OWNER, STATES } from './config.js';

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);

export function createUI(agents, { onMode, onToggleSim }) {
  $('title').textContent = `${OWNER}'s Staff Virtual Office`;
  $('ownerName').textContent = OWNER;
  $('ownerAvatar').textContent = OWNER[0];
  $('teamCount').textContent = String(agents.length);

  $('legend').innerHTML = ['coding', 'browsing', 'terminal', 'thinking', 'needsYou', 'error', 'idle']
    .map((k) => `<span><i class="dot" style="background:${STATES[k].color}"></i>${STATES[k].label}</span>`).join('');

  let lastSig = '';

  // 三种模式:sim 随机模拟 / paused 已停止 / live 在显示真实事件
  const MODES = {
    sim:    { badge: 'Simulation', act: 'Simulated', btn: 'Stop Simulation' },
    paused: { badge: 'Paused',     act: 'Paused',    btn: 'Start Simulation' },
    live:   { badge: 'Live',       act: 'Live',      btn: 'Switch to Simulation' },
  };
  let mode = 'sim';
  function setMode(next) {
    mode = next;
    const m = MODES[next];
    for (const id of ['modeBadge', 'ownerBadge']) {
      $(id).textContent = m.badge;
      $(id).classList.toggle('live', next === 'live');
    }
    $('actMode').textContent = m.act;
    $('simBtn').textContent = m.btn;
  }

  $('tod').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $('tod').children) x.classList.toggle('on', x === b);
    onMode(b.dataset.mode);
  });
  $('simBtn').addEventListener('click', () => {
    // sim → 停止;paused / live → 开始模拟
    const run = mode !== 'sim';
    setMode(run ? 'sim' : 'paused');
    onToggleSim(run);
  });

  function update() {
    const sig = agents.map((a) => a.state + a.text).join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    const n = (f) => agents.filter(f).length;
    const stat = (color, v, label) => `<span class="stat"><i class="dot" style="background:${color}"></i>${v} ${label}</span>`;
    $('stats').innerHTML =
      stat('#8b7cf6', n((a) => a.state !== 'idle' && a.state !== 'needsYou'), 'working') +
      stat('#fb923c', n((a) => a.state === 'needsYou'), 'need you') +
      stat('#9ca3af', n((a) => a.state === 'idle'), 'idle') +
      stat('#64748b', 0, 'free desks');
    $('team').innerHTML = agents.map((a) => `
      <li><span class="av" style="background:${a.color}"></span>
        <span class="nm">${esc(a.name)}<i>${esc(a.role)}</i></span>
        <span class="st"><i class="dot" style="background:${STATES[a.state].color}"></i>${STATES[a.state].label}</span>
        <span class="tx">${esc(a.text)}</span></li>`).join('');
  }

  function addLog({ agent, text }) {
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const li = document.createElement('li');
    li.innerHTML = `<span class="tm">${time}</span><i class="dot" style="background:${agent.color === '#1f2937' ? '#94a3b8' : agent.color}"></i><span><b>${esc(agent.name)}</b> ${esc(text)}</span>`;
    const ul = $('activity');
    ul.prepend(li);
    while (ul.children.length > 40) ul.lastChild.remove();
  }

  const clearLog = () => { $('activity').innerHTML = ''; };

  return { update, addLog, clearLog, setMode, get mode() { return mode; } };
}
