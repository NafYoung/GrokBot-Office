// 圆润机器人：办公室人物与侧栏头像共用同一套造型，只读 Agent 状态。
import { shade, muteHex } from './iso.js';

export const ROBOT_BOUNDS = { halfWidth: 20, height: 49 };

const round = (ctx, x, y, w, h, r, fill, stroke = null) => {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8; ctx.stroke(); }
};
const ellipse = (ctx, x, y, rx, ry, fill) => {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
};
const line = (ctx, points, color, width = 1.4) => {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
};

function palette(a) {
  const active = a.presence === 'fresh';
  const accent = active ? a.color : muteHex(a.color, 0.85);
  return {
    active, accent,
    shell: active ? '#f1f5fa' : '#b8c1cd',
    eyes: !active ? '#738498' : a.state === 'error' ? '#ff94a6'
      : a.state === 'needsYou' ? '#ffdc88' : shade(accent, 1.68),
  };
}

function badge(ctx, name, color) {
  ctx.save(); ctx.translate(0, -12);
  const ink = '#f7fbff';
  round(ctx, -5, -4, 10, 8, 3, color);
  if (name === 'heart') {
    ctx.beginPath(); ctx.moveTo(0, 2.5);
    ctx.bezierCurveTo(-6, -1, -2, -5, 0, -1.7);
    ctx.bezierCurveTo(2, -5, 6, -1, 0, 2.5);
    ctx.fillStyle = ink; ctx.fill();
  } else if (name === 'check') {
    line(ctx, [[-2.7, 0], [-0.7, 2], [3, -2]], ink, 1.4);
  } else if (name === 'book') {
    line(ctx, [[-3, 2], [-3, -2], [0, -1], [3, -2], [3, 2], [0, 3], [-3, 2]], ink, 0.9);
    line(ctx, [[0, -1], [0, 2]], ink, 0.8);
  } else if (name === 'globe') {
    ctx.beginPath(); ctx.arc(0, 0, 2.7, 0, Math.PI * 2); ctx.strokeStyle = ink; ctx.lineWidth = 0.9; ctx.stroke();
    line(ctx, [[-2.5, 0], [2.5, 0]], ink, 0.8);
    line(ctx, [[0, -2.5], [0, 2.5]], ink, 0.8);
  } else if (name === 'flask') {
    line(ctx, [[-1, -2.5], [-1, 0], [-2.8, 2.4], [2.8, 2.4], [1, 0], [1, -2.5]], ink, 1);
    line(ctx, [[-1.8, -2.5], [1.8, -2.5]], ink, 1);
  } else if (name === 'note' || name === 'chat') {
    round(ctx, -3, -2.5, 6, 4.5, 1, null, ink);
    if (name === 'chat') line(ctx, [[-1, 2], [-2, 3]], ink, 1);
    else line(ctx, [[-1.6, -0.7], [1.6, -0.7]], ink, 0.8);
  } else if (name === 'palette') {
    ellipse(ctx, 0, 0, 3.2, 2.5, ink);
    for (const [x, y, c] of [[-1.6,-0.7,'#fb7185'],[0,-1,'#60a5fa'],[1.6,-0.5,'#facc15']]) ellipse(ctx, x, y, .65, .65, c);
  } else {
    line(ctx, [[0, -2.5], [0, 2.5]], ink, 1.2);
    line(ctx, [[-2.5, 0], [2.5, 0]], ink, 1.2);
    line(ctx, [[-1.6, -1.6], [1.6, 1.6]], ink, 0.8);
    line(ctx, [[1.6, -1.6], [-1.6, 1.6]], ink, 0.8);
  }
  ctx.restore();
}

