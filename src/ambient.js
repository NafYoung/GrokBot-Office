// 实时且空闲时的摸鱼：倒咖啡、伸懒腰、沙发坐会儿。
// 不改工作 state，不写活动日志。未知 / 未连接 / 过期 / 离线不会出门。
import { COFFEE, LOUNGE, STRETCH } from './config.js';

export const LOAF = {
  coffee: { go: '去倒咖啡', doing: '在咖啡吧', back: '端着咖啡回去', prop: 'cup' },
  stretch: { go: '去活动一下', doing: '在伸懒腰', back: '', prop: null },
  lounge: { go: '去沙发坐会儿', doing: '在沙发摸鱼', back: '', prop: null },
};

export const LOAF_SPOTS = {
  coffee: COFFEE,
  stretch: STRETCH,
  lounge: LOUNGE,
};

export function canLoaf(agent) {
  if (!agent || agent.presence !== 'fresh' || agent.state !== 'idle') return false;
  if (agent.cfg?.kind === 'on_demand' && agent.lastSeenTs == null) return false;
  return true;
}

export function loafScript(agent, kind, spot, dwell) {
  const meta = LOAF[kind];
  const steps = [
    { type: 'mark', ambient: kind, label: meta.go, prop: null },
    { type: 'goto', cell: spot },
    { type: 'mark', ambient: kind, label: meta.doing, prop: meta.prop },
    { type: 'wait', t: dwell },
  ];
  if (meta.prop) steps.push({ type: 'mark', ambient: kind, label: meta.back, prop: meta.prop });
  else steps.push({ type: 'mark', ambient: null, label: '', prop: null });
  steps.push(
    { type: 'goto', cell: agent.seat },
    { type: 'sit' },
    { type: 'mark', ambient: null, label: '', prop: null },
  );
  return steps;
}

export class AmbientLife {
  constructor({ agents, rand = Math.random }) {
    this.agents = agents;
    this.rand = rand;
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  update(dt) {
    for (const a of this.agents) {
      if (a.ambient && !canLoaf(a)) {
        this.sendHome(a);
        continue;
      }
      if (!canLoaf(a) || a.cur || a.script.length) continue;
      if (a.loafIn == null) a.loafIn = this.range(8, 18);
      a.loafIn -= dt;
      if (a.loafIn > 0) continue;
      const kind = this.pick(Object.keys(LOAF));
      const spot = this.pick(LOAF_SPOTS[kind]);
      const dwell = kind === 'lounge' ? this.range(4, 7) : this.range(2.2, 3.6);
      a.interrupt(loafScript(a, kind, spot, dwell));
      a.loafIn = this.range(16, 34);
    }
  }

  sendHome(a) {
    a.interrupt([
      { type: 'goto', cell: a.seat },
      { type: 'sit' },
      { type: 'mark', ambient: null, label: '', prop: null },
    ]);
    a.loafIn = this.range(12, 24);
  }
}
