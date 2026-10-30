// 模拟器:决定每个 agent 下一步干什么,并把"发生了什么"写进活动日志。
// 它和真实数据的接口是同一个:往 agent 的 script 里塞动作。
//   - 模拟模式:plan() 随机生成
//   - 真实模式:applyEvent() 接收服务器转发来的事件,见文件末尾
import { GATHER, LOUNGE, STATES } from './config.js';

export class Simulation {
  /**
   * @param {{agents: import('./agent.js').Agent[], rand?: () => number, onLog?: (e:{agent:object,text:string}) => void}} opts
   */
  constructor({ agents, rand = Math.random, onLog = () => {} }) {
    this.agents = agents;
    this.byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    this.rand = rand;
    this.onLog = onLog;
    this.running = false;
    this.syncIn = 14; // 第一次全员会议在 14 秒后,让你很快看到效果
  }

  range(a, b) { return a + this.rand() * (b - a); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }
  log(agent, text) { this.onLog({ agent, text }); }

  start() { this.running = true; }

  // 停止:所有人回到工位,状态置 Idle
  stop(text = 'Simulation stopped') {
    this.running = false;
    for (const a of this.agents) {
      a.interrupt([
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        { type: 'set', state: 'idle', text },
      ]);
    }
  }

  // 按 id 或名字(不分大小写)找人:'atlas'、'Atlas'、'drone business' 都行
  find(ref) {
    const k = String(ref ?? '').trim().toLowerCase();
    return this.agents.find((a) => a.id === k || a.name.toLowerCase() === k) || null;
  }

  update(dt) {
    if (!this.running) return;
    this.syncIn -= dt;
    if (this.syncIn <= 0) {
      this.runSync();
      this.syncIn = this.range(35, 55);
    }
    for (const a of this.agents) {
      if (!a.cur && a.script.length === 0) a.script = this.plan(a);
    }
  }

  // 一个"工作周期":回工位 → 开始任务 → 干一会儿 → 随机插入一件事
  plan(a) {
    // 尽量不连着两次做同一件事,活动日志就不会出现重复行
    const pool = a.cfg.tasks.filter((t) => t !== a.lastTask);
    const task = this.pick(pool.length ? pool : a.cfg.tasks);
    a.lastTask = task;
    const s = [
      { type: 'goto', cell: a.seat },
      { type: 'sit' },
      { type: 'set', state: task.state, text: task.text },
      { type: 'call', fn: () => this.log(a, `At the desk. ${task.text}`) },
      { type: 'wait', t: this.range(6, 12) },
    ];
    const roll = this.rand();
    if (roll < 0.06) {
      s.push(
        { type: 'set', state: 'needsYou', text: 'Waiting for your approval' },
        { type: 'call', fn: () => this.log(a, 'Needs your approval to continue') },
        { type: 'wait', t: 6 },
      );
    } else if (roll < 0.09) {
      s.push(
        { type: 'set', state: 'error', text: 'Task failed, retrying' },
        { type: 'call', fn: () => this.log(a, 'Hit an error and is retrying') },
        { type: 'wait', t: 4 },
      );
    } else if (roll < 0.55) {
      s.push(...this.handoff(a));
    } else if (roll < 0.65) {
      s.push(...this.breakTime(a));
    }
    return s;
  }

  handoff(a) {
    const h = this.pick(a.cfg.handoffs);
    const target = this.byId[h.to];
    return [
      { type: 'set', state: 'thinking', text: `Heading to ${target.name}'s desk` },
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
      { type: 'set', state: 'idle', text: 'Taking a short break' },
      { type: 'goto', cell: spot },
      { type: 'wait', t: this.range(4, 7) },
      { type: 'goto', cell: a.seat },
    ];
  }

  // Alfred 召集全员:大家走进他的办公室,开完会各回各位
  runSync() {
    const alfred = this.byId.alfred;
    const dur = 10;
    // 散会后恢复开会前的状态:真实模式下没人替他们重新安排任务
    const prev = new Map(this.agents.map((a) => [a, { state: a.state, text: a.text }]));
    const restore = (a) => ({ type: 'set', ...prev.get(a) });
    alfred.interrupt([
      // 先亮状态再走回座位:他可能正在给别人送东西,被打断时离座位还有几步
      { type: 'set', state: 'thinking', text: 'Running the team sync' },
      { type: 'call', fn: () => this.log(alfred, 'Called a team sync in the executive office') },
      { type: 'goto', cell: alfred.seat },
      { type: 'sit' },
      // 别人要先走过来(最远约 7 秒)再开 dur 秒会,Alfred 要等到最后一个人坐下
      { type: 'wait', t: dur + 9 },
      restore(alfred),
    ]);
    const others = this.agents.filter((a) => a !== alfred);
    others.forEach((a, i) => {
      a.interrupt([
        { type: 'set', state: 'thinking', text: 'Heading to the team sync' },
        { type: 'goto', cell: GATHER[i % GATHER.length] },
        { type: 'set', state: 'thinking', text: 'In the team sync with Alfred' },
        { type: 'wait', t: dur },
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        restore(a),
      ]);
    });
  }

  // ---- 真实数据入口 ----
  // 先 sim.stop() 再调用,否则模拟器会在这个动作做完后继续随机安排。
  // 三种事件(和 server.py 校验后转发的格式一致):
  //   {type:'status',  agent, state, text}        回工位,显示状态
  //   {type:'handoff', agent, to, text, state?}   走到对方工位交接,再回来、恢复原状态
  //   {type:'sync'}                               Alfred 召集全员开会
  // 返回 false 表示事件无效(没人 / 状态不认识),什么都不会发生。
  applyEvent(ev) {
    const type = ev.type || 'status';
    if (type === 'sync') { this.runSync(); return true; }

    const a = this.find(ev.agent);
    if (!a) return false;

    if (type === 'status') {
      if (!STATES[ev.state]) return false;
      const text = ev.text || STATES[ev.state].label;
      a.interrupt([
        { type: 'goto', cell: a.seat },
        { type: 'sit' },
        { type: 'set', state: ev.state, text },
        { type: 'call', fn: () => this.log(a, text) },
      ]);
      return true;
    }

    if (type === 'handoff') {
      const target = this.find(ev.to);
      if (!target || target === a) return false;
      const state = STATES[ev.state] ? ev.state : 'thinking';
      const text = ev.text || `Handed something to ${target.name}`;
      const prev = { state: a.state, text: a.text };
      a.interrupt([
        { type: 'set', state, text: `Heading to ${target.name}'s desk` },
        { type: 'carry', on: true },
        { type: 'goto', cell: target.visit },
        { type: 'set', state, text },
        { type: 'call', fn: () => this.log(a, text) },
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
