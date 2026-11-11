import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Agent } from '../src/agent.js';
import { Simulation } from '../src/sim.js';
import { AGENTS, COFFEE, STRETCH, LOUNGE, STROLL } from '../src/config.js';
import { canLoaf, LOAF, loafScript } from '../src/ambient.js';

const build = () => {
  const world = new World();
  const agents = AGENTS.map((c) => new Agent(c, world));
  const logs = [];
  const sim = new Simulation({ agents, rand: () => 0, onLog: (e) => logs.push(e) });
  return { world, agents, sim, logs };
};

const step = (agents, sim, seconds, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) {
    sim.update(dt);
    agents.forEach((a) => a.update(dt));
  }
};

test('咖啡位、伸展位、休息位和散步位都能从每个座位走到', () => {
  const { world, agents } = build();
  const spots = [...COFFEE, ...STRETCH, ...LOUNGE, ...STROLL];
  for (const spot of spots) assert.equal(world.walkable(...spot), true, String(spot));
  for (const a of agents) for (const spot of spots) {
    assert.ok(world.findPath(a.seat, spot), `${a.id} -> ${spot}`);
  }
});

test('没收到事件的人不会去摸鱼', () => {
  const { agents, sim } = build();
  for (const a of agents) a.loafIn = 0;
  step(agents, sim, 20);
  for (const a of agents) {
    assert.equal(canLoaf(a), false);
    assert.equal(a.ambient, null);
    assert.deepEqual(a.cell, a.seat);
  }
});

test('实时空闲才会去倒咖啡、活动或坐沙发，而且状态仍是空闲', () => {
  const { agents, sim, logs } = build();
  const qiwen = agents.find((a) => a.id === 'qiwen');
  sim.applyEvent({ agent: 'qiwen', state: 'idle', text: '这会儿没事' });
  step(agents, sim, 2);
  qiwen.presence = 'fresh';
  qiwen.loafIn = 0;
  const before = logs.length;
  let left = false;
  let kind = null;
  for (let t = 0; t < 12; t += 0.1) {
    sim.update(0.1);
    qiwen.update(0.1);
    if (qiwen.ambient) kind = qiwen.ambient;
    if (qiwen.cell.join() !== qiwen.seat.join()) left = true;
    assert.equal(qiwen.state, 'idle');
  }
  assert.equal(left, true);
  assert.ok(LOAF[kind], kind);
  assert.equal(logs.length, before);
  assert.equal(qiwen.text, '这会儿没事');
});

test('重复的 idle 不会把正在摸鱼的人拽回工位', () => {
  const { agents, sim } = build();
  const qiwen = agents.find((a) => a.id === 'qiwen');
  sim.applyEvent({ agent: 'qiwen', state: 'idle', text: '这会儿没事' });
  step(agents, sim, 1);
  qiwen.presence = 'fresh';
  qiwen.loafIn = 0;
  step(agents, sim, 1);
  assert.ok(qiwen.ambient);
  const scriptLen = qiwen.script.length;
  assert.equal(sim.applyEvent({ agent: 'qiwen', state: 'idle', text: '还是没事' }), true);
  assert.equal(qiwen.ambient, 'coffee');
  assert.ok(qiwen.script.length >= scriptLen - 1);
  assert.notEqual(qiwen.script[0]?.type, 'set');
});

test('新的工作会打断摸鱼，过期则停止并走回座位', () => {
  const { agents, sim } = build();
  const qiwen = agents.find((a) => a.id === 'qiwen');
  const guan = agents.find((a) => a.id === 'guan');
  for (const a of [qiwen, guan]) {
    sim.applyEvent({ agent: a.id, state: 'idle', text: '空闲' });
    a.presence = 'fresh';
    a.loafIn = 0;
  }
  step(agents, sim, 1);
  assert.ok(qiwen.ambient);
  assert.ok(guan.ambient);
  guan.presence = 'offline';
  sim.update(0.1);
  assert.equal(guan.ambient, null);
  sim.applyEvent({ agent: 'qiwen', state: 'coding', text: '开始写' });
  assert.equal(qiwen.ambient, null);
  assert.equal(qiwen.prop, null);
  step(agents, sim, 20);
  assert.equal(qiwen.state, 'coding');
  assert.equal(qiwen.text, '开始写');
  assert.deepEqual(qiwen.cell, qiwen.seat);
  assert.deepEqual(guan.cell, guan.seat);
  assert.equal(guan.ambient, null);
});

