// Agent = 一个小人。它不「思考」，只按 script 一条条执行。
// 真实/演示都往 script 里塞动作；在岗状态（未知/过期/离线）由 presence.js 另算。
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function placeFromCfg(cfg) {
  if (cfg.desk) {
    return {
      seat: [cfg.desk.x, cfg.desk.y + 1],
      visit: [cfg.desk.x + 1, cfg.desk.y + 1],
    };
  }
  const spot = cfg.spot || [1, 8];
  const dx = spot[0] < 12 ? 1 : -1;
  return { seat: [spot[0], spot[1]], visit: [spot[0] + dx, spot[1]] };
}

export class Agent {
  constructor(cfg, world) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.name = cfg.name;
    this.role = cfg.role;
    this.color = cfg.color;
    this.world = world;
    const place = placeFromCfg(cfg);
    this.seat = place.seat;
    this.visit = place.visit;
    this.hasDesk = Boolean(cfg.desk);
    if (world && !world.walkable(...this.visit)) {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1]];
      for (const [dx, dy] of dirs) {
        const n = [this.seat[0] + dx, this.seat[1] + dy];
        if (world.walkable(...n)) { this.visit = n; break; }
      }
    }
    this.x = this.seat[0] + 0.5;
    this.y = this.seat[1] + 0.5;
    this.fx = 0;
    this.fy = -1;
    this.state = 'idle';
    this.text = '';
    this.seated = true;
    this.moving = false;
    this.carry = false;
    this.prop = null;
    this.ambient = null;
    this.ambientLabel = '';
    this.ambientStage = null;
    this.ambientSpot = null;
    this.activityLabel = '';
    this.activityKind = null;
    this.lastLoaf = null;
    this.loafIn = null;
    this.lastTask = null;
    this.speed = 2.1;
    this.path = [];
    this.script = [];
    this.cur = null;
    this.phase = (cfg.id.charCodeAt(0) % 7) * 0.9;
    this.lastSeenTs = null;
    this.lastStatusTs = null;
    this.taskPresence = 'unknown';
    this.tasks = [];
    this.diagnostic = {};
    this.runtime = null;
    this.lastEventSeq = null;
    this.eventEpoch = null;
    this.presence = cfg.contact === 'unconnected' ? 'unconnected' : 'unknown';
    this.demoActive = false;
  }

  snapToSeat() {
    this.x = this.seat[0] + 0.5;
    this.y = this.seat[1] + 0.5;
    this.fx = 0;
    this.fy = -1;
    this.seated = true;
    this.moving = false;
    this.carry = false;
    this.prop = null;
    this.ambient = null;
    this.ambientLabel = '';
    this.ambientStage = null;
    this.ambientSpot = null;
    this.activityLabel = '';
    this.activityKind = null;
    this.path = [];
    this.script = [];
    this.cur = null;
  }

  resetUnknown() {
    this.snapToSeat();
    this.state = 'idle';
    this.text = '';
    this.lastSeenTs = null;
    this.lastStatusTs = null;
    this.taskPresence = 'unknown';
    this.tasks = [];
    this.diagnostic = {};
    this.runtime = null;
    this.lastEventSeq = null;
    this.eventEpoch = null;
    this.presence = this.cfg.contact === 'unconnected' ? 'unconnected' : 'unknown';
    this.demoActive = false;
    this.lastTask = null;
    this.loafIn = null;
    this.lastLoaf = null;
  }

  clearPose() {
    this.carry = false;
    this.prop = null;
    this.ambient = null;
    this.ambientLabel = '';
    this.ambientStage = null;
    this.ambientSpot = null;
    this.activityLabel = '';
    this.activityKind = null;
  }

  interrupt(script) {
    this.script = script;
    this.cur = null;
    this.path = [];
    this.moving = false;
    this.clearPose();
  }

  get cell() { return [Math.floor(this.x), Math.floor(this.y)]; }

  update(dt) {
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
      case 'set':
        this.state = a.state;
        this.text = a.text;
        break;
      case 'activity':
        this.activityLabel = a.label || '';
        this.activityKind = a.kind || null;
        break;
      case 'sit':
        this.seated = true;
        this.x = this.seat[0] + 0.5;
        this.y = this.seat[1] + 0.5;
        this.fx = 0; this.fy = -1;
        break;
      case 'carry': this.carry = a.on; break;
      case 'pose':
        this.seated = a.seated;
        if (a.fx != null) this.fx = a.fx;
        if (a.fy != null) this.fy = a.fy;
        break;
      case 'mark':
        this.ambient = a.ambient ?? null;
        this.ambientLabel = a.label || '';
        this.prop = a.prop ?? null;
        this.ambientStage = a.stage ?? null;
        this.ambientSpot = a.spot ?? null;
        break;
      case 'call': a.fn(this); break;
      case 'snap': this.snapToSeat(); break;
    }
  }

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
