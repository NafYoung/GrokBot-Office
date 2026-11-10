import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPresence, formatAge, statusCaption, parseFreshnessParams } from '../src/presence.js';
import { STATES, PRESENCE } from '../src/config.js';

test('没收到事件：预期联系为未知，配置未接入为未连接', () => {
  assert.equal(classifyPresence({ contact: 'expected', lastSeenTs: null, nowSec: 100, staleAfterSec: 10, offlineAfterSec: 30 }), 'unknown');
  assert.equal(classifyPresence({ contact: 'unconnected', lastSeenTs: null, nowSec: 100, staleAfterSec: 10, offlineAfterSec: 30 }), 'unconnected');
});

test('按时间分成实时 / 过期 / 离线', () => {
  const base = { contact: 'expected', lastSeenTs: 100, staleAfterSec: 10, offlineAfterSec: 30 };
  assert.equal(classifyPresence({ ...base, nowSec: 105 }), 'fresh');
  assert.equal(classifyPresence({ ...base, nowSec: 115 }), 'stale');
  assert.equal(classifyPresence({ ...base, nowSec: 140 }), 'offline');
});

test('演示模式只要有事件就当新鲜，避免和实时混在一起', () => {
  assert.equal(classifyPresence({ contact: 'expected', lastSeenTs: 1, nowSec: 999, staleAfterSec: 1, offlineAfterSec: 2, demo: true }), 'fresh');
  assert.equal(classifyPresence({ contact: 'unconnected', lastSeenTs: null, nowSec: 999, staleAfterSec: 1, offlineAfterSec: 2, demo: true }), 'unconnected');
});

test('相对时间文案', () => {
  assert.equal(formatAge(null, 10), '尚无事件');
  assert.equal(formatAge(10, 12), '刚刚');
  assert.equal(formatAge(10, 40), '30 秒前');
  assert.equal(formatAge(10, 130), '2 分钟前');
});

test('状态标题：过期时仍保留上次工作类型', () => {
  assert.equal(statusCaption({ presence: 'fresh', state: 'coding', STATES, PRESENCE }), '写代码');
  assert.equal(statusCaption({ presence: 'stale', state: 'coding', STATES, PRESENCE }), '过期 · 写代码');
  assert.equal(statusCaption({ presence: 'unconnected', state: 'idle', STATES, PRESENCE }), '未连接');
  assert.equal(statusCaption({ presence: 'unknown', state: 'idle', STATES, PRESENCE }), '未知');
  assert.equal(statusCaption({ presence: 'unknown', state: 'idle', STATES, PRESENCE, kind: 'on_demand' }), '未在岗');
});

test('URL 可覆盖新鲜度阈值，方便验收过期，不改默认配置', () => {
  assert.deepEqual(
    parseFreshnessParams('?stale=2&offline=8', { staleAfterSec: 180, offlineAfterSec: 900 }),
    { staleAfterSec: 2, offlineAfterSec: 8 },
  );
  assert.deepEqual(
    parseFreshnessParams('', { staleAfterSec: 180, offlineAfterSec: 900 }),
    { staleAfterSec: 180, offlineAfterSec: 900 },
  );
});
