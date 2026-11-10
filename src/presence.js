// 把「上次事件是什么时候」收成屏幕上能看懂的在岗状态。
// 不负责走路或画图，所以可以在 Node 里直接测。

export function classifyPresence({ contact, lastSeenTs, nowSec, staleAfterSec, offlineAfterSec, demo = false }) {
  if (demo) return lastSeenTs == null ? (contact === 'unconnected' ? 'unconnected' : 'unknown') : 'fresh';
  if (lastSeenTs == null) return contact === 'unconnected' ? 'unconnected' : 'unknown';
  const age = nowSec - lastSeenTs;
  if (age >= offlineAfterSec) return 'offline';
  if (age >= staleAfterSec) return 'stale';
  return 'fresh';
}

export function formatAge(lastSeenTs, nowSec) {
  if (lastSeenTs == null) return '尚无事件';
  const s = Math.max(0, Math.floor(nowSec - lastSeenTs));
  if (s < 5) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export function statusCaption({ presence, state, STATES, PRESENCE, kind }) {
  if (kind === 'on_demand' && (presence === 'unknown' || presence === 'unconnected')) return '未在岗';
  const p = PRESENCE[presence] || PRESENCE.unknown;
  if (presence !== 'fresh') {
    const work = STATES[state] && state !== 'idle' ? STATES[state].label : null;
    return work ? `${p.label} · ${work}` : p.label;
  }
  return (STATES[state] || STATES.idle).label;
}

export function parseFreshnessParams(search, defaults) {
  const q = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;
  const n = (key, fallback) => {
    const v = Number(q.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    staleAfterSec: n('stale', defaults.staleAfterSec),
    offlineAfterSec: n('offline', defaults.offlineAfterSec),
  };
}

export function shouldShowOnFloor(agent) {
  const kind = agent.cfg?.kind || agent.kind;
  if (kind === 'on_demand') return agent.lastSeenTs != null || agent.demoActive;
  return true;
}
