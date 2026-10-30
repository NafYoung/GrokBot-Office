// 渲染器:把 world + agents 画到 canvas。只读状态,不改状态。
// 画面分层:  背景(墙/窗/地板/地毯) → 按深度排序的物体(家具+小人) → 光照色调 → 夜间发光 → 名字标签
import { GRID, DESKS, RUGS, WALLS, STATES } from './config.js';
import {
  TW, TH, ZU, P, box, cyl, blob, quad3, poly, ellipseFloor, shade, rgb, hexToRgb,
  planeText, planeTransform,
} from './iso.js';

const W = GRID.w, D = GRID.d, WALL_H = 3.3, FLOOR_T = 0.3;

// ---------- 光照 ----------
const LIGHTS = {
  day:     { tint: [255, 255, 255, 0],  skyTop: [90, 169, 230], skyBot: [207, 233, 251], night: 0 },
  evening: { tint: [255, 105, 40, 0.22], skyTop: [59, 58, 122],  skyBot: [255, 154, 90],  night: 0.3 },
  night:   { tint: [10, 18, 60, 0.5],   skyTop: [5, 10, 28],     skyBot: [22, 36, 77],    night: 1 },
};

export function lightKey(mode, date = new Date()) {
  if (mode !== 'now') return mode;
  const h = date.getHours();
  return h >= 7 && h < 17 ? 'day' : h >= 17 && h < 19 ? 'evening' : 'night';
}

export const makeLight = (key) => structuredClone(LIGHTS[key]);

// 每帧朝目标靠近一点,切换时间段就有渐变
export function lerpLight(cur, key, k) {
  const tgt = LIGHTS[key];
  const mix = (a, b) => a + (b - a) * k;
  cur.tint = cur.tint.map((v, i) => mix(v, tgt.tint[i]));
  cur.skyTop = cur.skyTop.map((v, i) => mix(v, tgt.skyTop[i]));
  cur.skyBot = cur.skyBot.map((v, i) => mix(v, tgt.skyBot[i]));
  cur.night = mix(cur.night, tgt.night);
}

// ---------- 静态数据 ----------
const rand01 = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const SKYLINE = [];
for (let x = 5; x < 14; ) {
  const w = 0.35 + rand01() * 0.45;
  SKYLINE.push({ x, w, h: 0.35 + rand01() * 1.1, lit: [rand01(), rand01(), rand01()] });
  x += w * 0.92;
}
const WOODS = ['#c98a4b', '#c4813f', '#cf9356', '#bf7a3c'];
const hash = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0);
const WORKING = new Set(['coding', 'browsing', 'terminal', 'thinking', 'error', 'needsYou']);

// ---------- 背景 ----------
function drawFloor(ctx) {
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      poly(ctx, [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], WOODS[(hash(x, y) >> 3) % 4]);
      // 木地板的缝
      ctx.strokeStyle = 'rgba(60,30,10,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of [0.34, 0.67]) {
        const a = P(x, y + f), b = P(x + 1, y + f);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
  }
  // 地板侧面厚度
  quad3(ctx, [[0, D, 0], [W, D, 0], [W, D, -FLOOR_T], [0, D, -FLOOR_T]], '#4a3424');
  quad3(ctx, [[W, 0, 0], [W, D, 0], [W, D, -FLOOR_T], [W, 0, -FLOOR_T]], '#34261b');
}

function drawRugs(ctx) {
  for (const r of RUGS) {
    const q = (i) => [[r.x0 + i, r.y0 + i, 0], [r.x1 - i, r.y0 + i, 0], [r.x1 - i, r.y1 - i, 0], [r.x0 + i, r.y1 - i, 0]];
    quad3(ctx, q(0), shade(r.color, 0.24));
    ctx.save();
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 12;
    quad3(ctx, q(0.08), null, r.color, 2.5);
    ctx.restore();
    planeText(ctx, 'floor', r.label, r.x0 + 0.22, r.y1 - 0.3, 0.2, 'rgba(255,255,255,0.78)');
  }
  // 休息区绿色圆地毯
  ellipseFloor(ctx, 6.5, 8.95, 0, 2.35, 1.05, '#2f8a4b');
  ellipseFloor(ctx, 6.5, 8.95, 0, 2.15, 0.9, null, 'rgba(255,255,255,0.18)', 2);
}

