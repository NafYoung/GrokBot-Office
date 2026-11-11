// 中文面板：在岗状态、最近活动、选中工位。不参与模拟。
import { OFFICE, STATES, PRESENCE, WORKING_STATES } from './config.js';
import { formatAge, statusCaption, hasFreshTask } from './presence.js';
import { drawRobotPortrait } from './robot.js';
import { activeTasks, taskPanel, diagnosticPanel, connectorPanel } from './telemetry.js';
import { leisureLabel } from './ambient.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
const portrait = (a, large = false) => `<canvas class="av robot-avatar${large ? ' lg' : ''}" data-bot-portrait="${esc(a.id)}" width="128" height="128" aria-hidden="true"></canvas>`;

function kindLabel(kind) {
  if (kind === 'auxiliary') return '按需助手';
  if (kind === 'on_demand') return '按需工具';
  return '主工位';
}

function contactNote(a) {
  if (a.lastSeenTs == null) return '名字和工位已配置，尚未收到这个 Bot 的上报。';
  if (a.lastStatusTs == null) return '已收到在岗信息，尚未收到任务状态。';
  if (a.presence === 'stale') return '上次事件已超过新鲜度阈值';
  if (a.presence === 'offline') return '很久没有新事件，按离线显示';
  if (!hasFreshTask(a)) return '最近有联系，但任务状态已过期；等待这个 Bot 重新上报。';
  return a.role;
}

export function createUI(agents, { onDemo, onMode, onSelect, freshness }) {
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
  let connector = {};

  function setTelemetry(data) {
    if (data.connector) connector = data.connector;
    for (const a of agents) if (data.diagnostics?.[a.id]) a.diagnostic = data.diagnostics[a.id];
    lastSig = '';
  }

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
        ? '未连接到办公室服务，正在自动重试。请确认 python3 server.py 已启动。'
        : '事件流已断开，正在重连…';
    } else if (feed === 'connecting') {
      badge = '连接中';
      feedText = '正在连接事件流…';
    } else {
      const freshTasks = agents.filter(hasFreshTask);
      const seen = agents.filter((a) => a.lastSeenTs != null);
      if (freshTasks.length) {
        badge = '已收到任务状态';
        kind = 'live';
        const latest = Math.max(...freshTasks.map((a) => a.lastStatusTs));
        feedText = `办公室服务已连接 · ${freshTasks.length} 个 Bot 有新鲜任务状态 · 最近上报${formatAge(latest, Date.now() / 1000)}`;
      } else if (seen.some((a) => a.presence === 'fresh')) {
        badge = '等待任务状态';
        feedText = '办公室服务已连接 · 收到 Bot 在岗信息，等待新的任务状态';
      } else if (seen.length) {
        badge = '上报已过期';
        feedText = '办公室服务已连接 · Bot 上报已过期，当前显示的是历史记录';
      } else {
        badge = '等待 Bot 上报';
        feedText = '办公室服务已连接 · 尚未收到 Bot 上报；名单来自工位配置';
      }
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
    $('integrationCard').hidden = uiMode === 'demo' || feed === 'locked';
    $('connectionCard').hidden = uiMode === 'demo' || feed === 'locked';
    $('lifeHint').hidden = uiMode === 'demo' || feed === 'locked';
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
    const base = a.presence === 'fresh' && a.lastStatusTs == null && !a.demoActive ? '在岗 · 未上报状态'
      : a.presence === 'fresh' && !hasFreshTask(a) ? '在岗 · 任务状态过期'
      : statusCaption({ presence: a.presence, state: a.state, STATES, PRESENCE, kind: a.cfg.kind });
    if (a.ambientLabel) return hasFreshTask(a) ? leisureLabel(a) : `${base} · 日常动画`;
    return base;
  }

  function row(a, nowSec) {
    const cap = caption(a);
    const p = PRESENCE[a.presence] || PRESENCE.unknown;
    const age = a.lastStatusTs == null ? `联系${formatAge(a.lastSeenTs, nowSec)}`
      : `任务${formatAge(a.lastStatusTs, nowSec)}`;
    const work = a.text ? esc(a.text) : '尚未收到任务上报';
    return `<li data-id="${esc(a.id)}" class="${selectedId === a.id ? 'on' : ''}">
      ${portrait(a)}
      <span class="nm">${esc(a.name)}<i>${esc(a.role)}${activeTasks(a).length ? ` · ${activeTasks(a).length} 项任务` : ''}</i></span>
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
      <p class="sel-text">${esc(a.text || '尚未收到任务上报')}</p>
      ${a.lastStatusTs != null ? `<p class="muted">任务上报：${esc(formatAge(a.lastStatusTs, nowSec))}</p>` : ''}
      ${a.activityLabel ? `<p class="sel-loaf">活动：${esc(a.activityLabel)}</p>` : ''}
      ${a.ambientLabel ? `<p class="sel-loaf">${esc(leisureLabel(a))}</p>` : ''}
      <p class="muted sel-note">${esc(contactNote(a))}</p>
      ${uiMode === 'live' ? taskPanel(a, nowSec, freshness?.staleAfterSec) + diagnosticPanel(a, nowSec, freshness?.staleAfterSec) : ''}`;
  }

  function update(nowSec = Date.now() / 1000) {
    const sig = [
      uiMode, feed, selectedId, JSON.stringify(connector), formatAge(connector.lastSuccessAt, nowSec),
      ...agents.map((a) => `${a.id}:${a.presence}:${a.taskPresence}:${a.state}:${a.text}:${a.activityLabel}:${a.ambientLabel}:${formatAge(a.lastSeenTs, nowSec)}:${formatAge(a.lastStatusTs, nowSec)}:${JSON.stringify(a.tasks)}:${JSON.stringify(a.diagnostic)}`),
    ].join('|');
    if (sig === lastSig) return;
    lastSig = sig;

    const n = (pred) => agents.filter(pred).length;
    const unreported = (a) => a.presence === 'fresh' && a.lastStatusTs == null && !a.demoActive;
    const working = n((a) => hasFreshTask(a) && WORKING_STATES.includes(a.state) && !['needsYou', 'error'].includes(a.state));
    const need = n((a) => hasFreshTask(a) && a.state === 'needsYou');
    const errors = n((a) => hasFreshTask(a) && a.state === 'error');
    const loafing = n((a) => hasFreshTask(a) && a.state === 'idle');
    const stale = n((a) => a.presence === 'stale' || (a.presence === 'fresh' && !unreported(a) && !hasFreshTask(a)));
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
    $('connectionStatus').innerHTML = connectorPanel(connector, nowSec);
    $('connectionBots').innerHTML = agents.map(a => `<button type="button" data-bot="${esc(a.id)}"><span>${esc(a.name)}</span><small>${esc(a.diagnostic.lastRejectedAt > (a.diagnostic.lastAcceptedAt || 0) ? '上报被拒绝' : caption(a))}</small></button>`).join('');
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
  $('connectionBots').addEventListener('click', e => {
    const button = e.target.closest('[data-bot]');
    if (button) select(button.dataset.bot);
  });

  setUiMode('live');
  return {
    update, addLog, clearLog, select, setTelemetry,
    setUiMode, setFeed,
    get mode() { return uiMode; },
    get feed() { return feed; },
    get selectedId() { return selectedId; },
  };
}
