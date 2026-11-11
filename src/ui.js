// 中文面板：在岗状态、最近活动、选中工位。不参与模拟。
import { OFFICE, STATES, PRESENCE, WORKING_STATES } from './config.js';
import { formatAge, statusCaption } from './presence.js';
import { drawRobotPortrait } from './robot.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const portrait = (a, large = false) => `<canvas class="av robot-avatar${large ? ' lg' : ''}" data-bot-portrait="${esc(a.id)}" width="128" height="128" aria-hidden="true"></canvas>`;

function kindLabel(kind) {
  if (kind === 'auxiliary') return '按需助手';
  if (kind === 'on_demand') return '按需工具';
  return '主工位';
}

function contactNote(a) {
  if (a.cfg.contact === 'unconnected' && a.lastSeenTs == null) {
    return '席位保留，当前不在可联系名单';
  }
  if (a.presence === 'unknown') return '还没收到过事件';
  if (a.presence === 'stale') return '上次事件已超过新鲜度阈值';
  if (a.presence === 'offline') return '很久没有新事件，按离线显示';
  return a.role;
}

export function createUI(agents, { onDemo, onMode, onSelect }) {
  $('title').textContent = `${OFFICE.owner} 的 ${OFFICE.title}`;
  document.title = `${OFFICE.owner} 的 ${OFFICE.title}`;
  $('ownerName').textContent = OFFICE.owner;
  $('ownerAvatar').textContent = 'N';

  $('legend').innerHTML = ['coding', 'browsing', 'terminal', 'thinking', 'needsYou', 'error', 'idle']
    .map((k) => `<span><i class="dot" style="background:${STATES[k].color}"></i>${STATES[k].label}</span>`).join('');

  const residents = agents.filter((a) => a.cfg.kind === 'resident');
  const extras = agents.filter((a) => a.cfg.kind !== 'resident');
  $('teamCount').textContent = String(residents.length);

  let uiMode = 'live'; // live | demo
  let demoKind = 'work';
  let feed = 'connecting'; // connecting | open | closed | noserver | locked
  let selectedId = null;
  let lastSig = '';

  function setUiMode(next, kind = 'work') {
    uiMode = next;
    demoKind = kind;
    $('demoBanner').classList.toggle('hidden', next !== 'demo');
    $('demoBanner').textContent = kind === 'rest'
      ? '休息演示 · 空闲活动示例，不是实时状态'
      : '演示模式 · 以下是示例数据，不是实时状态';
    $('demoBtn').textContent = next === 'demo' ? '退出演示模式' : '进入演示模式';
    $('demoBtn').classList.toggle('on', next === 'demo');
    $('restBtn').classList.toggle('on', next === 'demo' && kind === 'rest');
    $('restBtn').setAttribute('aria-pressed', String(next === 'demo' && kind === 'rest'));
    paintBadges();
  }

  function setFeed(next) {
    feed = next;
    paintBadges();
  }

  function paintBadges() {
    let badge = '等待事件';
    let kind = '';
    let feedText = '等待办公室事件';
    if (uiMode === 'demo') {
      badge = demoKind === 'rest' ? '休息演示' : '演示';
      kind = 'demo';
      feedText = demoKind === 'rest' ? '喝咖啡、伸懒腰、坐坐、散步 · 都是休息动画' : '演示模式 · 示例数据，不是实时状态';
    } else if (feed === 'locked') {
      badge = '待解锁';
      kind = 'down';
      feedText = '请输入办公室口令以查看实时状态。';
    } else if (feed === 'closed' || feed === 'noserver') {
      badge = '已断开';
      kind = 'down';
      feedText = feed === 'noserver'
        ? '未连接到办公室服务。请用 python3 server.py 启动。'
        : '事件流已断开，正在重连…';
    } else if (feed === 'connecting') {
      badge = '连接中';
      feedText = '正在连接事件流…';
    } else {
      const fresh = agents.some((a) => a.presence === 'fresh');
      badge = fresh ? '实时' : '等待事件';
      kind = fresh ? 'live' : '';
      feedText = fresh ? '已连接 · 状态来自真实事件' : '已连接 · 还没有新鲜事件';
    }
    for (const id of ['modeBadge', 'ownerBadge']) {
      $(id).textContent = badge;
      $(id).classList.remove('live', 'demo', 'down');
      if (kind) $(id).classList.add(kind);
    }
    $('actMode').textContent = uiMode === 'demo' ? '演示' : (feed === 'open' ? '实时' : '未连接');
    $('feedBanner').textContent = feedText;
    $('feedBanner').dataset.kind = kind || feed;
    $('authForm').hidden = uiMode === 'demo' || feed !== 'locked';
  }

  function select(id) {
    selectedId = id;
    onSelect?.(id);
    lastSig = '';
    update(Date.now() / 1000);
  }

  $('tod').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const x of $('tod').children) x.classList.toggle('on', x === b);
    onMode(b.dataset.mode);
  });
  $('demoBtn').addEventListener('click', () => {
    const next = uiMode !== 'demo';
    setUiMode(next ? 'demo' : 'live');
    onDemo(next);
  });
  $('restBtn').addEventListener('click', () => {
    const next = !(uiMode === 'demo' && demoKind === 'rest');
    setUiMode(next ? 'demo' : 'live', 'rest');
    onDemo(next, 'rest');
  });
  $('team').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) select(li.dataset.id);
  });
  $('aux').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) select(li.dataset.id);
  });
  $('strip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (b) select(b.dataset.id);
  });

  function caption(a) {
    if (a.presence === 'fresh' && a.lastStatusTs == null && !a.demoActive) return '在岗 · 未上报状态';
    const base = statusCaption({ presence: a.presence, state: a.state, STATES, PRESENCE, kind: a.cfg.kind });
    if (a.presence === 'fresh' && a.ambientLabel) return `摸鱼 · ${a.ambientLabel}`;
    return base;
  }

  function row(a, nowSec) {
    const cap = caption(a);
    const p = PRESENCE[a.presence] || PRESENCE.unknown;
    const age = formatAge(a.lastSeenTs, nowSec);
    const work = a.text ? esc(a.text) : (a.presence === 'unconnected' ? '未连接' : '尚无工作内容');
    return `<li data-id="${esc(a.id)}" class="${selectedId === a.id ? 'on' : ''}">
      ${portrait(a)}
      <span class="nm">${esc(a.name)}<i>${esc(a.role)}</i></span>
      <span class="st"><i class="dot" style="background:${p.color}"></i>${esc(cap)}</span>
      <span class="tx">${work}<em>${esc(age)}</em></span>
    </li>`;
  }

  function renderSelected(nowSec) {
    const box = $('selected');
    const a = agents.find((x) => x.id === selectedId);
    if (!a) {
      box.innerHTML = '<p class="hint">点小人、工位或名单，查看工作内容与新鲜度。</p>';
      return;
    }
    const cap = caption(a);
    const p = PRESENCE[a.presence] || PRESENCE.unknown;
    box.innerHTML = `
      <div class="sel-head">
        ${portrait(a, true)}
        <div>
          <b>${esc(a.name)}</b>
          <span class="muted">${esc(a.role)} · ${esc(kindLabel(a.cfg.kind))}</span>
        </div>
      </div>
      <p class="sel-state"><i class="dot" style="background:${p.color}"></i>${esc(cap)} · ${esc(formatAge(a.lastSeenTs, nowSec))}</p>
      <p class="sel-text">${esc(a.text || '没有最近工作描述')}</p>
      ${a.ambientLabel ? `<p class="sel-loaf">摸鱼：${esc(a.ambientLabel)}</p>` : ''}
      <p class="muted sel-note">${esc(contactNote(a))}</p>`;
  }

  function update(nowSec = Date.now() / 1000) {
    const sig = [
      uiMode, feed, selectedId,
      ...agents.map((a) => `${a.id}:${a.presence}:${a.state}:${a.text}:${a.lastStatusTs == null}:${a.ambientLabel}:${formatAge(a.lastSeenTs, nowSec)}`),
    ].join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    const n = (pred) => agents.filter(pred).length;
    const unreported = (a) => a.presence === 'fresh' && a.lastStatusTs == null && !a.demoActive;
    const working = n((a) => a.presence === 'fresh' && !unreported(a) && WORKING_STATES.includes(a.state) && !['needsYou', 'error'].includes(a.state));
    const need = n((a) => a.presence === 'fresh' && a.state === 'needsYou');
    const errors = n((a) => a.presence === 'fresh' && a.state === 'error');
    const loafing = n((a) => a.presence === 'fresh' && a.state === 'idle' && !unreported(a));
    const stale = n((a) => a.presence === 'stale');
    const unknown = n((a) => a.presence === 'unknown' || a.presence === 'unconnected');
    const offline = n((a) => a.presence === 'offline');
    const stat = (color, v, label) => `<span class="stat"><i class="dot" style="background:${color}"></i>${v} ${label}</span>`;
    $('stats').innerHTML =
      stat('#8b7cf6', working, '工作中') +
      stat('#38bdf8', loafing, '空闲') +
      stat('#fb923c', need, '需要你') +
      stat('#ef4444', errors, '出错') +
      stat('#facc15', stale, '过期') +
      stat('#64748b', unknown, '未知/未连接') +
      stat('#94a3b8', offline, '离线') +
      (n(unreported) ? stat('#94a3b8', n(unreported), '待报状态') : '');

    $('team').innerHTML = residents.map((a) => row(a, nowSec)).join('');
    $('aux').innerHTML = extras.map((a) => row(a, nowSec)).join('');
    $('strip').innerHTML = residents.map((a) => {
      const p = PRESENCE[a.presence] || PRESENCE.unknown;
      return `<button type="button" data-id="${esc(a.id)}" class="chip ${selectedId === a.id ? 'on' : ''}" title="${esc(a.name)}">
        ${portrait(a)}
        <span>${esc(a.name)}</span>
        <i class="dot" style="background:${p.color}"></i>
      </button>`;
    }).join('');
    renderSelected(nowSec);
    for (const canvas of document.querySelectorAll('[data-bot-portrait]')) {
      const agent = agents.find((a) => a.id === canvas.dataset.botPortrait);
      if (agent) drawRobotPortrait(canvas, agent);
    }
    paintBadges();
  }

  function addLog({ agent, text, demo = false, ts }) {
    if (!text) return;
    const time = new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const li = document.createElement('li');
    const tag = demo || uiMode === 'demo' ? '<em class="demo-tag">演示</em>' : '';
    li.innerHTML = `<span class="tm">${time}</span><i class="dot" style="background:${agent.color}"></i><span>${tag}<b>${esc(agent.name)}</b> ${esc(text)}</span>`;
    const ul = $('activity');
    ul.prepend(li);
    while (ul.children.length > 50) ul.lastChild.remove();
  }

  const clearLog = () => { $('activity').innerHTML = ''; };

  setUiMode('live');
  return {
    update, addLog, clearLog, select,
    setUiMode, setFeed,
    get mode() { return uiMode; },
    get feed() { return feed; },
    get selectedId() { return selectedId; },
  };
}
