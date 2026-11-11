import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.js';
import { World } from '../src/world.js';
import { Simulation } from '../src/sim.js';
import { AGENTS, INTERACTABLES } from '../src/config.js';
import { LOAF_SPOTS, scenePosition } from '../src/ambient.js';
import { P, boxHitFaces, pointInPolygon } from '../src/iso.js';

function build() {
  const world = new World();
  const agents = AGENTS.map(c => new Agent(c, world));
  const logs = [];
  const sim = new Simulation({agents,rand:()=>0,onLog:e=>logs.push(e)});
  const tick = seconds => {
    for (let i=0;i<seconds;i+=.05) { sim.update(.05); agents.forEach(a=>a.update(.05)); }
  };
  return {sim,agents,logs,tick,a:sim.find('grok')};
}
const data = a => JSON.stringify([a.state,a.text,a.presence,a.taskPresence,a.lastSeenTs,a.lastStatusTs,a.tasks]);

test('四种手动日常均可到达、完成并回工位，不改真实数据或日志', () => {
  for (const kind of ['coffee','lounge','stretch','stroll']) {
    const {sim,a,tick,logs} = build();
    const before = data(a);
    assert.equal(sim.sceneAction(a.id,kind).ok,true);
    assert.equal(a.manualAction,kind);
    assert.ok(LOAF_SPOTS[kind].some(p=>p.join()===a.ambientSpot.join()));
    let doing = false;
    for (let t=0;t<80 && a.manualAction;t+=.1) {
      tick(.1);
      doing ||= a.ambientStage === 'doing';
      assert.equal(data(a),before);
    }
    assert.ok(doing,kind);
    assert.equal(a.manualAction,null,kind);
    assert.deepEqual(a.cell,a.seat);
    assert.equal(a.ambientSpot,null);
    assert.equal(logs.length,0);
  }
});

test('已有工作、待确认、错误或交接时拒绝场景安排，原动作保持', () => {
  for (const state of ['coding','browsing','terminal','thinking','needsYou','error']) {
    const {sim,a} = build();
    sim.applyEvent({agent:a.id,state,text:'真实任务',ts:1});
    const script = a.script;
    assert.equal(sim.sceneAction(a.id,'coffee').ok,false);
    assert.equal(sim.sceneAction(a.id,'home').ok,false);
    assert.equal(a.script,script);
    assert.equal(a.text,'真实任务');
  }
  const {sim,a} = build();
  sim.applyEvent({type:'handoff',agent:a.id,to:'guan',text:'正在交接'});
  const script = a.script;
  assert.equal(sim.sceneAction(a.id,'coffee').ok,false);
  assert.equal(a.script,script);
});

test('回工位取消休息并停留，新的任务立即接管并释放手动动作', () => {
  const {sim,a,tick} = build();
  sim.sceneAction(a.id,'coffee');
  tick(2);
  assert.ok(a.ambientSpot);
  assert.equal(sim.sceneAction(a.id,'home').ok,true);
  assert.equal(a.ambientSpot,null);
  for (let t=0;t<30 && !a.seated;t+=.1) tick(.1);
  assert.ok(a.seated);
  tick(10);
  assert.equal(a.manualAction,'home');
  assert.deepEqual(a.cell,a.seat);
  sim.applyEvent({agent:a.id,state:'coding',text:'真正的工作'});
  assert.equal(a.manualAction,null);
  tick(40);
  assert.deepEqual(a.cell,a.seat);
  assert.equal(a.text,'真正的工作');
  assert.equal(a.ambient,null);
});

test('满员或不可达不覆盖原动作，两人不能预留同一休息位', () => {
  const {sim,a,agents} = build();
  sim.sceneAction(a.id,'stretch');
  const script = a.script, spot = a.ambientSpot;
  LOAF_SPOTS.coffee.forEach((p,i)=>{ agents[i+1].ambientSpot=p; });
  assert.equal(sim.sceneAction(a.id,'coffee').ok,false);
  assert.equal(a.script,script);
  assert.equal(a.ambientSpot,spot);
  agents.slice(1).forEach(other=>{ other.ambientSpot=null; });
  assert.equal(sim.sceneAction(a.id,'coffee').ok,true);
  assert.equal(sim.sceneAction('guan','coffee').ok,true);
  assert.notDeepEqual(a.ambientSpot,sim.find('guan').ambientSpot);
});

test('旧 idle 刷新不中断手动休息，新任务与快照重置都会清理', () => {
  const {sim,a,tick} = build();
  sim.applyEvent({agent:a.id,state:'idle',text:'空闲'});
  sim.sceneAction(a.id,'coffee');
  tick(.1);
  sim.applyEvent({agent:a.id,state:'idle',text:'仍然空闲'});
  assert.equal(a.manualAction,'coffee');
  sim.applyEvent({agent:a.id,state:'needsYou',text:'需要确认'});
  assert.equal(a.manualAction,null);
  assert.equal(a.ambientSpot,null);
  sim.applyEvent({agent:a.id,state:'idle',text:'完成'});
  sim.sceneAction(a.id,'lounge');
  sim.stop();
  assert.equal(a.manualAction,null);
  assert.equal(a.ambientSpot,null);
});

test('工作演示不接受手动动作，休息演示可操作，未入场工具不被唤醒', () => {
  const {sim,a} = build();
  assert.equal(sim.sceneAction('missing','coffee').ok,false);
  assert.equal(sim.sceneAction('eggbot','coffee').ok,false);
  assert.equal(sim.sceneAction(a.id,'__proto__').ok,false);
  sim.start();
  assert.equal(sim.sceneAction(a.id,'coffee').ok,false);
  sim.stop();
  sim.start({rest:true});
  assert.equal(sim.sceneAction(a.id,'coffee').ok,true);
});

test('家具的可点击区域涵盖实际顶面与前面，不使用矩形空白作为命中区', () => {
  for (const item of INTERACTABLES) {
    const [x,y,w,d,h]=item.bounds;
    const faces=boxHitFaces(item.bounds);
    const hit=p=>faces.some(face=>pointInPolygon(p,face));
    assert.equal(hit(P(x+w/2,y+d/2,h)),true,item.id);
    assert.equal(hit(P(x+w/2,y+d,h/2)),true,item.id);
    const points=faces.flat();
    const minX=Math.min(...points.map(p=>p[0])), minY=Math.min(...points.map(p=>p[1]));
    assert.equal(hit([minX+1,minY+1]),false,item.id);
  }
});

test('沙发坐姿落在坐垫内，两人分开坐，新任务解除家具位置', () => {
  const {sim,a,tick} = build();
  sim.sceneAction(a.id,'lounge');
  sim.sceneAction('guan','lounge');
  assert.equal(sim.sceneAction('newbee','lounge').ok,false);
  for (let t=0;t<40 && a.ambientStage !== 'doing';t+=.1) tick(.1);
  const [x,y,z] = scenePosition(a);
  assert.ok(x > 5 && x < 8 && y > 8.28 && y < 9 && z > 0);
  assert.ok(a.world.walkable(...a.cell));
  assert.notDeepEqual(a.ambientSpot,sim.find('guan').ambientSpot);
  sim.applyEvent({agent:a.id,state:'coding',text:'回去处理任务'});
  assert.deepEqual(scenePosition(a),[a.x,a.y,0]);
});