function drawHead(ctx, a, t, colors, portrait = false) {
  const { active, accent, shell, eyes } = colors;
  const accessory = a.cfg.look?.accessory || 'antenna';
  const angle = portrait ? 0 : Math.sign(a.fx - a.fy);
  const faceX = angle * 1.7;
  const glow = shade(accent, 1.45);
  const shellGradient = ctx.createLinearGradient(-10, -12, 12, 11);
  shellGradient.addColorStop(0, '#ffffff');
  shellGradient.addColorStop(0.5, shell);
  shellGradient.addColorStop(1, shade(shell, 0.76));

  // 耳朵和外壳：宽脸、小耳机，缩小到头像时仍有清楚轮廓。
  round(ctx, -17, -3.5, 5, 8, 2.5, shade(accent, 0.68));
  round(ctx, 12, -3.5, 5, 8, 2.5, accent);
  round(ctx, -14, -12, 28, 24, 10, shellGradient, shade(accent, 0.8));
  round(ctx, -8, -10.5, 16, 2, 1, glow);
  round(ctx, -11 + faceX, -7, 22, 15.5, 6.5, '#152536', '#435467');
  round(ctx, -8 + faceX, -5.5, 10, 1.2, 0.6, 'rgba(255,255,255,0.12)');

  ctx.save(); ctx.translate(faceX, 0);
  const blink = active && !portrait && ((t + a.phase * 0.71) % 4.8 < 0.12);
  const happy = active && a.ambientStage === 'doing';
  for (const x of [-4.5, 4.5]) {
    if (active && a.state === 'error') {
      line(ctx, [[x - 1.6, -2], [x + 1.6, 1.5]], eyes, 1.6);
      line(ctx, [[x + 1.6, -2], [x - 1.6, 1.5]], eyes, 1.6);
    } else if (!active || blink) {
      line(ctx, [[x - 1.6, 0], [x + 1.6, 0]], eyes, 1.5);
    } else if (happy) {
      ctx.beginPath(); ctx.arc(x, 1, 2, Math.PI + .15, Math.PI * 2 - .15);
      ctx.strokeStyle = eyes; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.stroke();
    } else {
      round(ctx, x - 1.45, -2.5, 2.9, a.state === 'thinking' ? 3.5 : 5, 1.4, eyes);
      if (a.state === 'needsYou') line(ctx, [[x - 1.8, -4], [x + 1.5, -4.8]], eyes, 0.9);
    }
  }
  if (active && a.state !== 'error') {
    ctx.beginPath(); ctx.moveTo(-2, 4); ctx.quadraticCurveTo(0, happy ? 6.5 : 5.5, 2, 4);
    ctx.strokeStyle = eyes; ctx.lineWidth = 1; ctx.stroke();
    if (happy) {
      ellipse(ctx, -8, 3, 1.5, .8, '#d994a7');
      ellipse(ctx, 8, 3, 1.5, .8, '#d994a7');
    }
  } else line(ctx, [[-1.5, 4.5], [1.5, 4.5]], eyes, 1);
  if (accessory === 'glasses' || accessory === 'goggles') {
    const rim = accessory === 'goggles' ? '#e8b760' : shade(accent, 1.5);
    round(ctx, -8, -4.5, 7, 7.5, 2.5, null, rim);
    round(ctx, 1, -4.5, 7, 7.5, 2.5, null, rim);
    line(ctx, [[-1, -1.5], [1, -1.5]], rim, 1);
  }
  ctx.restore();

  if (accessory === 'headset') {
    ctx.beginPath(); ctx.moveTo(-15, -1); ctx.bezierCurveTo(-18, -18, 18, -18, 15, -1);
    ctx.strokeStyle = shade(accent, .62); ctx.lineWidth = 2.4; ctx.stroke();
    round(ctx, 13, -4, 4, 9, 2, accent);
    line(ctx, [[15, 3], [15, 8], [8, 8]], shade(accent, .65), 1.4);
    ellipse(ctx, 7.7, 8, 1.6, 1.2, glow);
  } else if (accessory === 'cap') {
    ctx.beginPath(); ctx.moveTo(-13, -12); ctx.lineTo(0, -17); ctx.lineTo(13, -12); ctx.lineTo(0, -8); ctx.closePath();
    ctx.fillStyle = shade(accent, .55); ctx.fill();
    line(ctx, [[11, -12], [12, -4]], '#f3cf79', 1.1);
    ellipse(ctx, 12, -3.5, 1, 1.8, '#f3cf79');
  } else if (accessory === 'ears') {
    for (const x of [-8, 8]) {
      round(ctx, x - 3, -18, 6, 8, 3, accent);
      round(ctx, x - 1.4, -16, 2.8, 5, 1.4, glow);
    }
  } else if (accessory === 'sprout') {
    line(ctx, [[0, -12], [0, -18]], '#72bd97', 1.5);
    ctx.save(); ctx.translate(0, -16); ctx.rotate(-.4);
    ellipse(ctx, -3, -1, 4, 2, '#8bd5a8');
    ellipse(ctx, 3, 1, 3.6, 1.8, '#61b48b'); ctx.restore();
  } else if (accessory !== 'glasses' && accessory !== 'goggles') {
    const sway = active && !portrait ? Math.sin(t * 2 + a.phase) * .7 : 0;
    line(ctx, [[0, -12], [sway, -17]], shade(accent, .7), 1.5);
    ellipse(ctx, sway, -18, 2.7, 2.5, accent);
    ellipse(ctx, sway - .7, -18.8, .9, .8, glow);
    if (accessory === 'radar') {
      for (const side of [-1, 1]) line(ctx, [[side * 5, -20], [side * 7, -18], [side * 5, -16]], glow, 1.1);
    }
  }
}