test('同时空闲的同事预留不同位置，下一轮换一种活动', () => {
  const { agents, sim } = build();
  const active = agents.filter((a) => a.cfg.kind === 'resident');
  for (const a of active) {
    sim.applyEvent({ agent: a.id, state: 'idle', text: '没有任务' });
    a.presence = 'fresh';
    a.loafIn = 0;
  }
  sim.update(0.1);
  const reserved = active.map((a) => a.ambientSpot?.join(',')).filter(Boolean);
  assert.equal(new Set(reserved).size, reserved.length);
  assert.ok(reserved.length >= 6);
  for (const a of active.filter((a) => a.ambientSpot)) {
    assert.ok(!agents.some((other) => other !== a && other.seat.join() === a.ambientSpot.join()));
  }
  const qiwen = agents.find((a) => a.id === 'qiwen');
  qiwen.lastLoaf = 'coffee';
  const choice = sim.ambient.chooseActivity(qiwen);
  assert.ok(choice);
  assert.notEqual(choice.kind, 'coffee');
});

test('休息区坐下留在目的地，结束后再走回自己的座位', () => {
  const { agents, sim } = build();
  const a = agents.find((a) => a.id === 'qiwen');
  sim.applyEvent({ agent: a.id, state: 'idle' });
  a.presence = 'fresh';
  const spot = [5, 9];
  a.interrupt(loafScript(a, 'lounge', spot, 3));
  let sat = false;
  for (let t = 0; t < 20; t += 0.1) {
    a.update(0.1);
    if (a.ambientStage === 'doing') {
      sat = true;
      assert.equal(a.seated, true);
      assert.deepEqual(a.cell, spot);
    }
  }
  assert.ok(sat);
  assert.deepEqual(a.cell, a.seat);
  assert.equal(a.ambient, null);
  assert.equal(a.ambientSpot, null);
});

test('休息演示持续保持空闲，会用到四种活动且不生成任务日志', () => {
  const { agents, sim, logs } = build();
  sim.start({ rest: true });
  const active = agents.filter((a) => a.cfg.kind !== 'on_demand');
  const seen = new Set();
  let moving = false;
  for (let t = 0; t < 90; t += 0.1) {
    sim.update(0.1);
    agents.forEach((a) => a.update(0.1));
    for (const a of active) {
      assert.equal(a.state, 'idle');
      assert.equal(a.text, '【演示】暂时没有任务');
      if (a.ambient) seen.add(a.ambient);
      moving ||= a.moving;
    }
  }
  assert.ok(moving);
  assert.deepEqual([...seen].sort(), Object.keys(LOAF).sort());
  assert.equal(logs.length, 0);
  sim.stop();
  assert.ok(agents.every((a) => a.ambientSpot == null && a.lastSeenTs == null && !a.demoActive));
});

test('任务抢占释放休息位置，刚排定的动作也会因过期取消', () => {
  const { agents, sim } = build();
  const a = agents.find((a) => a.id === 'qiwen');
  sim.applyEvent({ agent: a.id, state: 'idle' });
  a.presence = 'fresh';
  a.loafIn = 0;
  sim.update(0.1);
  assert.ok(a.ambientSpot);
  a.presence = 'stale';
  sim.update(0.1);
  assert.equal(a.ambientSpot, null);
  step(agents, sim, 2);
  a.presence = 'fresh';
  a.loafIn = 0;
  step(agents, sim, 2);
  assert.ok(a.ambientSpot);
  sim.applyEvent({ agent: a.id, state: 'needsYou', text: '请确认' });
  assert.equal(a.state, 'needsYou');
  assert.equal(a.ambientSpot, null);
  assert.equal(a.ambientStage, null);
  assert.equal(a.prop, null);
  step(agents, sim, 20);
  assert.equal(a.state, 'needsYou');
});