function drawBackWalls(ctx, L, t) {
  const H = WALL_H;
  quad3(ctx, [[0, 0, 0], [0, D, 0], [0, D, H], [0, 0, H]], '#2b313d');
  quad3(ctx, [[0, 0, 0], [W, 0, 0], [W, 0, H], [0, 0, H]], '#222835');
  // 墙顶厚度
  quad3(ctx, [[-0.16, 0, H], [0, 0, H], [0, D, H], [-0.16, D, H]], '#404a5c');
  quad3(ctx, [[0, -0.16, H], [W, -0.16, H], [W, 0, H], [0, 0, H]], '#4a5568');
  // 踢脚线
  quad3(ctx, [[0, 0, 0], [0, D, 0], [0, D, 0.2], [0, 0, 0.2]], '#171b23');
  quad3(ctx, [[0, 0, 0], [W, 0, 0], [W, 0, 0.2], [0, 0, 0.2]], '#12161d');

  drawWindows(ctx, L, t);
  drawRightWallDecor(ctx);
  drawLeftWallDecor(ctx, t);
}

function drawWindows(ctx, L, t) {
  const x0 = 5.0, x1 = 13.9, z0 = 0.35, z1 = WALL_H - 0.22;
  ctx.save();
  planeTransform(ctx, 'right');
  ctx.beginPath(); ctx.rect(x0, z0, x1 - x0, z1 - z0); ctx.clip();
  const g = ctx.createLinearGradient(0, z1, 0, z0);
  g.addColorStop(0, rgb(...L.skyTop));
  g.addColorStop(1, rgb(...L.skyBot));
  ctx.fillStyle = g;
  ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
  // 太阳 / 月亮
  const day = 1 - L.night;
  if (day > 0.05) {
    const sg = ctx.createRadialGradient(11.3, 2.3, 0, 11.3, 2.3, 1.1);
    sg.addColorStop(0, `rgba(255,248,210,${0.95 * day})`);
    sg.addColorStop(0.25, `rgba(255,236,170,${0.6 * day})`);
    sg.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(9.5, 1.0, 3.6, 2.3);
  }
  if (L.night > 0.3) {
    ctx.fillStyle = `rgba(235,240,255,${L.night})`;
    ctx.beginPath(); ctx.arc(7.4, 2.45, 0.2, 0, Math.PI * 2); ctx.fill();
  }
  // 楼群剪影,夜里亮几扇窗
  for (const b of SKYLINE) {
    ctx.fillStyle = `rgba(${40 + 50 * day},${60 + 60 * day},${95 + 70 * day},0.62)`;
    ctx.fillRect(b.x, z0, b.w, b.h);
    if (L.night > 0.3) {
      ctx.fillStyle = `rgba(255,214,120,${0.8 * L.night})`;
      b.lit.forEach((v, i) => { if (v > 0.35) ctx.fillRect(b.x + 0.06 + i * (b.w / 3.2), z0 + 0.12 + v * (b.h - 0.3), 0.06, 0.08); });
    }
  }
  ctx.restore();
  // 窗框
  ctx.save();
  planeTransform(ctx, 'right');
  ctx.fillStyle = '#10141b';
  for (let x = x0; x <= x1 + 0.01; x += 1.48) ctx.fillRect(x - 0.035, z0, 0.07, z1 - z0);
  ctx.fillRect(x0, z1 - 0.05, x1 - x0, 0.1);
  ctx.fillRect(x0, z0 - 0.05, x1 - x0, 0.1);
  ctx.restore();
}