export function drawRobot(ctx, a, t = 0) {
  const colors = palette(a);
  const { accent, shell, active } = colors;
  const resting = a.ambientStage === 'doing';
  const stretch = resting && a.ambient === 'stretch';
  const sipping = resting && a.ambient === 'coffee' ? Math.max(0, Math.sin(t * 1.8 + a.phase)) : 0;
  const swing = a.moving ? Math.sin(t * 9 + a.phase) : 0;
  const bob = a.moving ? -Math.abs(swing) * 1.3 : active ? Math.sin(t * 2 + a.phase) * .35 : 0;
  const sit = a.seated ? 2 : 0;
  ctx.save(); ctx.translate(swing * .45, bob);
  // 胶囊小脚和短腿。脚步错开，休息时向前伸一点。
  for (const side of [-1, 1]) {
    const footY = (a.seated ? 0 : side * swing * 2) - 2;
    round(ctx, side * 5 - 2.5, -8 + sit, 5, 7, 2.5, shade(accent, .65));
    round(ctx, side * 5 - 4, footY - 2, 8, 5.5, 2.6, accent, shade(accent, .65));
    round(ctx, side * 5 - 2.5, footY - 1.5, 4.5, 1, .5, shade(accent, 1.45));
  }
  ctx.translate(0, sit);
  const hands = {};
  for (const side of [-1, 1]) {
    const hx = stretch ? side * 15 : a.carry ? side * 6.5 : side * (12 + Math.abs(swing) * .8);
    const hy = stretch ? -29 - Math.sin(t * 2.5 + a.phase) * 2 : a.carry ? -13
      : side === 1 && a.prop === 'cup' ? -12 - sipping * 13 : -9 + side * swing * 2;
    const handX = side === 1 && a.prop === 'cup' ? hx - sipping * 5 : hx;
    line(ctx, [[side * 8, -17], [handX, hy]], shade(accent, .78), 4.7);
    ellipse(ctx, handX, hy, 3.1, 3.4, shell);
    hands[side] = [handX, hy];
  }
  const torso = ctx.createLinearGradient(-8, -21, 8, -5);
  torso.addColorStop(0, '#ffffff'); torso.addColorStop(.55, shell); torso.addColorStop(1, shade(shell, .82));
  round(ctx, -9, -22, 18, 17, 7, torso, shade(accent, .7));
  round(ctx, -6, -8, 12, 3, 1.5, accent);
  badge(ctx, a.cfg.look?.badge || 'spark', accent);
  ctx.save(); ctx.translate(0, -29);
  ctx.rotate(stretch ? Math.sin(t * 2 + a.phase) * .045 : swing * .025);
  drawHead(ctx, a, t, colors); ctx.restore();
  if (a.carry) {
    round(ctx, -7, -14, 14, 10, 2, '#c79561', '#8e6541');
    round(ctx, -1, -14, 2, 10, .5, '#f5debb');
  }
  if (a.prop === 'cup') {
    const [x, y] = hands[1];
    ctx.beginPath(); ctx.ellipse(x + 4.2, y - 1, 2.2, 2.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff4dc'; ctx.lineWidth = 1.5; ctx.stroke();
    round(ctx, x - 3, y - 4, 7, 8, 2, '#fff7e5', '#bea480');
    ellipse(ctx, x + .5, y - 3.7, 3.1, 1.2, '#72503c');
    line(ctx, [[x - 1, y + 1], [x + 2, y + 1]], accent, 1.4);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath(); ctx.moveTo(x - 1 + i * 3, y - 6);
      ctx.bezierCurveTo(x + Math.sin(t * 2 + i) * 2, y - 9, x + i * 3 - 2, y - 10, x + i * 2, y - 13);
      ctx.strokeStyle = 'rgba(255,245,220,.6)'; ctx.lineWidth = .8; ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawRobotPortrait(canvas, a) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.save(); ctx.translate(size / 2, size / 2 + size * .08); ctx.scale(size / 39, size / 39);
  drawHead(ctx, a, 0, palette(a), true);
  ctx.restore();
}
