import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Agent } from '../src/agent.js';
import { Simulation } from '../src/sim.js';
import { AGENTS, DESKS, GATHER, LOUNGE, STATES } from '../src/config.js';

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
  const agents = AGENTS.map((c) => new Agent(c, DESKS[c.id], world));
  const logs = [];
  const sim = new Simulation({ agents, rand: mulberry32(seed), onLog: (e) => logs.push(e) });
  return { world, agents, sim, logs };
};

test('每个座位、访客位、会议位、休息位都可走', () => {
  const { world, agents } = build();
  for (const a of agents) {
    assert.ok(world.walkable(...a.seat), `${a.id} seat`);
    assert.ok(world.walkable(...a.visit), `${a.id} visit`);
  }
  for (const c of [...GATHER, ...LOUNGE]) assert.ok(world.walkable(...c), `cell ${c}`);
});

test('任意两个座位之间都有路', () => {
  const { world, agents } = build();
  for (const a of agents) for (const b of agents) {
    assert.ok(world.findPath(a.seat, b.visit) !== null, `${a.id} -> ${b.id}`);
  }
});

test('Alfred 办公室只能从门洞(6,2)<->(6,3)进出', () => {
  const { world } = build();
  const path = world.findPath([4, 5], [5, 1]);
  assert.ok(path);
  const cells = path.map((c) => c.join(','));
  assert.ok(cells.includes('6,3') && cells.includes('6,2'), `path ${cells}`);
  // 直接穿墙是不允许的
  assert.equal(world.crossesWall(5, 2, 5, 3), true);
  assert.equal(world.crossesWall(6, 2, 6, 3), false);
});

test('桌子格子不可走,路径不会穿过家具', () => {
  const { world, agents } = build(3);
  for (const a of agents) {
    for (const b of agents) {
      const p = world.findPath(a.seat, b.visit);
      for (const [x, y] of p) assert.ok(world.walkable(x, y));
    }
  }
});

test('模拟 5 分钟:不报错、状态合法、发生过会议和交接', () => {
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
  assert.ok(logs.some((l) => l.text.includes('team sync')), '应该发生过全员会议');
  assert.ok(logs.some((l) => /Dropped off|Delivered|Handed over|Took the/.test(l.text)), '应该发生过交接');
  assert.ok(maxInOffice >= 7, `会议时办公室里至少 7 人,实际 ${maxInOffice}`);
  assert.ok(seen.has('coding') && seen.has('browsing') && seen.has('thinking'));
});

test('开会期间 Alfred 不会比其他人先散会', () => {
  const { agents, sim } = build(5);
  sim.start();
  const alfred = agents.find((a) => a.id === 'alfred');
  const others = agents.filter((a) => a !== alfred);
  let syncStarted = false, violations = 0;
  for (let t = 0; t < 60; t += 0.05) {
    sim.update(0.05);
    agents.forEach((a) => a.update(0.05));
    if (others.some((a) => a.text === 'In the team sync with Alfred')) syncStarted = true;
    const inMeeting = others.some((a) => a.text === 'In the team sync with Alfred');
    if (inMeeting && alfred.text !== 'Running the team sync') violations++;
  }
  assert.ok(syncStarted, '60 秒内应该开过会');
  assert.equal(violations, 0);
});

test('stop() 后所有人回到工位并 Idle', () => {
  const { agents, sim } = build(2);
  sim.start();
  for (let t = 0; t < 20; t += 0.05) { sim.update(0.05); agents.forEach((a) => a.update(0.05)); }
  sim.stop();
  for (let t = 0; t < 30; t += 0.05) { sim.update(0.05); agents.forEach((a) => a.update(0.05)); }
  for (const a of agents) {
    assert.equal(a.state, 'idle');
    assert.deepEqual(a.cell, a.seat);
    assert.equal(a.seated, true);
  }
});

const run = (agents, sim, seconds, step = 0.05) => {
  for (let t = 0; t < seconds; t += step) { sim.update(step); agents.forEach((a) => a.update(step)); }
};

test('handoff 事件:走过去、交接、走回来、恢复原状态', () => {
  const { agents, sim, logs } = build();
  const fetch = agents.find((a) => a.id === 'fetch');
  const claim = agents.find((a) => a.id === 'claim');
  sim.applyEvent({ type: 'status', agent: 'fetch', state: 'terminal', text: 'Running checklist' });
  run(agents, sim, 1);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'Fetch', to: 'claim', text: 'Dropped a parcel' }), true);
  let reachedClaim = false, carried = false;
  for (let t = 0; t < 30; t += 0.05) {
    run(agents, sim, 0.05, 0.05);
    if (fetch.cell.join() === claim.visit.join()) reachedClaim = true;
    if (fetch.carry) carried = true;
  }
  assert.ok(reachedClaim, '应该走到 Claim 的访客位');
  assert.ok(carried, '路上应该拿着包裹');
  assert.ok(logs.some((l) => l.text === 'Dropped a parcel'));
  assert.deepEqual(fetch.cell, fetch.seat);
  assert.equal(fetch.carry, false);
  assert.equal(fetch.state, 'terminal');
  assert.equal(fetch.text, 'Running checklist');
});

test('sync 事件:全员开会后恢复各自的真实状态', () => {
  const { agents, sim } = build();
  const real = { atlas: ['coding', 'A'], scout: ['browsing', 'S'], fetch: ['terminal', 'F'] };
  for (const [id, [state, text]] of Object.entries(real)) sim.applyEvent({ agent: id, state, text });
  run(agents, sim, 1);
  assert.equal(sim.applyEvent({ type: 'sync' }), true);
  run(agents, sim, 5);
  assert.ok(agents.some((a) => a.text === 'In the team sync with Alfred'));
  run(agents, sim, 30);
  for (const [id, [state, text]] of Object.entries(real)) {
    const a = agents.find((x) => x.id === id);
    assert.deepEqual([a.state, a.text], [state, text], id);
    assert.deepEqual(a.cell, a.seat);
  }
});

test('无效事件被忽略,不改变任何人', () => {
  const { agents, sim } = build();
  const before = agents.map((a) => `${a.state}|${a.text}`);
  assert.equal(sim.applyEvent({ agent: 'atlas', state: 'sleeping', text: 'x' }), false);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'atlas', to: 'atlas' }), false);
  assert.equal(sim.applyEvent({ type: 'handoff', agent: 'atlas', to: 'ghost' }), false);
  assert.equal(sim.applyEvent({ type: 'nonsense', agent: 'atlas' }), false);
  run(agents, sim, 2);
  assert.deepEqual(agents.map((a) => `${a.state}|${a.text}`), before);
});

test('find() 支持 id 和显示名(不分大小写)', () => {
  const { sim } = build();
  assert.equal(sim.find('DRONE BUSINESS').id, 'drone');
  assert.equal(sim.find(' atlas ').id, 'atlas');
  assert.equal(sim.find('nobody'), null);
  assert.equal(sim.find(undefined), null);
});

test('applyEvent 能驱动真实事件', () => {
  const { agents, sim, logs } = build();
  assert.equal(sim.applyEvent({ agent: 'atlas', state: 'coding', text: 'Real task' }), true);
  const atlas = agents.find((a) => a.id === 'atlas');
  atlas.update(0.1);
  assert.equal(atlas.state, 'coding');
  assert.equal(atlas.text, 'Real task');
  assert.ok(logs.some((l) => l.text === 'Real task'));
  assert.equal(sim.applyEvent({ agent: 'nobody', state: 'coding', text: 'x' }), false);
});