function drawRightWallDecor(ctx) {
  // 挂墙显示器:小柱状图
  ctx.save();
  planeTransform(ctx, 'right');
  ctx.fillStyle = '#05080f'; ctx.fillRect(10.1, 1.05, 2.5, 1.35);
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 0.04; ctx.strokeRect(10.1, 1.05, 2.5, 1.35);
  const bars = [0.35, 0.6, 0.45, 0.8, 0.55, 0.9, 0.7];
  bars.forEach((h, i) => {
    ctx.fillStyle = i % 2 ? '#3b82f6' : '#22d3ee';
    ctx.fillRect(10.3 + i * 0.3, 1.2, 0.18, h * 0.85);
  });
  ctx.restore();
  // 左段墙面上的小画框
  ctx.save();
  planeTransform(ctx, 'right');
  [[0.9, '#1e3a5f'], [2.0, '#3f2a56'], [3.1, '#27493a']].forEach(([x, c]) => {
    ctx.fillStyle = '#0d1016'; ctx.fillRect(x, 1.5, 0.8, 0.6);
    ctx.fillStyle = c; ctx.fillRect(x + 0.05, 1.55, 0.7, 0.5);
  });
  ctx.restore();
}

function drawLeftWallDecor(ctx, t) {
  ctx.save();
  planeTransform(ctx, 'left');
  // 门
  ctx.fillStyle = '#1b130d'; ctx.fillRect(7.45, 0, 1.3, 2.45);
  ctx.fillStyle = '#6b4a2f'; ctx.fillRect(7.55, 0, 1.1, 2.35);
  ctx.fillStyle = '#d6b36a'; ctx.fillRect(8.4, 1.1, 0.07, 0.2);
  // 时钟
  ctx.fillStyle = '#e8e6df'; ctx.beginPath(); ctx.arc(1.65, 2.5, 0.28, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#222'; ctx.lineWidth = 0.035;
  ctx.beginPath(); ctx.moveTo(1.65, 2.5); ctx.lineTo(1.65, 2.7); ctx.moveTo(1.65, 2.5); ctx.lineTo(1.78, 2.46); ctx.stroke();
  // 咖啡吧霓虹牌
  ctx.fillStyle = '#0d1016'; ctx.fillRect(2.35, 2.35, 1.9, 0.5);
  ctx.restore();
  planeText(ctx, 'left', 'COFFEE BAR', 3.3, 2.6, 0.2, '#fbbf24', 'center');
  // 小搁板
  ctx.save();
  planeTransform(ctx, 'left');
  ctx.fillStyle = '#4b3a2e'; ctx.fillRect(2.3, 1.75, 2.0, 0.07);
  ['#e8d8b0', '#c2410c', '#e5e7eb', '#a16207'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(2.45 + i * 0.45, 1.82, 0.28, 0.3); });
  // 数据屏:81.7%
  ctx.fillStyle = '#04120b'; ctx.fillRect(4.95, 1.35, 1.9, 1.1);
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 0.035; ctx.strokeRect(4.95, 1.35, 1.9, 1.1);
  ctx.beginPath(); ctx.moveTo(5.1, 1.5);
  [1.5, 1.62, 1.55, 1.75, 1.7, 1.85, 1.8].forEach((v, i) => ctx.lineTo(5.1 + i * 0.24, v));
  ctx.stroke();
  ctx.restore();
  // 左墙的文字从起点向 gy 变小的方向延伸,所以起点放在屏幕左侧(gy 较大)那端
  planeText(ctx, 'left', '81.7%', 6.7, 2.15, 0.26, '#4ade80');
  // 办公室名牌
  planeText(ctx, 'left', 'DRONE BUSINESS', 7.9, 2.75, 0.13, 'rgba(255,255,255,0.55)', 'center');
}

// ---------- 家具 ----------
function plant(ctx, cx, cy, big) {
  cyl(ctx, cx, cy, 0, 0.2, 0.34, '#f1efe8');
  const s = big ? 1.15 : 1;
  const leaves = [
    [0, 0, 0.85, 17, '#2f8f46'], [-0.12, 0.05, 0.62, 14, '#3aa656'], [0.14, -0.03, 0.7, 14, '#267a3b'],
    [0.02, 0.1, 1.05, 13, '#44b865'], [-0.06, -0.08, 1.2, 10, '#58c97a'],
  ];
  for (const [dx, dy, z, r, c] of leaves) blob(ctx, cx + dx, cy + dy, z * s, r * s, c);
}

