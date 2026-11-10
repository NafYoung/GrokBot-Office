// 演示模式才随机排任务。真实模式只走 applyEvent()。
import { CONVENE_ID, GATHER, LOUNGE, STATES } from './config.js';

export const SYNC = {
  lead: '主持全员同步',
  go: '前往全员同步',
  here: '参加全员同步',
  log: '召集全员到前台开会',
};

export class Simulation {
  /**
   * @param {{agents: import('./agent.js').Agent[], rand?: () => number, onLog?: Function}} opts
   */
  constructor({ agents, rand = Math.random, onLog = () => {} }) {
    this.agents = agents;
    this.byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    this.rand = rand;
    this.onLog = onLog;
    this.running = false;
    this.syncIn = 14;
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }
  log(agent, text, extra = {}) { this.onLog({ agent, text, demo: this.running, ...extra }); }

  start() {
    this.running = true;
    const now = Date.now() / 1000;
    for (const a of this.agents) {
      if (a.cfg.kind === 'on_demand') continue;
      a.demoActive = true;
      a.lastSeenTs = now;
      a.presence = 'fresh';
    }
  }

  stop() {
    this.running = false;
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
    if (!this.running) return;
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
    const spot = this.pick(LOUNGE);
    return [
      { type: 'set', state: 'idle', text: '【演示】去休息区走走' },
      { type: 'goto', cell: spot },
      { type: 'wait', t: this.range(4, 7) },
      { type: 'goto', cell: a.seat },
    ];
  }

  runSync({ demo = false } = {}) {
    const lead = this.convene();
    if (!lead) return false;
    const dur = 10;
    const others = demo
      ? this.agents.filter((a) => a !== lead && a.cfg.kind === 'resident')
      : this.agents.filter((a) => a !== lead && a.cfg.kind !== 'on_demand' && a.lastSeenTs);

    const prev = new Map([lead, ...others].map((a) => [a, { state: a.state, text: a.text }]));
    const restore = (a) => ({ type: 'set', ...prev.get(a) });

    lead.interrupt([
      { type: 'set', state: 'thinking', text: SYNC.lead },
      { type: 'call', fn: () => this.log(lead, SYNC.log) },
      { type: 'goto', cell: lead.seat },
      { type: 'sit' },
      { type: 'wait', t: dur + 9 },
      restore(lead),
    ]);
    others.forEach((a, i) => {
      a.interrupt([
        { type: 'set', state: 'thinking', text: SYNC.go },
        { type: 'goto', cell: GATHER[i % GATHER.length] },
        { type: 'set', state: 'thinking', text: SYNC.here },
        { type: 'wait', t: dur },
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        restore(a),
      ]);
    });
    return true;
  }

  // immediate: 刷新页面恢复快照时直接坐回工位，不要集体走一遍路
  applyEvent(ev, { immediate = false } = {}) {
    const type = ev.type || 'status';
    const ts = Number(ev.seen || ev.ts) || (Date.now() / 1000);

    if (type === 'sync') {
      if (immediate) return true;
      return this.runSync({ demo: false });
    }

    const a = this.find(ev.agent);
    if (!a) return false;
    a.lastSeenTs = ts;
    a.demoActive = false;

    if (type === 'status') {
      if (!STATES[ev.state]) return false;
      const text = ev.text || STATES[ev.state].label;
      a.lastStatusTs = ts;
      if (immediate) {
        a.interrupt([]);
        a.snapToSeat();
        a.state = ev.state;
        a.text = text;
        return true;
      }
      a.interrupt([
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        { type: 'set', state: ev.state, text },
        { type: 'call', fn: () => this.log(a, text, { demo: false }) },
      ]);
      return true;
    }

    if (type === 'handoff') {
      const target = this.find(ev.to);
      if (!target || target === a) return false;
      const state = STATES[ev.state] ? ev.state : 'thinking';
      const text = ev.text || `把材料交给 ${target.name}`;
      if (immediate) {
        a.snapToSeat();
        return true;
      }
      const prev = { state: a.state, text: a.text };
      a.interrupt([
        { type: 'set', state, text: `去 ${target.name} 工位` },
        { type: 'carry', on: true },
        { type: 'goto', cell: target.visit },
        { type: 'set', state, text },
        { type: 'call', fn: () => this.log(a, text, { demo: false }) },
        { type: 'wait', t: 2.2 },
        { type: 'carry', on: false },
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        { type: 'set', ...prev },
      ]);
      return true;
    }
    return false;
  }
}
