import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Agent } from '../src/agent.js';
import { Simulation, SYNC } from '../src/sim.js';
import { AGENTS, GATHER, LOUNGE, STATES } from '../src/config.js';
import { classifyPresence } from '../src/presence.js';

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const build = (seed = 1) => {
  const world = new World();
  const agents = AGENTS.map((c) => new Agent(c, world));
  const logs = [];
  const sim = new Simulation({ agents, rand: mulberry32(seed), onLog: (e) => logs.push(e) });
  return { world, agents, sim, logs };
};

const run = (agents, sim, seconds, step = 0.05) => {
  for (let t = 0; t < seconds; t += step) { sim.update(step); agents.forEach((a) => a.update(step)); }
};

test('每个座位、访客位、会议位、休息位都可走', () => {
  const { world, agents } = build();
  for (const a of agents.filter((x) => x.cfg.kind !== 'on_demand')) {
    assert.ok(world.walkable(...a.seat), `${a.id} seat ${a.seat}`);
    assert.ok(world.walkable(...a.visit), `${a.id} visit ${a.visit}`);
  }
  for (const c of [...GATHER, ...LOUNGE]) assert.ok(world.walkable(...c), `cell ${c}`);
});

test('任意两个有席位的人之间都有路', () => {
  const { world, agents } = build();
  const seated = agents.filter((a) => a.cfg.kind !== 'on_demand');
  for (const a of seated) for (const b of seated) {
    assert.ok(world.findPath(a.seat, b.visit) !== null, `${a.id} -> ${b.id}`);
  }
});

test('玻璃前台只能从门洞 (6,2)<->(6,3) 进出', () => {
  const { world } = build();
  const path = world.findPath([4, 5], [5, 1]);
  assert.ok(path);
  const cells = path.map((c) => c.join(','));
  assert.ok(cells.includes('6,3') && cells.includes('6,2'), `path ${cells}`);
  assert.equal(world.crossesWall(5, 2, 5, 3), true);
  assert.equal(world.crossesWall(6, 2, 6, 3), false);
});

test('桌子格子不可走', () => {
  const { world, agents } = build();
  for (const a of agents.filter((x) => x.hasDesk)) {
    const desk = a.cfg.desk;
    assert.equal(world.walkable(desk.x, desk.y), false);
  }
});

test('默认不跑演示：没事件就是未知/未连接，不会自己变成写代码', () => {
  const { agents, sim } = build();
  run(agents, sim, 5);
  for (const a of agents) {
    assert.equal(a.state, 'idle');
    assert.equal(a.text, '');
    const presence = classifyPresence({
      contact: a.cfg.contact, lastSeenTs: a.lastSeenTs, nowSec: 10,
      staleAfterSec: 3, offlineAfterSec: 9,
    });
    assert.equal(presence, a.cfg.contact === 'unconnected' ? 'unconnected' : 'unknown');
  }
});

test('演示 5 分钟：状态合法、开过会、有过交接', () => {
  const { agents, sim, logs } = build(7);
  sim.start();
  const seen = new Set();
  let maxInOffice = 0;
  for (let t = 0; t < 300; t += 0.05) {
    sim.update(0.05);
    for (const a of agents) {
      a.update(0.05);
      assert.ok(STATES[a.state], `bad state ${a.state}`);
      assert.ok(a.x >= 0 && a.y >= 0 && a.x <= 14 && a.y <= 10, `${a.id} out of bounds`);
      seen.add(a.state);
    }
    const inOffice = agents.filter((a) => a.x >= 5 && a.x < 9 && a.y < 3).length;
    maxInOffice = Math.max(maxInOffice, inOffice);
  }
  assert.ok(logs.some((l) => l.text.includes('全员') || l.text.includes(SYNC.log)), '应该开过会');
  assert.ok(logs.some((l) => l.demo && /【演示】/.test(l.text) && l.text.includes('交')), '应该有演示交接');
  assert.ok(maxInOffice >= 7, `开会时前台至少 7 人, 实际 ${maxInOffice}`);
  assert.ok(seen.has('coding') && seen.has('browsing') && seen.has('thinking'));
});

test('开会期间 grok 不会比其他人先散会', () => {
  const { agents, sim } = build(5);
  sim.start();
  const grok = agents.find((a) => a.id === 'grok');
  const others = agents.filter((a) => a !== grok && a.cfg.kind === 'resident');
  let syncStarted = false, violations = 0;
  for (let t = 0; t < 60; t += 0.05) {
    sim.update(0.05);
    agents.forEach((a) => a.update(0.05));
    if (others.some((a) => a.text === SYNC.here)) syncStarted = true;
    const inMeeting = others.some((a) => a.text === SYNC.here);
    if (inMeeting && grok.text !== SYNC.lead) violations++;
  }
  assert.ok(syncStarted, '60 秒内应该开过会');
  assert.equal(violations, 0);
});