function drawDesk(ctx, id, env) {
  const { x, y } = DESKS[id];
  const ag = env.agents[id];
  const exec = id === 'alfred';
  for (const [lx, ly] of [[0.06, 0.06], [1.86, 0.06], [0.06, 0.86], [1.86, 0.86]]) box(ctx, x + lx, y + ly, 0, 0.08, 0.08, 0.5, '#2a2e37');
  box(ctx, x, y, 0.5, 2, 1, 0.07, exec ? '#6b4a33' : '#e9dfc9');
  const active = ag && ag.seated && WORKING.has(ag.state);
  const sc = active ? STATES[ag.state].color : null;
  for (const mx of [x + 0.12, x + 1.08]) {
    box(ctx, mx + 0.33, y + 0.22, 0.57, 0.1, 0.08, 0.06, '#1a1d24');
    box(ctx, mx, y + 0.18, 0.62, 0.8, 0.07, 0.52, '#0c0f15');
    const yy = y + 0.255;
    quad3(ctx, [[mx + 0.05, yy, 0.67], [mx + 0.75, yy, 0.67], [mx + 0.75, yy, 1.09], [mx + 0.05, yy, 1.09]], active ? shade(sc, 0.55) : '#11151f');
    if (active) {
      for (let k = 0; k < 3; k++) {
        const zz = 0.74 + k * 0.1, len = 0.25 + 0.3 * ((Math.sin(env.t * 1.3 + k * 2 + x) + 1) / 2);
        quad3(ctx, [[mx + 0.1, yy, zz], [mx + 0.1 + len, yy, zz], [mx + 0.1 + len, yy, zz + 0.04], [mx + 0.1, yy, zz + 0.04]], shade(sc, 1.3));
      }
      env.glows.push({ x: mx + 0.4, y: yy, z: 0.9, color: sc, r: 70 });
    }
  }
  quad3(ctx, [[x + 0.4, y + 0.55, 0.575], [x + 1.3, y + 0.55, 0.575], [x + 1.3, y + 0.8, 0.575], [x + 0.4, y + 0.8, 0.575]], '#3a3f4a');
  cyl(ctx, x + 1.75, y + 0.72, 0.57, 0.06, 0.1, '#f4f4f4');
}

function drawChairSeat(ctx, cx, cy) {
  box(ctx, cx + 0.46, cy + 0.5, 0, 0.08, 0.08, 0.2, '#20242d');
  box(ctx, cx + 0.22, cy + 0.28, 0.2, 0.56, 0.5, 0.08, '#2b303b');
}
function drawChairBack(ctx, cx, cy) {
  box(ctx, cx + 0.22, cy + 0.82, 0.22, 0.56, 0.05, 0.26, '#2b303b');
}

function drawGlassUnit(ctx, wall, i) {
  const H = 2.1;
  const pts = wall.axis === 'x'
    ? [[wall.at, i, 0], [wall.at, i + 1, 0], [wall.at, i + 1, H], [wall.at, i, H]]
    : [[i, wall.at, 0], [i + 1, wall.at, 0], [i + 1, wall.at, H], [i, wall.at, H]];
  quad3(ctx, pts, 'rgba(170,215,240,0.13)', 'rgba(210,235,255,0.28)', 1);
  const c = wall.axis === 'x' ? [wall.at - 0.03, i - 0.03] : [i - 0.03, wall.at - 0.03];
  box(ctx, c[0], c[1], 0, 0.06, 0.06, H, '#1c222d');
  const tb = wall.axis === 'x' ? [c[0], i, H - 0.04, 0.06, 1, 0.07] : [i, c[1], H - 0.04, 1, 0.06, 0.07];
  box(ctx, tb[0], tb[1], tb[2], tb[3], tb[4], tb[5], '#1c222d');
}

