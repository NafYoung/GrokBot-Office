// 空闲生活只控制动作，不改工作状态、新鲜度或真实任务日志。
import { COFFEE, LOUNGE, STRETCH, STROLL, SOFA_SLOTS } from './config.js';
import { hasFreshTask, shouldShowOnFloor } from './presence.js';

export const LOAF = {
  coffee: { go: '去接杯咖啡', doing: '慢慢喝咖啡', back: '端着咖啡回工位', prop: 'cup', dwell: [6, 10] },
  stretch: { go: '起来活动一下', doing: '伸懒腰 · 松松肩膀', back: '活动完回工位', prop: null, dwell: [4, 7] },
  lounge: { go: '去休息区坐坐', doing: '坐着放空一会儿', back: '休息好了，回工位', prop: null, dwell: [8, 13] },
  stroll: { go: '在办公室散散步', doing: '看看四周，透口气', back: '溜达回工位', prop: null, dwell: [2, 4] },
};

export const LOAF_SPOTS = { coffee: COFFEE, stretch: STRETCH, lounge: LOUNGE, stroll: STROLL };
export const SCENE_ACTIONS = {
  coffee: '喝咖啡', lounge: '坐沙发', stretch: '伸懒腰', stroll: '散散步', home: '回工位',
};

// 正常办公以在座为主；预览只缩短等待，也不会让全员同时外出。
export const OFFICE_PACE = { initial:[20, 90], desk:[120, 240], gap:[25, 45], maxAway:2 };
const PREVIEW_PACE = { initial:[.5, 4], desk:[15, 30], gap:[4, 7], maxAway:2 };

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

// 家具坐姿只调整画面锚点，保留可走的落脚格，随时能起身返回工位。
export function scenePosition(agent) {
  if (agent.seated && agent.ambient === 'lounge' && agent.ambientStage === 'doing') {
    const slot = SOFA_SLOTS.find(s => sameCell(s.approach, agent.ambientSpot));
    if (slot) return slot.seat;
  }
  return [agent.x, agent.y, 0];
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
    this.reset();
  }

  reset({preview = false} = {}) {
    this.pace = preview ? PREVIEW_PACE : OFFICE_PACE;
    this.departureIn = 0;
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }
  initialDelay() { return this.range(...this.pace.initial); }
  deskDelay() { return this.range(...this.pace.desk); }

  freeSpots(a, spots) {
    return spots.filter(spot => !sameCell(spot, a.seat)
      && !this.agents.some(other => other !== a
        && (sameCell(spot, other.ambientSpot) || sameCell(spot, other.cell) || sameCell(spot, other.seat)))
      && a.world.findPath(a.cell, spot) != null);
  }

  request(a, kind) {
    if (!Object.hasOwn(SCENE_ACTIONS, kind)) return {ok:false, message:'这个动作暂不可用。'};
    if (!canLoaf(a)) return {ok:false, message:'当前任务优先，空闲后才能安排日常动作。'};
    if (a.activityKind || a.script.some(step => step.type === 'activity' && step.kind)) {
      return {ok:false, message:'正在交接或开会，结束后再安排休息。'};
    }
    if (kind === 'home') {
      this.sendHome(a);
      a.script.push({type:'wait', t:20}, {type:'call', fn:() => { a.manualAction = null; }});
      a.manualAction = kind;
      a.loafIn = this.deskDelay();
      return {ok:true, message:`已安排 ${a.name} 回工位歇一会儿。`};
    }
    const spots = this.freeSpots(a, LOAF_SPOTS[kind]);
    if (!spots.length) return {ok:false, message:'这里的位置暂时满了，试试别的活动。'};
    spots.sort((x, y) => a.world.findPath(a.cell, x).length - a.world.findPath(a.cell, y).length);
    const spot = spots[0];
    a.interrupt([...loafScript(a, kind, spot, this.range(...LOAF[kind].dwell)),
      {type:'call', fn:() => { a.manualAction = null; }}]);
    a.ambientSpot = spot;
    a.manualAction = kind;
    a.lastLoaf = kind;
    a.loafIn = this.deskDelay();
    return {ok:true, message:`已安排 ${a.name} ${SCENE_ACTIONS[kind]}。`};
  }

  chooseActivity(a) {
    const options = Object.entries(LOAF_SPOTS).map(([kind, spots]) => ({
      kind,
      spots: this.freeSpots(a, spots),
    })).filter((option) => option.spots.length);
    if (!options.length) return null;
    const different = options.filter(({ kind }) => kind !== a.lastLoaf);
    const { kind, spots } = this.pick(different.length ? different : options);
    return { kind, spot: this.pick(spots) };
  }

  update(dt) {
    this.departureIn = Math.max(0, this.departureIn - dt);
    const ready = [];
    for (const a of this.agents) {
      if ((a.ambient || a.ambientSpot) && !canLoaf(a)) {
        this.sendHome(a);
        continue;
      }
      if (!canLoaf(a) || a.cur || a.script.length) continue;
      if (a.loafIn == null) a.loafIn = this.initialDelay();
      a.loafIn -= dt;
      if (a.loafIn <= 0) ready.push(a);
    }
    // 手动安排及真实交接中的行走也占用场景空间，但不强行取消它们。
    const away = this.agents.filter(a => shouldShowOnFloor(a)
      && (a.ambient || a.ambientSpot || a.moving || !sameCell(a.cell, a.seat))).length;
    if (this.departureIn > 0 || away >= this.pace.maxAway) return;
    // 等得最久的人先出发；同一帧也只安排一个，避免一群人同时起身。
    for (const a of ready.sort((a, b) => a.loafIn - b.loafIn)) {
      const choice = this.chooseActivity(a);
      if (!choice) { a.loafIn = this.range(10, 20); continue; }
      const { kind, spot } = choice;
      a.interrupt(loafScript(a, kind, spot, this.range(...LOAF[kind].dwell)));
      // 同一帧内也预留目的地，后面的同事会选择另一个位置。
      a.ambientSpot = spot;
      a.lastLoaf = kind;
      a.loafIn = this.deskDelay();
      this.departureIn = this.range(...this.pace.gap);
      break;
    }
  }

  sendHome(a) {
    a.interrupt([
      { type: 'goto', cell: a.seat },
      { type: 'sit' },
      { type: 'mark', ambient: null, label: '', prop: null },
    ]);
    a.loafIn = this.deskDelay();
  }
}
