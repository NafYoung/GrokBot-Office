// 演示模式才随机排任务。真实模式只走 applyEvent()。
import { CONVENE_ID, GATHER, STATES, FRESHNESS } from './config.js';
import { AmbientLife, LOAF, LOAF_SPOTS, loafScript } from './ambient.js';
import { updatePresence } from './presence.js';

export const SYNC = {
  lead: '主持全员同步',
  go: '前往全员同步',
  here: '参加全员同步',
  log: '召集全员到前台开会',
  liveLog: '收到办公室同步请求',
};

export class Simulation {
  /**
   * @param {{agents: import('./agent.js').Agent[], rand?: () => number, onLog?: Function, freshness?: typeof FRESHNESS}} opts
   */
  constructor({ agents, rand = Math.random, onLog = () => {}, freshness = FRESHNESS }) {
    this.agents = agents;
    this.byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    this.rand = rand;
    this.onLog = onLog;
    this.freshness = freshness;
    this.running = false;
    this.demoRest = false;
    this.syncIn = 14;
    this.ambient = new AmbientLife({ agents, rand });
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }
  log(agent, text, extra = {}) { this.onLog({ agent, text, demo: this.running, ...extra }); }

  refreshPresence(nowSec = Date.now() / 1000) {
    for (const a of this.agents) updatePresence(a, { ...this.freshness, nowSec, demo: this.running });
  }

  start({ rest = false } = {}) {
    this.running = true;
    this.demoRest = rest;
    const now = Date.now() / 1000;
    for (const a of this.agents) {
      if (a.cfg.kind === 'on_demand') continue;
      a.demoActive = true;
      a.lastSeenTs = now;
      a.presence = 'fresh';
      a.taskPresence = 'fresh';
      if (rest) {
        a.state = 'idle';
        a.text = '【演示】暂时没有任务';
        a.lastStatusTs = now;
        a.loafIn = this.range(0.5, 4);
      }
    }
  }

  stop() {
    this.running = false;
    this.demoRest = false;
    this.syncIn = 14;
    for (const a of this.agents) a.resetUnknown();
  }

  find(ref) {
    const k = String(ref ?? '').trim().toLowerCase();
    if (!k) return null;
    return this.agents.find((a) => {
      if (a.id === k || a.name.toLowerCase() === k) return true;
      return (a.cfg.aliases || []).some((al) => al.toLowerCase() === k);
    }) || null;
  }

  convene() {
    return this.byId[CONVENE_ID] || this.agents.find((a) => a.cfg.kind === 'resident') || this.agents[0];
  }

  demoCast() {
    return this.agents.filter((a) => a.cfg.kind === 'resident' || a.cfg.kind === 'auxiliary');
  }

  update(dt, nowSec = Date.now() / 1000) {
    if (!this.running || this.demoRest) {
      for (const a of this.agents) {
        const activity = a.activityKind || a.script.some((step) => step.type === 'activity' && step.kind);
        if (activity && a.presence !== 'fresh') {
          a.interrupt([{ type: 'goto', cell: a.seat }, { type: 'sit' }]);
        }
      }
      this.ambient.update(dt);
      return;
    }
    this.syncIn -= dt;
    if (this.syncIn <= 0) {
      this.runSync({ demo: true });
      this.syncIn = this.range(35, 55);
    }
    for (const a of this.demoCast()) {
      if (!a.cur && a.script.length === 0) a.script = this.plan(a, nowSec);
    }
  }

  plan(a, nowSec = Date.now() / 1000) {
    const tasks = a.cfg.demo?.tasks || [];
    if (!tasks.length) return [{ type: 'wait', t: this.range(6, 12) }];
    const pool = tasks.filter((t) => t !== a.lastTask);
    const task = this.pick(pool.length ? pool : tasks);
    a.lastTask = task;
    const s = [
      { type: 'mark', ambient: null, label: '', prop: null },
      { type: 'goto', cell: a.seat },
      { type: 'sit' },
      { type: 'set', state: task.state, text: task.text },
      { type: 'call', fn: () => { a.lastSeenTs = Date.now() / 1000; this.log(a, task.text); } },
      { type: 'wait', t: this.range(6, 12) },
    ];
    const roll = this.rand();
    const hands = a.cfg.demo?.handoffs || [];
    if (roll < 0.06) {
      s.push(
        { type: 'set', state: 'needsYou', text: '【演示】等你拍板才能继续' },
        { type: 'call', fn: () => this.log(a, '【演示】需要你批准') },
        { type: 'wait', t: 6 },
      );
    } else if (roll < 0.09) {
      s.push(
        { type: 'set', state: 'error', text: '【演示】任务失败，正在重试' },
        { type: 'call', fn: () => this.log(a, '【演示】出错后重试') },
        { type: 'wait', t: 4 },
      );
    } else if (roll < 0.55 && hands.length) {
      s.push(...this.handoff(a));
    } else if (roll < 0.65) {
      s.push(...this.breakTime(a));
    }
    void nowSec;
    return s;
  }

  handoff(a) {
    const h = this.pick(a.cfg.demo.handoffs);
    const target = this.byId[h.to];
    if (!target) return [];
    return [
      { type: 'set', state: 'thinking', text: `【演示】去 ${target.name} 工位` },
      { type: 'carry', on: true },
      { type: 'goto', cell: target.visit },
      { type: 'set', state: 'thinking', text: h.text },
      { type: 'call', fn: () => this.log(a, h.text) },
      { type: 'wait', t: 2.2 },
      { type: 'carry', on: false },
      { type: 'goto', cell: a.seat },
    ];
  }

