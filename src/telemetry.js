import { STATES, AGENTS, FRESHNESS } from './config.js';
import { formatAge } from './presence.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PHASES = { started: '进行中', progress: '进行中', waiting: '等待确认', completed: '已完成', failed: '失败', cancelled: '已取消' };
export const SOURCES = { reporter: 'Bot 主动上报', external: '外部事件接入', 'grokbot-gateway': 'Grokbot 主机只读采集' };
export const activeTasks = a => (a.tasks || []).filter(t => ['started', 'progress', 'waiting'].includes(t.phase));

export function eventText(ev) {
  if (ev.type === 'task') return `${PHASES[ev.phase] || ev.phase} · ${ev.text || ev.taskId}`;
  return ev.text || (ev.type === 'sync' ? '收到办公室同步请求'
    : ev.type === 'handoff' ? `把材料交给 ${AGENTS.find(a => a.id === ev.to)?.name || ev.to}` : STATES[ev.state]?.label);
}

export function taskPanel(a, now, staleAfter = FRESHNESS.staleAfterSec) {
  const tasks = a.tasks || [];
  const rows = tasks.slice(0, 12).map(t => {
    const active = ['started', 'progress', 'waiting'].includes(t.phase);
    const stale = active && now - t.updatedAt >= staleAfter;
    return `<li class="task-item" data-task-id="${esc(t.taskId)}">
      <span class="task-phase ${esc(t.phase)}">${esc(PHASES[t.phase])}${stale ? ' · 状态过期' : ''}</span>
      <b>${esc(t.text)}</b><small>${esc(formatAge(t.updatedAt, now))} · ${esc(SOURCES[t.source] || t.source)}</small>
    </li>`;
  }).join('');
  return `<div class="task-panel"><h4>任务记录 <span>${activeTasks(a).length} 项进行中</span></h4>
    ${tasks.length ? `<ul>${rows}</ul>${tasks.length > 12 ? '<p class="hint">显示最近 12 项；完整记录可从办公室接口读取。</p>' : ''}`
      : '<p class="hint">暂无带编号的任务记录。单条状态或运行主机观察仍会显示在上方。</p>'}</div>`;
}

export function diagnosticPanel(a, now, staleAfter = FRESHNESS.staleAfterSec) {
  const d = a.diagnostic || {};
  const rejected = d.lastRejectedAt && (!d.lastAcceptedAt || d.lastRejectedAt > d.lastAcceptedAt);
  return `<div class="bot-diagnostic"><h4>这个 Bot 的连接</h4>
    <dl><dt>数据来源</dt><dd>${esc(SOURCES[d.source] || '尚无上报')}</dd>
    <dt>最近联系</dt><dd>${esc(formatAge(a.lastSeenTs, now))}</dd>
    <dt>任务更新</dt><dd>${esc(a.lastStatusTs == null ? '尚无任务状态' : formatAge(a.lastStatusTs, now))}</dd>
    <dt>心跳</dt><dd>${esc(d.lastHeartbeatAt ? formatAge(d.lastHeartbeatAt, now) : '尚无独立心跳')}</dd></dl>
    ${d.lastError ? `<p class="diagnostic-error ${rejected ? 'unresolved' : ''}">${esc(rejected ? '最近上报被拒绝' : '历史拒绝，之后已收到新上报')}：${esc(d.lastError)} · ${esc(formatAge(d.lastRejectedAt, now))}</p>` : ''}
    ${a.runtime ? `<p class="runtime-observation"><b>主机观察 · ${esc(formatAge(a.runtime.ts, now))}</b><br>${esc(a.runtime.text)}${now - a.runtime.ts >= staleAfter ? '（观察已过期）' : ''}</p>` : ''}
    <p class="hint">心跳只证明联系仍在，不会刷新旧任务。主机观察与有编号的任务分别保留；观察到空闲不会自动判定任务成功。</p>
    <p class="hint">Bot 没有发出的事件，办公室无法判断其发送错误。</p>
  </div>`;
}

export function connectorPanel(connector, now) {
  const c = connector || {};
  const labels = { not_configured: '等待配置', connecting: '正在连接', connected: '主机已连接', partial: '部分 Bot 未同步', error: '采集异常' };
  return `<div class="connector-status" data-state="${esc(c.state || 'not_configured')}">
    <b>${esc(labels[c.state] || '等待配置')}</b><p>${esc(c.message || '尚未配置 Grokbot 主机自动采集。')}</p>
    ${c.lastSuccessAt ? `<p class="hint">最近读取：${esc(formatAge(c.lastSuccessAt, now))} · ${Number(c.syncedAgents || 0)} 个 Bot 同步</p>` : ''}
    ${c.unmappedNames?.length ? `<p class="hint">未匹配工位：${c.unmappedNames.map(esc).join('、')}</p>` : ''}
    ${c.ambiguousNames?.length ? `<p class="diagnostic-error">重名需按原生 ID 绑定：${c.ambiguousNames.map(esc).join('、')}</p>` : ''}
    ${[...(c.ambiguousAgents || []), ...(c.unmappedAgents || [])].length ? `<details class="gateway-identities"><summary>查看待匹配成员的原生 ID</summary>${[...(c.ambiguousAgents || []), ...(c.unmappedAgents || [])].map(a => `<p>${esc(a.name)}<br><code>${esc(a.id)}</code></p>`).join('')}</details>` : ''}
    <p class="hint">此适配器参考社区主机协议，兼容性取决于 Grokbot 版本。连接成功不代表所有 Bot 都已匹配工位。</p>
  </div>`;
}
