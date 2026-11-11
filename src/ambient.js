// 空闲生活只控制动作，不改工作状态、新鲜度或真实任务日志。
import { COFFEE, LOUNGE, STRETCH, STROLL } from './config.js';
import { hasFreshTask, shouldShowOnFloor } from './presence.js';

export const LOAF = {
  coffee: { go: '去接杯咖啡', doing: '慢慢喝咖啡', back: '端着咖啡回工位', prop: 'cup', dwell: [6, 10] },
  stretch: { go: '起来活动一下', doing: '伸懒腰 · 松松肩膀', back: '活动完回工位', prop: null, dwell: [4, 7] },
  lounge: { go: '去休息区坐坐', doing: '坐着放空一会儿', back: '休息好了，回工位', prop: null, dwell: [8, 13] },
  stroll: { go: '在办公室散散步', doing: '看看四周，透口气', back: '溜达回工位', prop: null, dwell: [2, 4] },
};

export const LOAF_SPOTS = { coffee: COFFEE, stretch: STRETCH, lounge: LOUNGE, stroll: STROLL };

export function canLoaf(agent) {
  if (!agent || agent.state !== 'idle' || !shouldShowOnFloor(agent)) return false;
  // 常驻角色的日常动作不依赖心跳；未知或旧 idle 仍保留原来的数据标记。
  // 按需工具只有真正上报过状态才加入休息，单次交接不算加入日常。
  if (agent.cfg?.kind === 'on_demand' && agent.lastStatusTs == null) return false;
  return true;
}

export function leisureLabel(agent) {
  if (!agent.ambientLabel) return '';
  return `${hasFreshTask(agent) ? '摸鱼' : '日常动画'} · ${agent.ambientLabel}`;
}

export function loafScript(agent, kind, spot, dwell) {
  const meta = LOAF[kind];
  return [
    { type: 'mark', ambient: kind, stage: 'going', spot, label: meta.go, prop: null },
    { type: 'goto', cell: spot },
    // 休息区坐下保持当前位置，不能使用会瞬移回工位的 sit。
    { type: 'pose', seated: kind === 'lounge', fx: kind === 'coffee' ? -1 : 0, fy: kind === 'coffee' ? 0 : 1 },
    { type: 'mark', ambient: kind, stage: 'doing', spot, label: meta.doing, prop: meta.prop },
    { type: 'wait', t: dwell },
    { type: 'pose', seated: false },
    { type: 'mark', ambient: kind, stage: 'returning', spot, label: meta.back, prop: meta.prop },
    { type: 'goto', cell: agent.seat },
    { type: 'sit' },
    { type: 'mark', ambient: null, label: '', prop: null },
  ];
}

const sameCell = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

export class AmbientLife {
  constructor({ agents, rand = Math.random }) {
    this.agents = agents;
    this.rand = rand;
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  chooseActivity(a) {
    const options = Object.entries(LOAF_SPOTS).map(([kind, spots]) => ({
      kind,
      spots: spots.filter((spot) => !sameCell(spot, a.seat)
        && !this.agents.some((other) => other !== a
          && (sameCell(spot, other.ambientSpot) || sameCell(spot, other.cell) || sameCell(spot, other.seat)))
        && a.world.findPath(a.cell, spot) != null),
    })).filter((option) => option.spots.length);
    if (!options.length) return null;
    const different = options.filter(({ kind }) => kind !== a.lastLoaf);
    const { kind, spots } = this.pick(different.length ? different : options);
    return { kind, spot: this.pick(spots) };
  }

  update(dt) {
    for (const a of this.agents) {
      if ((a.ambient || a.ambientSpot) && !canLoaf(a)) {
        this.sendHome(a);
        continue;
      }
      if (!canLoaf(a) || a.cur || a.script.length) continue;
      if (a.loafIn == null) a.loafIn = this.range(2, 7);
      a.loafIn -= dt;
      if (a.loafIn > 0) continue;
      const choice = this.chooseActivity(a);
      if (!choice) { a.loafIn = this.range(2, 4); continue; }
      const { kind, spot } = choice;
      a.interrupt(loafScript(a, kind, spot, this.range(...LOAF[kind].dwell)));
      // 同一帧内也预留目的地，后面的同事会选择另一个位置。
      a.ambientSpot = spot;
      a.lastLoaf = kind;
      a.loafIn = this.range(6, 14);
    }
  }

  sendHome(a) {
    a.interrupt([
      { type: 'goto', cell: a.seat },
      { type: 'sit' },
      { type: 'mark', ambient: null, label: '', prop: null },
    ]);
    a.loafIn = this.range(4, 8);
  }
}
