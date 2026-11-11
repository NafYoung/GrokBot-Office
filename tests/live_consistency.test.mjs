import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.js';
import { World } from '../src/world.js';
import { Simulation, SYNC } from '../src/sim.js';
import { AGENTS, FRESHNESS } from '../src/config.js';
import { canLoaf } from '../src/ambient.js';
import { hasFreshTask } from '../src/presence.js';

function build() {
  const world = new World();
  const agents = AGENTS.map(c => new Agent(c, world));
  const logs = [];
  const sim = new Simulation({ agents, rand: () => 0, onLog: e => logs.push(e) });
  const tick = (seconds) => {
    for (let t = 0; t < seconds; t += .05) {
      sim.update(.05);
      agents.forEach(a => a.update(.05));
    }
  };
  return { agents, sim, tick, logs, grok: sim.find('grok'), guan: sim.find('guan') };
}

test('连续交接和会议互相打断时，任务内容与状态始终不被动画覆盖', () => {
  for (const actions of [ ['handoff', 'handoff'], ['handoff', 'sync'], ['sync', 'handoff'], ['sync', 'sync'] ]) {
    const { sim, tick, grok, guan } = build();
    sim.applyEvent({ agent: 'grok', state: 'coding', text: '真实主任务' });
    sim.applyEvent({ agent: 'guan', state: 'browsing', text: '真实搜索任务' });
    for (const type of actions) {
      sim.applyEvent({ type, agent: 'grok', to: 'guan', text: '交接内容' });
      tick(.5);
      assert.ok(grok.activityLabel, actions.join(' → '));
      assert.deepEqual([grok.state, grok.text], ['coding', '真实主任务']);
      assert.deepEqual([guan.state, guan.text], ['browsing', '真实搜索任务']);
    }
    tick(60);
    for (const a of [grok, guan]) {
      assert.equal(a.activityLabel, '');
      assert.equal(a.activityKind, null);
      assert.deepEqual(a.cell, a.seat);
    }
    assert.deepEqual([grok.state, grok.text], ['coding', '真实主任务']);
    assert.deepEqual([guan.state, guan.text], ['browsing', '真实搜索任务']);
  }
});

test('只有交接不伪造任务；随后收到 idle 也会停止交接动画', () => {
  const { sim, tick, grok } = build();
  sim.applyEvent({ type: 'handoff', agent: 'grok', to: 'guan', text: '交接说明' });
  tick(.5);
  assert.equal(grok.text, '');
  assert.equal(grok.lastStatusTs, null);
  assert.equal(hasFreshTask(grok), false);
  sim.applyEvent({ agent: 'grok', state: 'idle', text: '任务完成' });
  assert.equal(grok.activityKind, null);
  assert.equal(grok.text, '任务完成');
  tick(1);
  assert.equal(grok.state, 'idle');
  assert.equal(grok.text, '任务完成');
});

test('任务完成立即打断会议，之后不会恢复旧任务', () => {
  const { sim, tick, grok } = build();
  sim.applyEvent({ agent: 'grok', state: 'coding', text: '进行中' });
  sim.applyEvent({ type: 'sync' });
  tick(.5);
  sim.applyEvent({ agent: 'grok', state: 'idle', text: '已完成' });
  assert.equal(grok.activityKind, null);
  tick(30);
  assert.deepEqual([grok.state, grok.text], ['idle', '已完成']);
});

test('新交接不会让过期任务重新变成新鲜，刷新快照结果一致', () => {
  for (const state of ['coding', 'idle', 'needsYou', 'error']) {
    const { sim, grok, guan } = build();
    const now = Date.now() / 1000;
    const old = now - FRESHNESS.staleAfterSec - 10;
    sim.applyEvent({ agent: 'grok', state, text: '旧任务状态', ts: old, seq: 1 });
    sim.applyEvent({ type: 'handoff', agent: 'grok', to: 'guan', ts: now, seq: 2 });
    assert.equal(grok.presence, 'fresh');
    assert.equal(grok.taskPresence, 'stale');
    assert.equal(hasFreshTask(grok), false);
    assert.equal(canLoaf(grok), false);
    assert.equal(grok.lastStatusTs, old);
    assert.equal(guan.lastSeenTs, null, '不能把交接目标当作已上报');
    sim.stop();
    sim.applyEvent({ agent: 'grok', state, text: '旧任务状态', ts: old, seen: now, seq: 2 }, { immediate: true });
    assert.equal(grok.presence, 'fresh');
    assert.equal(hasFreshTask(grok), false);
    assert.equal(canLoaf(grok), false);
    sim.applyEvent({ agent: 'grok', state, text: '最新状态', ts: now, seq: 3 });
    assert.equal(hasFreshTask(grok), true);
  }
});

test('任务时间独立过期，旧 idle 不会因为新的联系时间继续摸鱼', () => {
  const { sim, tick, grok } = build();
  const now = Date.now() / 1000;
  sim.applyEvent({ agent: 'grok', state: 'idle', text: '等待任务', ts: now });
  grok.loafIn = 0;
  tick(.5);
  assert.ok(grok.ambient);
  grok.lastSeenTs = now + FRESHNESS.staleAfterSec;
  sim.refreshPresence(now + FRESHNESS.staleAfterSec + 1);
  assert.equal(grok.presence, 'fresh');
  assert.equal(canLoaf(grok), false);
  tick(.1);
  assert.equal(grok.ambient, null);
});

test('全员会议只带动新鲜成员，未上报或过期的主持人不能凭空开会', () => {
  const { sim, tick, agents, grok, guan, logs } = build();
  const now = Date.now() / 1000;
  sim.applyEvent({ agent: 'guan', state: 'browsing', ts: now });
  tick(.1);
  sim.applyEvent({ type: 'sync' });
  tick(.1);
  assert.ok(agents.every(a => !a.activityKind));
  assert.equal(logs.at(-1).text, SYNC.liveLog, '记录请求，不声称未上报成员已经参加会议');
  sim.applyEvent({ agent: 'grok', state: 'coding', ts: now });
  sim.applyEvent({ agent: 'newbee', state: 'coding', ts: now - FRESHNESS.staleAfterSec - 1 }, { immediate: true });
  sim.applyEvent({ agent: 'shiyan', state: 'terminal', ts: now - FRESHNESS.offlineAfterSec - 1 }, { immediate: true });
  sim.applyEvent({ type: 'sync' });
  tick(.2);
  assert.equal(grok.activityKind, 'sync');
  assert.equal(guan.activityKind, 'sync');
  for (const a of agents.filter(a => !['grok', 'guan'].includes(a.id))) {
    assert.equal(a.activityKind, null, a.id);
    assert.deepEqual(a.cell, a.seat, a.id);
  }
  sim.refreshPresence(now + FRESHNESS.offlineAfterSec + 1);
  tick(.1);
  assert.equal(grok.activityKind, null);
  assert.equal(guan.activityKind, null);
});
