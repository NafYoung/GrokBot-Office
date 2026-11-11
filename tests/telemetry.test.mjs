import test from 'node:test';
import assert from 'node:assert/strict';
import { taskPanel, diagnosticPanel, connectorPanel, activeTasks } from '../src/telemetry.js';
import { Agent } from '../src/agent.js';
import { World } from '../src/world.js';
import { AGENTS } from '../src/config.js';
import { Simulation } from '../src/sim.js';

test('任务和网关内容只能作为文本显示，过期任务不伪装实时', () => {
  const attack = '<img src=x onerror="window.pwned=1">';
  const a = {tasks:[{taskId:attack, text:attack, phase:'started', updatedAt:1, source:'reporter'},
    {taskId:'done',text:'完成',phase:'completed',updatedAt:2,source:'external'}],
    diagnostic:{lastError:attack, lastRejectedAt:2},runtime:{text:attack,ts:1}};
  const html = taskPanel(a,1000) + diagnosticPanel(a,1000) + connectorPanel({message:attack,unmappedNames:[attack]},1000);
  assert.equal(activeTasks(a).length, 1);
  assert.ok(html.includes('状态过期'));
  assert.ok(html.includes('观察已过期'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('相同状态的静默刷新保留活动姿势，重置演示时清除真实元数据', () => {
  const a = new Agent(AGENTS[0], new World());
  const logs=[];
  const sim = new Simulation({agents:[a],onLog:e=>logs.push(e)});
  const ev={type:'status',agent:a.id,state:'idle',text:'确认空闲',ts:10,seen:10,seq:1,epoch:'e',tasks:[]};
  sim.applyEvent(ev,{quiet:true});
  a.activityKind='coffee';
  const script=a.script;
  sim.applyEvent({...ev,seq:2,ts:20,seen:20,tasks:[{taskId:'new'}],diagnostic:{source:'reporter'}},{quiet:true,keepPose:true});
  assert.equal(a.activityKind,'coffee');
  assert.equal(a.script,script);
  assert.equal(a.lastStatusTs,20);
  assert.equal(a.tasks[0].taskId,'new');
  assert.equal(logs.length,0);
  sim.stop();
  assert.deepEqual(a.tasks,[]);
  assert.deepEqual(a.diagnostic,{});
  assert.equal(a.runtime,null);
});