function buildItems() {
  const items = [];
  const add = (k, draw) => items.push({ k, draw });

  // 厨房台面与中岛
  for (let y = 2; y <= 5; y++) add(1 + y, (c) => {
    box(c, 0, y, 0, 1, 1, 0.9, '#e4dfd4');
    box(c, 0.06, y + 0.02, 0, 0.88, 0.96, 0.05, '#4a3b30');
    if (y === 3) { box(c, 0.2, y + 0.25, 0.9, 0.4, 0.5, 0.4, '#1d2128'); box(c, 0.22, y + 0.4, 1.0, 0.1, 0.2, 0.08, '#ef4444'); }
    if (y === 4) box(c, 0.3, y + 0.2, 0.9, 0.5, 0.6, 0.3, '#2c313a');
  });
  add(2.5 + 4, (c) => {
    box(c, 2, 3, 0, 1, 2, 0.85, '#3b322d');
    box(c, 1.95, 2.95, 0.85, 1.1, 2.1, 0.08, '#f0eadf');
    cyl(c, 2.5, 3.5, 0.93, 0.1, 0.12, '#c2410c');
  });

  // 书架(Alfred 办公室)
  add(5.5 + 0.5, (c) => {
    box(c, 5.1, 0.05, 0, 0.8, 0.45, 1.9, '#5a3a28');
    const cols = ['#ef4444', '#3b82f6', '#eab308', '#22c55e', '#a855f7', '#f97316'];
    for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) {
      const x0 = 5.16 + k * 0.12, z0 = 0.2 + r * 0.42;
      quad3(c, [[x0, 0.505, z0], [x0 + 0.09, 0.505, z0], [x0 + 0.09, 0.505, z0 + 0.3], [x0, 0.505, z0 + 0.3]], cols[(r * 3 + k) % 6]);
    }
  });

  // 服务器机柜
  add(9.5 + 0.5, (c, env) => {
    box(c, 9.1, 0.1, 0, 0.8, 0.8, 2.2, '#12151b');
    for (let r = 0; r < 12; r++) for (let k = 0; k < 3; k++) {
      const on = Math.sin(env.t * 3 + r * 1.7 + k * 2.9) > -0.2;
      const z0 = 0.2 + r * 0.16, x0 = 9.22 + k * 0.2;
      quad3(c, [[x0, 0.905, z0], [x0 + 0.1, 0.905, z0], [x0 + 0.1, 0.905, z0 + 0.06], [x0, 0.905, z0 + 0.06]], on ? (k === 2 ? '#3b82f6' : '#22c55e') : '#1f2937');
    }
    env.glows.push({ x: 9.5, y: 0.95, z: 1.2, color: '#3b82f6', r: 60 });
  });

  // 沙发、茶几、圆桌
  add(6.5 + 8.5, (c) => {
    box(c, 5, 8.0, 0, 3, 0.28, 0.95, '#2a5f67');
    box(c, 5, 8.28, 0, 3, 0.72, 0.42, '#357a84');
    box(c, 4.88, 8.0, 0, 0.14, 1, 0.68, '#2a5f67');
    box(c, 7.98, 8.0, 0, 0.14, 1, 0.68, '#2a5f67');
    for (const px of [5.2, 6.1, 7.0]) box(c, px, 8.34, 0.42, 0.8, 0.5, 0.12, '#3f8f9b');
  });
  add(6.5 + 9.5, (c) => {
    box(c, 6.0, 9.2, 0, 0.95, 0.6, 0.3, '#7a4f33');
    cyl(c, 6.3, 9.5, 0.3, 0.08, 0.05, '#ec4899');
  });
  add(2.5 + 9.5, (c) => {
    cyl(c, 2.5, 9.5, 0, 0.1, 0.45, '#9a8f7c');
    cyl(c, 2.5, 9.5, 0.45, 0.5, 0.07, '#e1d5bc');
    for (const [dx, dy] of [[-0.85, -0.1], [0.85, 0.05], [0.1, -0.85]]) cyl(c, 2.5 + dx, 9.5 + dy, 0, 0.17, 0.3, '#2f8a96');
  });

  // 落地灯
  add(6.5 + 6.5, (c, env) => {
    cyl(c, 6.5, 6.5, 0, 0.18, 0.05, '#20242d');
    box(c, 6.46, 6.46, 0.05, 0.08, 0.08, 1.9, '#20242d');
    cyl(c, 6.5, 6.5, 1.75, 0.26, 0.3, '#e9b84d', '#fff2c4');
    env.glows.push({ x: 6.5, y: 6.5, z: 1.9, color: '#ffcf7a', r: 150, lamp: true });
  });

  // 绿植
  add(0.5 + 9.5, (c) => plant(c, 0.5, 9.5, true));
  add(13.5 + 9.5, (c) => plant(c, 13.5, 9.5, true));
  add(9.5 + 3.5, (c) => plant(c, 9.5, 3.5, false));
  add(1.6 + 1.0, (c) => plant(c, 1.6, 1.2, false));

  // 桌椅
  for (const id of Object.keys(DESKS)) {
    const { x, y } = DESKS[id];
    add(x + 1 + y + 0.5, (c, env) => drawDesk(c, id, env));
    add(x + 0.5 + y + 1.5 - 0.15, (c) => drawChairSeat(c, x, y + 1));
    add(x + 0.5 + y + 1.5 + 0.3, (c) => drawChairBack(c, x, y + 1));
  }

  // 玻璃隔断
  for (const w of WALLS) {
    for (let i = w.from; i < w.to; i++) {
      if (w.gap && i >= w.gap[0] && i < w.gap[1]) continue;
      const k = w.axis === 'x' ? w.at + i + 0.5 : i + 0.5 + w.at;
      add(k, (c) => drawGlassUnit(c, w, i));
    }
  }
  return items;
}