  breakTime(a) {
    const kind = this.pick(Object.keys(LOAF));
    const spot = this.pick(LOAF_SPOTS[kind]);
    const text = `【演示】${LOAF[kind].go}`;
    return [
      { type: 'set', state: 'idle', text },
      { type: 'call', fn: () => this.log(a, text) },
      ...loafScript(a, kind, spot, this.range(3, 5)),
    ];
  }

  runSync({ demo = false, ts } = {}) {
    const lead = this.convene();
    if (!lead) return false;
    if (!demo) {
      this.log(lead, SYNC.liveLog, { demo: false, ts });
      this.refreshPresence();
      if (lead.presence !== 'fresh') return true;
    }
    const dur = 10;
    const others = demo
      ? this.agents.filter((a) => a !== lead && a.cfg.kind === 'resident')
      : this.agents.filter((a) => a !== lead && a.cfg.kind !== 'on_demand' && a.presence === 'fresh');

    const prev = new Map([lead, ...others].map((a) => [a, { state: a.state, text: a.text }]));
    const restore = (a) => demo ? { type: 'set', ...prev.get(a) } : { type: 'activity' };
    const activity = (text) => demo ? { type: 'set', state: 'thinking', text }
      : { type: 'activity', kind: 'sync', label: text };

    lead.interrupt([
      activity(SYNC.lead),
      ...(demo ? [{ type: 'call', fn: () => this.log(lead, SYNC.log) }] : []),
      { type: 'goto', cell: lead.seat },
      { type: 'sit' },
      { type: 'wait', t: dur + 9 },
      restore(lead),
    ]);
    others.forEach((a, i) => {
      a.interrupt([
        activity(SYNC.go),
        { type: 'goto', cell: GATHER[i % GATHER.length] },
        activity(SYNC.here),
        { type: 'wait', t: dur },
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        restore(a),
      ]);
    });
    return true;
  }

  // immediate: 刷新页面恢复快照时直接坐回工位，不要集体走一遍路
  applyEvent(ev, { immediate = false, quiet = false, keepPose = false } = {}) {
    const type = ev.type || 'status';
    const ts = Number(ev.seen || ev.ts) || (Date.now() / 1000);

    if (type === 'sync') {
      if (immediate) return true;
      return this.runSync({ demo: false, ts: ev.ts });
    }

    const a = this.find(ev.agent);
    if (!a) return false;
    // 先校验再更新在岗时间。无效输入不应让一个离线 bot 重新亮起来。
    if (type === 'status' && !STATES[ev.state]) return false;
    if (type === 'handoff' && (!this.find(ev.to) || this.find(ev.to) === a)) return false;
    if (!['status', 'handoff', 'presence'].includes(type)) return false;
    if (Number.isSafeInteger(ev.seq) && (ev.epoch ?? null) === a.eventEpoch && a.lastEventSeq != null && ev.seq <= a.lastEventSeq) return true;
    if (!Number.isSafeInteger(ev.seq) && a.lastSeenTs != null && ts < a.lastSeenTs) return true;
    a.lastEventSeq = Number.isSafeInteger(ev.seq) ? ev.seq : null;
    a.eventEpoch = ev.epoch ?? null;
    a.lastSeenTs = ts;
    a.demoActive = false;
    if (Array.isArray(ev.tasks)) a.tasks = ev.tasks;
    if (ev.diagnostic) a.diagnostic = ev.diagnostic;
    if ('runtime' in ev) a.runtime = ev.runtime;
    updatePresence(a, { ...this.freshness, nowSec: Date.now() / 1000 });

    if (type === 'presence') {
      if (immediate) a.snapToSeat();
      return true;
    }

    if (type === 'status') {
      const text = ev.text || STATES[ev.state].label;
      a.lastStatusTs = Number(ev.ts) || ts;
      updatePresence(a, { ...this.freshness, nowSec: Date.now() / 1000 });
      if (keepPose && !immediate && a.state === ev.state && a.text === text) return true;
      if (!immediate && ev.state === 'idle' && a.state === 'idle') {
        const busy = Boolean(a.ambient || a.cur || a.script.length);
        const away = a.cell[0] !== a.seat[0] || a.cell[1] !== a.seat[1];
        const taskActivity = a.activityKind || a.script.some((step) => step.type === 'activity' && step.kind);
        if (!taskActivity && (busy || !away)) {
          if (text && text !== a.text) {
            a.text = text;
            if (!quiet) this.log(a, text, { demo: false, ts: ev.ts });
          }
          return true;
        }
      }
      if (immediate) {
        a.interrupt([]);
        a.snapToSeat();
        a.state = ev.state;
        a.text = text;
        return true;
      }
      // 工作状态与日志立即生效；回座位只负责表现，不延迟错误或待办提醒。
      a.state = ev.state;
      a.text = text;
      if (!quiet) this.log(a, text, { demo: false, ts: ev.ts });
      a.interrupt([
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
      ]);
      return true;
    }

    if (type === 'handoff') {
      const target = this.find(ev.to);
      if (!target || target === a) return false;
      const text = ev.text || `把材料交给 ${target.name}`;
      if (immediate) {
        a.snapToSeat();
        return true;
      }
      if (!quiet) this.log(a, text, { demo: false, ts: ev.ts });
      a.interrupt([
        { type: 'activity', kind: 'handoff', label: `去 ${target.name} 工位` },
        { type: 'carry', on: true },
        { type: 'goto', cell: target.visit },
        { type: 'activity', kind: 'handoff', label: text },
        { type: 'wait', t: 2.2 },
        { type: 'carry', on: false },
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        { type: 'activity' },
      ]);
      return true;
    }
    return false;
  }
}
