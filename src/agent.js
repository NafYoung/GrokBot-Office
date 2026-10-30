// Agent = 一个小人。它不"思考",只按 script(动作队列)一条条执行:
//   goto 走到某格 / wait 等 t 秒 / set 改状态文案 / sit 坐下 / carry 拿或放包裹 / call 触发回调
// "做什么"由 sim.js 决定,这里只负责"怎么做"。真实事件接入时也是往 script 里塞动作。
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export class Agent {
  constructor(cfg, desk, world) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.role = cfg.role;
    this.color = cfg.color;
    this.world = world;
    this.seat = [desk.x, desk.y + 1];
    this.visit = [desk.x + 1, desk.y + 1];
    this.x = this.seat[0] + 0.5;
    this.y = this.seat[1] + 0.5;
    this.fx = 0;
    this.fy = -1;
    this.state = 'idle';
    this.text = 'Starting up';
    this.seated = true;
    this.moving = false;
    this.carry = false;
    this.lastTask = null;
    this.speed = 2.1; // 格/秒
    this.path = [];
    this.script = [];
    this.cur = null;
    this.phase = (cfg.id.charCodeAt(0) % 7) * 0.9;
  }

  // 打断当前动作,换一套新脚本
  interrupt(script) {
    this.script = script;
    this.cur = null;
    this.path = [];
    this.carry = false;
    this.moving = false;
  }

  get cell() { return [Math.floor(this.x), Math.floor(this.y)]; }

  update(dt) {
    // 零耗时动作(set/sit/call)可以在同一帧连续执行,所以用循环
    for (let guard = 0; guard < 16; guard++) {
      if (!this.cur) {
        this.cur = this.script.shift() || null;
        if (!this.cur) { this.moving = false; return; }
        this.begin(this.cur);
      }
      if (!this.tick(this.cur, dt)) return;
      this.cur = null;
      dt = 0;
    }
  }

  begin(a) {
    switch (a.type) {
      case 'goto':
        this.seated = false;
        this.path = this.world.findPath(this.cell, a.cell) || [];
        break;
      case 'wait': a.left = a.t; break;
      case 'set': this.state = a.state; this.text = a.text; break;
      case 'sit':
        this.seated = true;
        this.x = this.seat[0] + 0.5;
        this.y = this.seat[1] + 0.5;
        this.fx = 0; this.fy = -1;
        break;
      case 'carry': this.carry = a.on; break;
      case 'call': a.fn(this); break;
    }
  }

  // 返回 true 表示这条动作做完了
  tick(a, dt) {
    if (a.type === 'wait') { a.left -= dt; return a.left <= 0; }
    if (a.type !== 'goto') return true;
    if (!this.path.length) { this.moving = false; return true; }
    let step = this.speed * dt;
    while (step > 0 && this.path.length) {
      const cx = this.path[0][0] + 0.5, cy = this.path[0][1] + 0.5;
      const dx = cx - this.x, dy = cy - this.y;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) { this.fx = sign(dx); this.fy = 0; }
      else if (dist > 1e-6) { this.fx = 0; this.fy = sign(dy); }
      if (dist <= step) { this.x = cx; this.y = cy; this.path.shift(); step -= dist; }
      else { this.x += (dx / dist) * step; this.y += (dy / dist) * step; step = 0; }
    }
    this.moving = this.path.length > 0;
    return !this.moving;
  }
}
