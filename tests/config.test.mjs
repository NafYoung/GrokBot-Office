import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, DESKS, RETIRED, CONVENE_ID } from '../src/config.js';

const ids = (kind) => AGENTS.filter((a) => a.kind === kind).map((a) => a.id);

test('八个主工位名单固定，且都有桌子', () => {
  assert.deepEqual(ids('resident').sort(), ['diaoyan', 'grok', 'guan', 'mianshi', 'newbee', 'qiwen', 'zhishiku', 'zhuxian']);
  for (const a of AGENTS.filter((x) => x.kind === 'resident')) {
    assert.ok(a.desk, `${a.id} 缺 desk`);
    assert.equal(DESKS[a.id], a.desk);
  }
  assert.equal(Object.keys(DESKS).length, 8);
});

test('diaoyan / mianshi 保留席位并标成未连接', () => {
  assert.equal(AGENTS.find((a) => a.id === 'diaoyan').contact, 'unconnected');
  assert.equal(AGENTS.find((a) => a.id === 'mianshi').contact, 'unconnected');
  assert.ok(DESKS.diaoyan && DESKS.mianshi);
});

test('学习总管的三个助手在辅助区，不占主席', () => {
  assert.deepEqual(ids('auxiliary').sort(), ['shiyan', 'yanshou', 'ziliao']);
  for (const id of ['ziliao', 'shiyan', 'yanshou']) {
    const a = AGENTS.find((x) => x.id === id);
    assert.equal(a.kind, 'auxiliary');
    assert.ok(a.spot);
    assert.equal(DESKS[id], undefined);
  }
});

test('Dr Eggbot 按需，不常驻；休眠 bot 没有席位', () => {
  const egg = AGENTS.find((a) => a.id === 'eggbot');
  assert.equal(egg.kind, 'on_demand');
  assert.equal(DESKS.eggbot, undefined);
  const retiredIds = RETIRED.map((r) => r.id);
  assert.ok(retiredIds.includes('python-roadmap'));
  assert.ok(retiredIds.includes('lunwen'));
  assert.equal(AGENTS.some((a) => a.id === 'python-roadmap' || a.name.includes('Python Roadmap')), false);
  assert.equal(AGENTS.some((a) => a.name.includes('论文')), false);
});

test('JD调研是调研简报的别名，召集人是 grok', () => {
  const d = AGENTS.find((a) => a.id === 'diaoyan');
  assert.ok(d.aliases.some((al) => al.toLowerCase().includes('jd')));
  assert.equal(CONVENE_ID, 'grok');
});

test('演示文案带标记，避免被当成实时', () => {
  for (const a of AGENTS) {
    for (const t of a.demo?.tasks || []) assert.match(t.text, /【演示】/);
    for (const h of a.demo?.handoffs || []) assert.match(h.text, /【演示】/);
  }
});