test('退出演示后所有人回到未知/未连接，不再沿用演示状态', () => {
  const { agents, sim } = build(2);
  sim.start();
  run(agents, sim, 8);
  sim.stop();
  for (const a of agents) {
    assert.equal(a.state, 'idle');
    assert.equal(a.text, '');
    assert.equal(a.lastSeenTs, null);
    assert.deepEqual(a.cell, a.seat);
    assert.equal(a.seated, true);
    assert.equal(a.presence, a.cfg.contact === 'unconnected' ? 'unconnected' : 'unknown');
  }
});

test('handoff 事件：走过去、交接、走回来、恢复原状态', () => {
  const { agents, sim, logs } = build();
  const grok = agents.find((a) => a.id === 'grok');
  const zhuxian = agents.find((a) => a.id === 'zhuxian');
  sim.applyEvent({ type: 'status', agent: 'grok', state: 'terminal', text: '在分派任务' });
  run(agents, sim, 8);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'Grok Bot', to: 'zhuxian', text: '把实验说明交给总管' }), true);
  let reached = false, carried = false;
  for (let t = 0; t < 30; t += 0.05) {
    run(agents, sim, 0.05, 0.05);
    if (grok.cell.join() === zhuxian.visit.join()) reached = true;
    if (grok.carry) carried = true;
  }
  assert.ok(reached, '应该走到学习总管的访客位');
  assert.ok(carried, '路上应该拿着材料');
  assert.ok(logs.some((l) => l.text === '把实验说明交给总管'));
  assert.deepEqual(grok.cell, grok.seat);
  assert.equal(grok.carry, false);
  assert.equal(grok.state, 'terminal');
  assert.equal(grok.text, '在分派任务');
});

test('sync 事件：开完会恢复各自真实状态', () => {
  const { agents, sim } = build();
  const real = { grok: ['coding', 'A'], newbee: ['browsing', 'S'], guan: ['terminal', 'F'] };
  for (const [id, [state, text]] of Object.entries(real)) sim.applyEvent({ agent: id, state, text });
  run(agents, sim, 8);
  assert.equal(sim.applyEvent({ type: 'sync' }), true);
  run(agents, sim, 5);
  assert.ok(agents.some((a) => a.text === SYNC.here || a.text === SYNC.lead));
  run(agents, sim, 30);
  for (const [id, [state, text]] of Object.entries(real)) {
    const a = agents.find((x) => x.id === id);
    assert.deepEqual([a.state, a.text], [state, text], id);
    assert.deepEqual(a.cell, a.seat);
  }
});

test('快照恢复是瞬移回工位，不会集体走一遍', () => {
  const { agents, sim } = build();
  const guan = agents.find((a) => a.id === 'guan');
  guan.x = 1.5; guan.y = 8.5; guan.seated = false;
  assert.equal(sim.applyEvent({ agent: 'guan', state: 'coding', text: '写早间简报', ts: 1 }, { immediate: true }), true);
  assert.deepEqual(guan.cell, guan.seat);
  assert.equal(guan.seated, true);
  assert.equal(guan.state, 'coding');
  assert.equal(guan.moving, false);
});

test('无效事件被忽略；已撤席的 id 也找不到', () => {
  const { agents, sim } = build();
  const before = agents.map((a) => `${a.state}|${a.text}`);
  assert.equal(sim.applyEvent({ agent: 'grok', state: 'sleeping', text: 'x' }), false);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'grok', to: 'grok' }), false);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'grok', to: 'ghost' }), false);
  assert.equal(sim.applyEvent({ type: 'nonsense', agent: 'grok' }), false);
  assert.equal(sim.applyEvent({ agent: 'python-roadmap', state: 'coding', text: 'x' }), false);
  run(agents, sim, 1);
  assert.deepEqual(agents.map((a) => `${a.state}|${a.text}`), before);
});

test('find() 支持 id、中文名、别名', () => {
  const { sim } = build();
  assert.equal(sim.find('观世界').id, 'guan');
  assert.equal(sim.find(' GROK BOT ').id, 'grok');
  assert.equal(sim.find('JD调研').id, 'diaoyan');
  assert.equal(sim.find('主线资料员').id, 'ziliao');
  assert.equal(sim.find('nobody'), null);
  assert.equal(sim.find(undefined), null);
});

test('applyEvent 能驱动真实事件，文案不含演示标记', () => {
  const { agents, sim, logs } = build();
  assert.equal(sim.applyEvent({ agent: 'grok', state: 'coding', text: 'Real task' }), true);
  const grok = agents.find((a) => a.id === 'grok');
  grok.update(0.1);
  assert.equal(grok.state, 'coding');
  assert.equal(grok.text, 'Real task');
  assert.ok(logs.some((l) => l.text === 'Real task' && l.demo === false));
  assert.equal(sim.applyEvent({ agent: 'nobody', state: 'coding', text: 'x' }), false);
});