// ---------- 小人 ----------
const AGENT_SCALE = 1.4; // 小人整体放大,以脚下为中心

function drawAgent(ctx, a, t, env) {
  ctx.save();
  const [fx0, fy0] = P(a.x, a.y, 0);
  ctx.translate(fx0, fy0);
  ctx.scale(AGENT_SCALE, AGENT_SCALE);
  ctx.translate(-fx0, -fy0);
  drawAgentBody(ctx, a, t, env);
  ctx.restore();
}

function drawAgentBody(ctx, a, t, env) {
  const seated = a.seated;
  const swing = a.moving ? Math.sin(t * 10 + a.phase) : 0;
  const bob = a.moving ? Math.abs(swing) * 0.05 : 0;
  const lift = seated ? 0.08 : 0;
  ellipseFloor(ctx, a.x, a.y, 0, 0.27, 0.27, 'rgba(0,0,0,0.28)');

  if (a.state === 'needsYou' || a.state === 'error') {
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    ellipseFloor(ctx, a.x, a.y, 0, 0.42 + pulse * 0.1, 0.42 + pulse * 0.1, null, a.state === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(251,146,60,0.9)', 2);
  }

  const dark = shade(a.color, 0.7);
  if (!seated) {
    const sx = a.fx * swing * 0.07, sy = a.fy * swing * 0.07;
    box(ctx, a.x - 0.14 + sx, a.y - 0.06 + sy, bob, 0.11, 0.11, 0.24, dark);
    box(ctx, a.x + 0.03 - sx, a.y - 0.06 - sy, bob, 0.11, 0.11, 0.24, dark);
  }
  const z0 = 0.22 + bob + lift;
  box(ctx, a.x - 0.14, a.y - 0.11, z0, 0.28, 0.22, 0.32, a.color);
  box(ctx, a.x - 0.2, a.y - 0.07, z0 + 0.08, 0.06, 0.13, 0.22, dark);
  box(ctx, a.x + 0.14, a.y - 0.07, z0 + 0.08, 0.06, 0.13, 0.22, dark);
  const hz = z0 + 0.32;
  box(ctx, a.x - 0.14, a.y - 0.14, hz, 0.28, 0.28, 0.26, shade(a.color, 1.12));
  // 眼睛:朝向相机的那一面才看得到
  const eye = '#0b0f19';
  if (a.fx > 0) {
    const xx = a.x + 0.141;
    for (const yy of [a.y - 0.07, a.y + 0.03]) quad3(ctx, [[xx, yy, hz + 0.13], [xx, yy + 0.05, hz + 0.13], [xx, yy + 0.05, hz + 0.19], [xx, yy, hz + 0.19]], eye);
  } else if (a.fy > 0) {
    const yy = a.y + 0.141;
    for (const xx of [a.x - 0.07, a.x + 0.03]) quad3(ctx, [[xx, yy, hz + 0.13], [xx + 0.05, yy, hz + 0.13], [xx + 0.05, yy, hz + 0.19], [xx, yy, hz + 0.19]], eye);
  }
  if (a.carry) {
    const px = a.x + a.fx * 0.2 - 0.09, py = a.y + a.fy * 0.2 - 0.09;
    box(ctx, px, py, z0 + 0.1, 0.18, 0.18, 0.16, '#c9954f');
  }
  env.labels.push({ a, wx: a.x, wy: a.y, wz: (hz + 0.3) * AGENT_SCALE + 0.12 });
}

// ---------- 对外接口 ----------
export function createRenderer(canvas, agents) {
  const ctx = canvas.getContext('2d');
  const items = buildItems();
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  const view = { s: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    view.w = r.width; view.h = r.height; view.dpr = dpr;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    // 场景外框 960x602,居中缩放,上下给顶栏和底部按钮留空
    const bw = (W + D) * (TW / 2), bh = (W + D) * (TH / 2) + WALL_H * ZU + FLOOR_T * ZU;
    const padX = 24, padTop = 74, padBot = 70;
    view.s = Math.min((r.width - padX * 2) / bw, (r.height - padTop - padBot) / bh);
    const cx = (-D * TW / 2 + W * TW / 2) / 2;
    const cy = (-WALL_H * ZU + (W + D) * TH / 2 + FLOOR_T * ZU) / 2;
    view.ox = r.width / 2 - cx * view.s;
    view.oy = padTop + (r.height - padTop - padBot) / 2 - cy * view.s;
  }

  const world = () => ctx.setTransform(view.dpr * view.s, 0, 0, view.dpr * view.s, view.dpr * view.ox, view.dpr * view.oy);
  const toScreen = (wx, wy, wz) => { const [px, py] = P(wx, wy, wz); return [view.ox + px * view.s, view.oy + py * view.s]; };

  function draw(t, L) {
    const env = { t, agents: agentMap, glows: [], labels: [] };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    world();
    drawFloor(ctx);
    drawBackWalls(ctx, L, t);
    drawRugs(ctx);

    const list = items.map((it) => ({ k: it.k, f: it.draw }));
    for (const a of agents) list.push({ k: a.x + a.y + 0.001, f: (c) => drawAgent(c, a, t, env) });
    list.sort((p, q) => p.k - q.k);
    for (const it of list) it.f(ctx, env);

    // 光照色调(只染已经画了东西的像素)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = rgb(L.tint[0], L.tint[1], L.tint[2], L.tint[3]);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // 发光:屏幕/灯/机柜,夜里更亮
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of env.glows) {
      const [sx, sy] = toScreen(g.x, g.y, g.z);
      const R = g.r * view.s * view.dpr;
      const [r, gg, b] = hexToRgb(g.color);
      const a = g.lamp ? 0.12 + 0.5 * L.night : 0.1 + 0.3 * L.night;
      const grad = ctx.createRadialGradient(sx * view.dpr, sy * view.dpr, 0, sx * view.dpr, sy * view.dpr, R);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sx * view.dpr - R, sy * view.dpr - R, R * 2, R * 2);
    }
    ctx.restore();

    drawLabels(env.labels);
  }

  function drawLabels(labels) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.font = '600 11px -apple-system, "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    for (const { a, wx, wy, wz } of labels) {
      const [sx, sy] = toScreen(wx, wy, wz);
      const tw = ctx.measureText(a.name).width;
      const w = tw + 22, h = 17;
      const x = sx - w / 2, y = sy - h / 2;
      ctx.fillStyle = 'rgba(8,12,22,0.82)';
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
      ctx.fillStyle = STATES[a.state].color;
      ctx.beginPath(); ctx.arc(x + 9, sy, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e5e7eb';
      ctx.textAlign = 'left';
      ctx.fillText(a.name, x + 16, sy + 0.5);
    }
  }

  resize();
  return { resize, draw };
}
