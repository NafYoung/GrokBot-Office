// 等距投影工具。世界坐标 (gx, gy, gz) → 屏幕像素。
//   gx 向右下,gy 向左下,gz 向上。相机从 (+gx,+gy) 方向看过来。
export const TW = 80;  // 一格的菱形宽
export const TH = 40;  // 一格的菱形高
export const ZU = 34;  // 高度 1 单位对应的像素

export const P = (x, y, z = 0) => [((x - y) * TW) / 2, ((x + y) * TH) / 2 - z * ZU];

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgb = (r, g, b, a = 1) =>
  a === 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
export const hexToRgb = hex;

const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// f<1 变暗,f>1 向白色提亮。返回 #rrggbb(必须是十六进制:box() 会对结果再次 shade,
// 之前返回 rgb(...) 字符串导致二次解析成 NaN,颜色变黑)
export function shade(c, f) {
  const [r, g, b] = hex(c);
  if (f <= 1) return toHex(r * f, g * f, b * f);
  const t = f - 1;
  return toHex(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t);
}

export function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// 3D 点数组直接画成多边形
export function quad3(ctx, pts3, fill, stroke, lw) {
  poly(ctx, pts3.map(([x, y, z]) => P(x, y, z)), fill, stroke, lw);
}

// 长方体:只画朝向相机的 3 个面(顶、右、左)。左面受光,右面更暗。
export function box(ctx, x, y, z, w, d, h, color, o = {}) {
  const top = o.top || shade(color, 1.1);
  const left = shade(color, 0.84);
  const right = shade(color, 0.64);
  const A = P(x, y, z + h), B = P(x + w, y, z + h), C = P(x + w, y + d, z + h), D = P(x, y + d, z + h);
  const Bb = P(x + w, y, z), Cb = P(x + w, y + d, z), Db = P(x, y + d, z);
  poly(ctx, [D, C, Cb, Db], left);
  poly(ctx, [B, C, Cb, Bb], right);
  poly(ctx, [A, B, C, D], top);
}

// 地面上的椭圆(rx 沿 gx,ry 沿 gy)
export function ellipseFloor(ctx, cx, cy, z, rx, ry, fill, stroke, lw) {
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    pts.push(P(cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, z));
  }
  poly(ctx, pts, fill, stroke, lw);
}

// 圆柱:底部椭圆 + 侧面 + 顶部椭圆
export function cyl(ctx, cx, cy, z, r, h, color, topColor) {
  const [bx, by] = P(cx, cy, z);
  const [, ty] = P(cx, cy, z + h);
  const rx = r * (TW / 2) * Math.SQRT2;
  const ry = r * (TH / 2) * Math.SQRT2;
  ctx.fillStyle = shade(color, 0.8);
  ctx.beginPath();
  ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(bx - rx, ty);
  ctx.ellipse(bx, ty, rx, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = topColor || shade(color, 1.12);
  ctx.beginPath();
  ctx.ellipse(bx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 屏幕空间里的圆球(叶子、灯光)
export function blob(ctx, x, y, z, r, color) {
  const [sx, sy] = P(x, y, z);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
}

// 在地面 / 墙面上写字。ctx 临时换成该平面的仿射变换,文字会按平面透视倾斜。
//   plane: 'floor' | 'right'(gy=0 的墙) | 'left'(gx=0 的墙)
export function planeTransform(ctx, plane) {
  if (plane === 'floor') ctx.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0);
  else if (plane === 'right') ctx.transform(TW / 2, TH / 2, 0, -ZU, 0, 0);
  else ctx.transform(-TW / 2, TH / 2, 0, -ZU, 0, 0);
}

export function planeText(ctx, plane, text, u, v, size, color, align = 'left') {
  ctx.save();
  planeTransform(ctx, plane);
  ctx.scale(0.01, 0.01); // 字号用大数,避免浏览器对极小字号的处理
  ctx.font = `700 ${size * 100}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  // 墙面的 v 轴朝上,文字要翻回来;左墙的 u 轴朝屏幕左边,还要再水平翻一次,否则文字是镜像
  ctx.scale(plane === 'left' ? -1 : 1, plane === 'floor' ? 1 : -1);
  const px = plane === 'left' ? -u * 100 : u * 100;
  ctx.fillText(text, px, plane === 'floor' ? v * 100 : -v * 100);
  ctx.restore();
}
