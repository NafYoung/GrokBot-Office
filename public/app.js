/* Bot Office — Dallas Tesla Virtual Office match.
   Floating neon spheres · fixed isometric · wood HQ · dark HUD.
   Browser only POSTs /api/ping. Secrets stay on server.py. */
import * as THREE from "three";

const STATUS_COLOR = {
  idle: 0x94a3b8,
  working: 0xa78bfa,
  browsing: 0x34d399,
  thinking: 0xfbbf24,
  pinged: 0xfb923c,
  terminal: 0xf472b6,
  error: 0x64748b,
};
const STATUS_LABEL = {
  idle: "Idle",
  working: "Coding",
  thinking: "Thinking",
  pinged: "Needs you",
  browsing: "Browsing",
  terminal: "In terminal",
  error: "Error",
};

/* Roster — Chinese names as prior build; ping uses name string */
const BOTS = [
  { id: "grok", name: "Grok Bot", role: "前台总管 · 调度与总协调", color: "#3de0ff", desk: { x: -5.6, z: -4.2 }, home: { x: -5.6, z: -4.2 }, chief: true },
  { id: "newbee", name: "newbee naf", role: "个人助理 · 日常事务帮手", color: "#60a5fa", desk: { x: -4.2, z: -3.4 }, home: { x: -1.0, z: 4.6 } },
  { id: "study-chief", name: "主线学习总管", role: "学习主线编排与进度", color: "#a78bfa", desk: { x: 3.2, z: -1.4 }, home: { x: 3.2, z: -1.4 } },
  { id: "study-docs", name: "主线资料员", role: "资料收集与整理", color: "#8b5cf6", desk: { x: 4.8, z: -1.4 }, home: { x: 4.8, z: -1.4 } },
  { id: "study-ta", name: "主线实验助教", role: "实验辅导与答疑", color: "#7c3aed", desk: { x: 3.2, z: 0.2 }, home: { x: 3.2, z: 0.2 } },
  { id: "study-qa", name: "主线验收员", role: "作业与里程碑验收", color: "#6d28d9", desk: { x: 4.8, z: 0.2 }, home: { x: 4.8, z: 0.2 } },
  { id: "py", name: "Python Roadmap", role: "Python 学习路线图", color: "#c4b5fd", desk: { x: 3.2, z: -1.4 }, home: { x: 0.8, z: 4.8 } },
  { id: "kb", name: "知识库", role: "个人知识库检索", color: "#818cf8", desk: { x: 4.8, z: -1.4 }, home: { x: 1.8, z: 4.2 } },
  { id: "world", name: "观世界", role: "世界动态观察", color: "#34d399", desk: { x: -1.2, z: -1.0 }, home: { x: -1.2, z: -1.0 } },
  { id: "brief", name: "调研简报", role: "调研摘要与简报", color: "#2dd4bf", desk: { x: 0.6, z: -1.0 }, home: { x: 0.6, z: -1.0 } },
  { id: "odd", name: "奇闻异事", role: "趣闻与冷知识", color: "#10b981", desk: { x: -0.3, z: 0.6 }, home: { x: -2.2, z: 4.4 } },
  { id: "pdata", name: "论文数据小组", role: "论文数据提取与整理", color: "#fbbf24", desk: { x: 1.8, z: -4.6 }, home: { x: 1.8, z: -4.6 } },
  { id: "pevidence", name: "论文证据核对员", role: "证据链核对", color: "#f59e0b", desk: { x: 3.0, z: -4.6 }, home: { x: 3.0, z: -4.6 } },
  { id: "interview", name: "面试陪练", role: "模拟面试与反馈", color: "#f472b6", desk: { x: -2.4, z: 1.2 }, home: { x: -2.4, z: 1.2 } },
  { id: "jd", name: "JD调研", role: "岗位 JD 调研分析", color: "#fb7185", desk: { x: -0.8, z: 1.4 }, home: { x: -0.8, z: 1.4 } },
  { id: "egg", name: "dr eggbot", role: "工具型助手", color: "#38bdf8", desk: { x: 5.4, z: 2.8 }, home: { x: 5.4, z: 2.8 } },
];

const FLOOR_W = 16;
const FLOOR_D = 14;
const WALL_H = 3.2;

const state = new Map();
BOTS.forEach((b) => {
  state.set(b.id, {
    status: "idle",
    task: "待命中",
    x: b.home.x,
    z: b.home.z,
    bobPhase: Math.random() * Math.PI * 2,
    glide: null,
    trail: [],
  });
});

let selectedId = null;
let ambience = "night";
let simRunning = true;

const teamList = document.getElementById("teamList");
const activityLog = document.getElementById("activityLog");
const panel = document.getElementById("panel");
const backdrop = document.getElementById("backdrop");
const panelAvatar = document.getElementById("panelAvatar");
const panelName = document.getElementById("panelName");
const panelRole = document.getElementById("panelRole");
const panelMsg = document.getElementById("panelMsg");
const panelStatus = document.getElementById("panelStatus");
const callBtn = document.getElementById("callBtn");
const panelClose = document.getElementById("panelClose");
const nameLabels = document.getElementById("nameLabels");
const stopBtn = document.getElementById("stopBtn");

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function shortName(name) {
  return name.length <= 11 ? name : name.slice(0, 10) + "…";
}
function formatTime(d) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h >= 12 ? "PM" : "AM"}`;
}
function logActivity(html) {
  const empty = activityLog.querySelector(".act-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "act-item";
  row.innerHTML = `<span class="act-time">${formatTime(new Date())}</span>${html}`;
  activityLog.prepend(row);
  while (activityLog.children.length > 40) activityLog.lastChild.remove();
}
function updateStats() {
  let w = 0, need = 0, i = 0;
  state.forEach((st) => {
    if (st.status === "working" || st.status === "browsing" || st.status === "terminal") w++;
    else if (st.status === "pinged") need++;
    else if (st.status === "idle" || st.status === "thinking") i++;
    else i++;
  });
  document.getElementById("statWorking").textContent = w;
  document.getElementById("statNeed").textContent = need;
  document.getElementById("statIdle").textContent = i;
  document.getElementById("statDesks").textContent = String(BOTS.length);
}

function renderTeam() {
  teamList.innerHTML = BOTS.map((b) => {
    const st = state.get(b.id);
    const busy = st.status !== "idle" && st.status !== "error";
    return `<div class="team-item${selectedId === b.id ? " on" : ""}" data-id="${b.id}">
      <span class="team-dot" style="background:${b.color};box-shadow:0 0 8px ${b.color}"></span>
      <div class="team-main">
        <div class="team-name" title="${escapeHtml(b.name)}">${escapeHtml(shortName(b.name))}</div>
        <div class="team-role">${escapeHtml(b.role)}</div>
      </div>
      <span class="team-st">${busy ? '<span class="spin"></span>' : ""}${STATUS_LABEL[st.status] || st.status}</span>
      <div class="team-task">${escapeHtml(st.task)}</div>
    </div>`;
  }).join("");
}
teamList.addEventListener("click", (e) => {
  const item = e.target.closest(".team-item");
  if (item) openPanel(item.dataset.id);
});

/* ═══════════ Three.js — fixed isometric ═══════════ */
const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a101c);
scene.fog = new THREE.FogExp2(0x0a101c, 0.012);

const frustumSize = 18;
function makeOrtho() {
  const aspect = window.innerWidth / window.innerHeight;
  const cam = new THREE.OrthographicCamera(
    (-frustumSize * aspect) / 2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    120
  );
  // Fixed isometric ~35° elevation, looking at room center
  cam.position.set(14, 12.5, 14);
  cam.lookAt(0.4, 0.4, 0.2);
  cam.updateProjectionMatrix();
  return cam;
}
let camera = makeOrtho();

/* Lights — night default */
const hemi = new THREE.HemisphereLight(0x6a7a9a, 0x1a1520, 0.28);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xc8d4e8, 0.35);
sun.position.set(8, 18, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4a6090, 0.18);
fill.position.set(-10, 8, -4);
scene.add(fill);

const office = new THREE.Group();
scene.add(office);

const botMeshes = new Map();
const botBeams = new Map();
const botLights = new Map();
const botTrails = new Map();
const labelEls = new Map();
const blinkLeds = [];
const wallScreens = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clickables = [];

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}
function box(w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, color, seg = 16, opts = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.castShadow = true;
  return m;
}

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#d4a574";
  ctx.fillRect(0, 0, 512, 512);
  const plankH = 32;
  for (let y = 0; y < 512; y += plankH) {
    const shade = 0.88 + Math.random() * 0.14;
    const r = Math.floor(210 * shade);
    const g = Math.floor(165 * shade);
    const b = Math.floor(115 * shade);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, 512, plankH - 1);
    ctx.fillStyle = "rgba(80,50,30,0.18)";
    ctx.fillRect(0, y + plankH - 1, 512, 1);
    // grain lines
    ctx.strokeStyle = "rgba(90,55,30,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const gy = y + 6 + i * 6 + Math.random() * 3;
      ctx.moveTo(0, gy);
      for (let x = 0; x < 512; x += 40) ctx.lineTo(x + 20, gy + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeScreenCanvas(kind) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 288;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a1220";
  ctx.fillRect(0, 0, 512, 288);
  if (kind === "money") {
    ctx.fillStyle = "#34d399";
    ctx.font = "bold 56px Inter, sans-serif";
    ctx.fillText("$128.4K", 28, 78);
    ctx.fillStyle = "#64748b";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("YOUNG NAF · portfolio", 28, 108);
    // bars
    const bars = [40, 62, 48, 80, 55, 90, 70, 95, 78, 110];
    bars.forEach((h, i) => {
      ctx.fillStyle = i % 2 ? "#34d399" : "#2dd4bf";
      ctx.globalAlpha = 0.7;
      ctx.fillRect(28 + i * 44, 250 - h, 28, h);
    });
    ctx.globalAlpha = 1;
    // sparkline
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    bars.forEach((h, i) => {
      const x = 40 + i * 44;
      const y = 200 - h * 0.5;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  } else {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 28px Inter, sans-serif";
    ctx.fillText("YOUNG NAF", 28, 48);
    ctx.fillStyle = "#64748b";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("Bot Office · live ops", 28, 72);
    // chart grid
    ctx.strokeStyle = "rgba(148,163,184,0.15)";
    for (let y = 100; y < 260; y += 30) {
      ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(480, y); ctx.stroke();
    }
    const pts = [120, 140, 110, 160, 145, 180, 170, 200, 185, 210];
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    pts.forEach((y, i) => {
      const x = 40 + i * 46;
      if (i === 0) ctx.moveTo(x, 280 - y); else ctx.lineTo(x, 280 - y);
    });
    ctx.stroke();
    ctx.fillStyle = "#a78bfa";
    ctx.font = "bold 18px Inter, sans-serif";
    ctx.fillText("16 bots online", 28, 260);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addRug(x, z, w, d, color, opts = {}) {
  const r = box(w, 0.025, d, color, { roughness: 0.95, ...opts });
  r.position.set(x, 0.03, z);
  r.receiveShadow = true;
  office.add(r);
  return r;
}

function makeDesk(x, z, rotY = 0, dual = false, neon = 0xa78bfa) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  const top = box(dual ? 1.6 : 1.2, 0.05, 0.65, 0x1a1e28, { roughness: 0.35, metalness: 0.25 });
  top.position.y = 0.72;
  g.add(top);
  // legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = box(0.05, 0.7, 0.05, 0x11141c, { metalness: 0.5, roughness: 0.4 });
      leg.position.set(sx * (dual ? 0.7 : 0.5), 0.35, sz * 0.26);
      g.add(leg);
    }
  }
  const monCount = dual ? 2 : 1;
  for (let i = 0; i < monCount; i++) {
    const ox = monCount === 2 ? (i === 0 ? -0.32 : 0.32) : 0;
    const mon = box(0.48, 0.32, 0.03, 0x0c1018, { roughness: 0.3, metalness: 0.5 });
    mon.position.set(ox, 1.0, -0.18);
    g.add(mon);
    const screen = box(0.42, 0.26, 0.01, neon, {
      roughness: 0.35, metalness: 0.1,
      emissive: neon, emissiveIntensity: 0.7,
    });
    screen.position.set(ox, 1.0, -0.16);
    screen.userData.screen = true;
    g.add(screen);
    const stand = box(0.06, 0.16, 0.05, 0x333844, { metalness: 0.5, roughness: 0.4 });
    stand.position.set(ox, 0.82, -0.18);
    g.add(stand);
    const kb = box(0.36, 0.015, 0.12, 0x22262e);
    kb.position.set(ox, 0.75, 0.1);
    g.add(kb);
  }
  // chair
  const seat = box(0.38, 0.05, 0.38, 0x1e2430, { roughness: 0.75 });
  seat.position.set(0, 0.46, 0.52);
  g.add(seat);
  const back = box(0.38, 0.42, 0.05, 0x1e2430, { roughness: 0.75 });
  back.position.set(0, 0.68, 0.7);
  g.add(back);
  const base = cyl(0.14, 0.16, 0.04, 0x333844, 12, { metalness: 0.5, roughness: 0.4 });
  base.position.set(0, 0.12, 0.52);
  g.add(base);
  const pole = cyl(0.03, 0.03, 0.32, 0x444a58, 8, { metalness: 0.55, roughness: 0.35 });
  pole.position.set(0, 0.28, 0.52);
  g.add(pole);
  office.add(g);
  return g;
}

function makeGlassRoom(cx, cz, w, d, label) {
  const g = new THREE.Group();
  const glass = mat(0xa8c8e8, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.14 });
  const frameC = 0x3a4254;
  // floor pad
  const floor = box(w, 0.03, d, 0xe8ecf2, { roughness: 0.55 });
  floor.position.set(cx, 0.04, cz);
  g.add(floor);
  // walls with door on +z
  const specs = [
    { x: cx, z: cz - d / 2, ww: w, dd: 0.05 },
    { x: cx - w / 2, z: cz, ww: 0.05, dd: d },
    { x: cx + w / 2, z: cz, ww: 0.05, dd: d },
  ];
  specs.forEach((s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.ww, WALL_H * 0.85, s.dd), glass);
    m.position.set(s.x, WALL_H * 0.425, s.z);
    g.add(m);
  });
  // door wall split
  const doorW = 0.9;
  const side = (w - doorW) / 2;
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(side, WALL_H * 0.85, 0.05), glass);
    m.position.set(cx + sx * (doorW / 2 + side / 2), WALL_H * 0.425, cz + d / 2);
    g.add(m);
  }
  // frames
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = box(0.06, WALL_H * 0.85, 0.06, frameC, { metalness: 0.55, roughness: 0.35 });
      p.position.set(cx + sx * (w / 2), WALL_H * 0.425, cz + sz * (d / 2));
      g.add(p);
    }
  }
  // ceiling
  const ceil = box(w + 0.08, 0.06, d + 0.08, 0xd8dee8, { roughness: 0.5 });
  ceil.position.set(cx, WALL_H * 0.85 + 0.03, cz);
  g.add(ceil);
  // light bar
  const lb = box(w * 0.5, 0.03, 0.1, 0xffffff, { emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.3 });
  lb.position.set(cx, WALL_H * 0.85 - 0.04, cz);
  g.add(lb);
  const pl = new THREE.PointLight(0xfff5e8, 0.55, 6, 2);
  pl.position.set(cx, WALL_H * 0.7, cz);
  g.add(pl);
  office.add(g);
}

function makeServerRack(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const body = box(0.7, 1.8, 0.55, 0x12151c, { roughness: 0.4, metalness: 0.45 });
  body.position.y = 0.9;
  g.add(body);
  for (let i = 0; i < 8; i++) {
    const slot = box(0.58, 0.12, 0.02, 0x1c2230, { roughness: 0.5, metalness: 0.3 });
    slot.position.set(0, 0.25 + i * 0.2, 0.28);
    g.add(slot);
    for (let j = 0; j < 4; j++) {
      const led = box(0.04, 0.04, 0.02, 0x22c55e, {
        emissive: 0x22c55e, emissiveIntensity: 0.9, roughness: 0.3,
      });
      led.position.set(-0.2 + j * 0.12, 0.25 + i * 0.2, 0.3);
      led.userData.blink = Math.random() * Math.PI * 2;
      led.userData.base = 0.5 + Math.random() * 0.5;
      g.add(led);
      blinkLeds.push(led);
    }
  }
  office.add(g);
}

function makeLSofa(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const green = 0x1a4a3a;
  const greenD = 0x143d30;
  // long seat
  const seat1 = box(2.6, 0.28, 0.85, green, { roughness: 0.88 });
  seat1.position.set(0, 0.3, 0);
  g.add(seat1);
  const back1 = box(2.6, 0.5, 0.18, greenD, { roughness: 0.88 });
  back1.position.set(0, 0.55, -0.34);
  g.add(back1);
  // L wing
  const seat2 = box(0.85, 0.28, 1.6, green, { roughness: 0.88 });
  seat2.position.set(1.0, 0.3, 0.7);
  g.add(seat2);
  const back2 = box(0.18, 0.5, 1.6, greenD, { roughness: 0.88 });
  back2.position.set(1.35, 0.55, 0.7);
  g.add(back2);
  // arms
  const arm = box(0.18, 0.35, 0.85, greenD, { roughness: 0.88 });
  arm.position.set(-1.2, 0.42, 0);
  g.add(arm);
  office.add(g);
}

function makeCoffeeTable(x, z) {
  const top = box(0.9, 0.05, 0.55, 0x8b5e3c, { roughness: 0.5 });
  top.position.set(x, 0.38, z);
  office.add(top);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = cyl(0.025, 0.025, 0.36, 0x6b4428, 8);
      leg.position.set(x + sx * 0.35, 0.18, z + sz * 0.18);
      office.add(leg);
    }
  }
}

function makePlant(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pot = cyl(0.12 * scale, 0.1 * scale, 0.2 * scale, 0xd4d4d8, 12, { roughness: 0.7 });
  pot.position.y = 0.1 * scale;
  g.add(pot);
  const soil = cyl(0.1 * scale, 0.1 * scale, 0.04 * scale, 0x3a2a1a, 12);
  soil.position.y = 0.2 * scale;
  g.add(soil);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.14 * scale, 10, 8),
      mat(0x2d8a4e, { roughness: 0.75 })
    );
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.1 * scale, 0.4 * scale + (i % 2) * 0.12, Math.sin(a) * 0.1 * scale);
    leaf.scale.set(1, 0.6, 1);
    g.add(leaf);
  }
  office.add(g);
}

function makeCabinet(x, z) {
  const cab = box(0.7, 1.2, 0.4, 0xe8ecf2, { roughness: 0.5 });
  cab.position.set(x, 0.6, z);
  office.add(cab);
  for (let i = 0; i < 3; i++) {
    const shelf = box(0.6, 0.02, 0.02, 0xc8ced8);
    shelf.position.set(x, 0.3 + i * 0.3, z + 0.2);
    office.add(shelf);
  }
}

function makeExecDesk(x, z) {
  // white L-desk
  const top1 = box(1.8, 0.05, 0.7, 0xf0f2f6, { roughness: 0.4, metalness: 0.1 });
  top1.position.set(x, 0.72, z);
  office.add(top1);
  const top2 = box(0.7, 0.05, 1.2, 0xf0f2f6, { roughness: 0.4, metalness: 0.1 });
  top2.position.set(x + 0.55, 0.72, z + 0.5);
  office.add(top2);
  const ped = box(0.5, 0.68, 0.5, 0xd8dce4, { roughness: 0.5 });
  ped.position.set(x - 0.5, 0.34, z);
  office.add(ped);
  const mon = box(0.5, 0.34, 0.03, 0x121820, { roughness: 0.3, metalness: 0.5 });
  mon.position.set(x, 1.02, z - 0.2);
  office.add(mon);
  const screen = box(0.44, 0.28, 0.01, 0x3de0ff, {
    roughness: 0.35, emissive: 0x3de0ff, emissiveIntensity: 0.65,
  });
  screen.position.set(x, 1.02, z - 0.18);
  office.add(screen);
  // chair
  const seat = box(0.4, 0.06, 0.4, 0x2a3344, { roughness: 0.7 });
  seat.position.set(x, 0.48, z + 0.55);
  office.add(seat);
  const back = box(0.4, 0.5, 0.06, 0x2a3344, { roughness: 0.7 });
  back.position.set(x, 0.75, z + 0.72);
  office.add(back);
}

function buildOffice() {
  // platform under floor
  const platform = box(FLOOR_W + 0.8, 0.3, FLOOR_D + 0.8, 0x2a2430, { roughness: 0.9 });
  platform.position.y = -0.15;
  office.add(platform);

  // wooden plank floor
  const floorGeo = new THREE.BoxGeometry(FLOOR_W, 0.08, FLOOR_D);
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodTexture(),
    roughness: 0.75,
    metalness: 0.05,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  office.add(floor);

  // dark walls — left + back only (open front/right like Dallas)
  const wallMat = mat(0x2a2e38, { roughness: 0.85 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, WALL_H, 0.18), wallMat);
  back.position.set(0, WALL_H / 2, -FLOOR_D / 2);
  back.castShadow = true;
  back.receiveShadow = true;
  office.add(back);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.18, WALL_H, FLOOR_D), wallMat);
  left.position.set(-FLOOR_W / 2, WALL_H / 2, 0);
  left.castShadow = true;
  left.receiveShadow = true;
  office.add(left);

  // thin baseboards
  const bb1 = box(FLOOR_W, 0.12, 0.06, 0x1a1e26);
  bb1.position.set(0, 0.12, -FLOOR_D / 2 + 0.1);
  office.add(bb1);
  const bb2 = box(0.06, 0.12, FLOOR_D, 0x1a1e26);
  bb2.position.set(-FLOOR_W / 2 + 0.1, 0.12, 0);
  office.add(bb2);

  /* ── Left: glass executive office ── */
  makeGlassRoom(-5.4, -4.0, 3.8, 3.4);
  addRug(-5.4, -4.0, 3.2, 2.8, 0x9aa3b0);
  makeExecDesk(-5.5, -4.2);
  makeCabinet(-6.6, -5.0);
  makePlant(-4.0, -5.2, 0.85);

  /* ── Back: server room (glass) ── */
  makeGlassRoom(1.6, -5.0, 3.2, 2.6);
  makeServerRack(0.7, -5.1);
  makeServerRack(1.6, -5.1);
  makeServerRack(2.5, -5.1);

  /* ── Right: 2×2 black desk block on vibrant purple rug ── */
  addRug(4.0, -0.6, 4.4, 3.6, 0x8b5cf6, { emissive: 0x8b5cf6, emissiveIntensity: 0.35 });
  // neon border glow under rug
  const neonBorder = box(4.55, 0.025, 3.75, 0xc4b5fd, { emissive: 0xc4b5fd, emissiveIntensity: 0.85, roughness: 0.35 });
  neonBorder.position.set(4.0, 0.015, -0.6);
  office.add(neonBorder);
  makeDesk(3.2, -1.4, 0, true, 0xa78bfa);
  makeDesk(4.8, -1.4, 0, true, 0x818cf8);
  makeDesk(3.2, 0.2, 0, true, 0xc4b5fd);
  makeDesk(4.8, 0.2, 0, true, 0x8b5cf6);

  /* ── Center open desks (smaller accents) ── */
  addRug(-0.5, -0.4, 3.2, 2.8, 0x1e3a5f, { emissive: 0x3b82f6, emissiveIntensity: 0.08 });
  makeDesk(-1.2, -1.0, 0, false, 0x34d399);
  makeDesk(0.6, -1.0, 0, false, 0x2dd4bf);
  addRug(-1.6, 1.4, 2.8, 2.2, 0x4a2040, { emissive: 0xf472b6, emissiveIntensity: 0.08 });
  makeDesk(-2.4, 1.2, Math.PI * 0.05, false, 0xf472b6);
  makeDesk(-0.8, 1.4, 0, false, 0xfb7185);

  /* ── Bottom: lounge ── */
  addRug(-0.2, 4.4, 4.5, 3.2, 0xd4d8de);
  makeLSofa(-0.6, 4.2);
  makeCoffeeTable(0.3, 3.6);
  makePlant(1.8, 5.2, 1.0);
  makePlant(-2.4, 5.4, 0.75);

  /* ── Extra desks near server / tools ── */
  makeDesk(5.4, 2.8, -0.2, false, 0x38bdf8);

  /* ── Wall screens ── */
  // Left wall screen — money chart
  const leftScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.35),
    new THREE.MeshStandardMaterial({
      map: makeScreenCanvas("money"),
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    })
  );
  leftScreen.position.set(-FLOOR_W / 2 + 0.12, 2.0, 1.5);
  leftScreen.rotation.y = Math.PI / 2;
  office.add(leftScreen);
  wallScreens.push(leftScreen);
  const leftFrame = box(0.06, 1.45, 2.5, 0x11141c, { metalness: 0.4, roughness: 0.4 });
  leftFrame.position.set(-FLOOR_W / 2 + 0.09, 2.0, 1.5);
  office.add(leftFrame);

  // Back wall screen — YOUNG NAF + charts
  const backScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.5),
    new THREE.MeshStandardMaterial({
      map: makeScreenCanvas("charts"),
      emissive: 0xffffff,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    })
  );
  backScreen.position.set(-1.5, 2.1, -FLOOR_D / 2 + 0.12);
  office.add(backScreen);
  wallScreens.push(backScreen);
  const backFrame = box(2.9, 1.6, 0.06, 0x11141c, { metalness: 0.4, roughness: 0.4 });
  backFrame.position.set(-1.5, 2.1, -FLOOR_D / 2 + 0.09);
  office.add(backFrame);

  // second smaller back screen near servers
  const backScreen2 = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshStandardMaterial({
      map: makeScreenCanvas("charts"),
      emissive: 0xffffff,
      emissiveIntensity: 0.3,
      roughness: 0.4,
    })
  );
  backScreen2.position.set(4.5, 2.0, -FLOOR_D / 2 + 0.12);
  office.add(backScreen2);
  wallScreens.push(backScreen2);

  // ambient accent lights from monitors/screens
  const screenGlow = new THREE.PointLight(0x60a5fa, 0.4, 10, 2);
  screenGlow.position.set(-FLOOR_W / 2 + 1, 2.0, 1.5);
  office.add(screenGlow);
  const screenGlow2 = new THREE.PointLight(0xa78bfa, 0.35, 8, 2);
  screenGlow2.position.set(-1.5, 2.0, -FLOOR_D / 2 + 1);
  office.add(screenGlow2);
  const deskGlow = new THREE.PointLight(0xa78bfa, 0.5, 7, 2);
  deskGlow.position.set(4.0, 1.2, -0.6);
  office.add(deskGlow);

  // plants in corners
  makePlant(-7.0, 5.5, 1.1);
  makePlant(6.8, -5.5, 0.9);
  makePlant(6.5, 5.0, 0.95);
}

/* ═══════════ Glowing sphere bots ═══════════ */
function createSphereBot(b) {
  const group = new THREE.Group();
  group.userData.botId = b.id;
  const col = new THREE.Color(b.color);

  // core sphere
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 24, 20),
    new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.95,
      roughness: 0.25,
      metalness: 0.15,
    })
  );
  core.castShadow = true;
  group.add(core);

  // outer glow shell
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 20, 16),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  group.add(shell);

  // thin vertical light beam to floor
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.05, 1.25, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  beam.position.y = -0.58;
  group.add(beam);

  // soft ground disc
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 20),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -1.1;
  group.add(disc);

  const light = new THREE.PointLight(col, 1.15, 5.0, 2);
  light.position.y = 0;
  group.add(light);

  const st = state.get(b.id);
  group.position.set(st.x, 1.2, st.z);
  office.add(group);

  botMeshes.set(b.id, group);
  botBeams.set(b.id, beam);
  botLights.set(b.id, light);
  clickables.push(group);

  // trail line
  const trailGeo = new THREE.BufferGeometry();
  const trailMat = new THREE.LineBasicMaterial({
    color: col,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const trail = new THREE.Line(trailGeo, trailMat);
  office.add(trail);
  botTrails.set(b.id, { line: trail, points: [] });

  // DOM label
  const el = document.createElement("div");
  el.className = "name-label";
  el.textContent = shortName(b.name);
  nameLabels.appendChild(el);
  labelEls.set(b.id, el);
}

function projectLabel(id) {
  const mesh = botMeshes.get(id);
  const el = labelEls.get(id);
  if (!mesh || !el) return;
  const v = new THREE.Vector3(mesh.position.x, mesh.position.y + 0.45, mesh.position.z);
  v.project(camera);
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (v.z > 1) { el.style.opacity = "0"; return; }
  el.style.opacity = "1";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function setBotStatus(id, status, task) {
  const st = state.get(id);
  if (!st) return;
  st.status = status;
  if (task) st.task = task;
  const light = botLights.get(id);
  const mesh = botMeshes.get(id);
  if (mesh) {
    const c = new THREE.Color(STATUS_COLOR[status] || STATUS_COLOR.idle);
    // keep bot identity color on core; pulse intensity by status
    if (light) {
      light.intensity = status === "idle" ? 0.55 : status === "working" || status === "terminal" ? 1.2 : 0.9;
    }
  }
  renderTeam();
  updateStats();
}

function glideBot(id, toX, toZ, dur = 2.2) {
  const st = state.get(id);
  if (!st) return;
  st.glide = {
    fromX: st.x, fromZ: st.z,
    toX, toZ,
    t0: performance.now(),
    dur: dur * 1000,
  };
}

function updateTrail(id, x, z) {
  const t = botTrails.get(id);
  if (!t) return;
  t.points.push(new THREE.Vector3(x, 0.9, z));
  if (t.points.length > 18) t.points.shift();
  if (t.points.length >= 2) {
    t.line.geometry.setFromPoints(t.points);
    t.line.geometry.attributes.position.needsUpdate = true;
  }
}

/* ─── UI / API ─── */
function openPanel(id) {
  const b = BOTS.find((x) => x.id === id);
  if (!b) return;
  selectedId = id;
  panel.hidden = false;
  backdrop.hidden = false;
  panelName.textContent = b.name;
  panelRole.textContent = b.role;
  panelAvatar.style.background = `radial-gradient(circle, ${b.color}, #0a1020 70%)`;
  panelAvatar.style.boxShadow = `0 0 28px ${b.color}`;
  panelMsg.value = "";
  panelStatus.textContent = "";
  panelStatus.className = "panel-status";
  renderTeam();
}
function closePanel() {
  panel.hidden = true;
  backdrop.hidden = true;
  selectedId = null;
  renderTeam();
}
panelClose.addEventListener("click", closePanel);
backdrop.addEventListener("click", closePanel);

async function pingBot(id, message) {
  const b = BOTS.find((x) => x.id === id);
  const body = { action: "ping", bot: b.name };
  if (message) body.message = message;
  const res = await fetch("/api/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  return { ok: res.ok && data.ok, data };
}

callBtn.addEventListener("click", async () => {
  if (!selectedId) return;
  const b = BOTS.find((x) => x.id === selectedId);
  const msg = panelMsg.value.trim();
  callBtn.disabled = true;
  panelStatus.textContent = "呼叫中…";
  panelStatus.className = "panel-status";
  setBotStatus(selectedId, "pinged", "被呼叫");
  logActivity(`呼叫 <strong>${escapeHtml(b.name)}</strong>`);
  try {
    const { ok, data } = await pingBot(selectedId, msg || undefined);
    if (ok) {
      panelStatus.textContent = "已唤醒 ✓";
      panelStatus.className = "panel-status ok";
      setBotStatus(selectedId, "working", msg || "处理中");
      logActivity(`<strong>${escapeHtml(b.name)}</strong> 已响应`);
      glideBot(selectedId, b.desk.x, b.desk.z, 1.8);
    } else {
      panelStatus.textContent = `失败 · ${data.detail || data.error || "upstream"}`;
      panelStatus.className = "panel-status err";
      setBotStatus(selectedId, "error", "呼叫失败");
    }
  } catch {
    panelStatus.textContent = "网络错误";
    panelStatus.className = "panel-status err";
    setBotStatus(selectedId, "error", "网络错误");
  } finally {
    callBtn.disabled = false;
  }
});

async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    const j = await r.json();
    if (!j.ok) throw new Error("bad");
  } catch { /* quiet */ }
}

async function probeWebhook() {
  try {
    const res = await fetch("/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "probe" }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) logActivity("Webhook <strong>probe</strong> OK");
    else logActivity(`Webhook probe 失败 · ${escapeHtml(String(data.detail || res.status))}`);
  } catch {
    logActivity("Webhook probe 网络错误");
  }
}

function applyAmbience(mode) {
  ambience = mode;
  document.body.dataset.ambience = mode;
  document.querySelectorAll(".ambience button").forEach((b) => {
    b.classList.toggle("on", b.dataset.amb === mode);
  });
  if (mode === "day") {
    scene.background.set(0xb8c8dc);
    scene.fog.color.set(0xb8c8dc);
    scene.fog.density = 0.006;
    hemi.intensity = 0.95;
    hemi.color.set(0xf0f4ff);
    hemi.groundColor.set(0xc8b8a0);
    sun.intensity = 1.4;
    sun.color.set(0xfff8f0);
    fill.intensity = 0.45;
    renderer.toneMappingExposure = 1.15;
  } else if (mode === "evening") {
    scene.background.set(0x3a2a38);
    scene.fog.color.set(0x3a2a38);
    scene.fog.density = 0.01;
    hemi.intensity = 0.45;
    hemi.color.set(0xffc8a0);
    hemi.groundColor.set(0x2a2030);
    sun.intensity = 0.7;
    sun.color.set(0xffaa70);
    fill.intensity = 0.25;
    renderer.toneMappingExposure = 1.0;
  } else {
    scene.background.set(0x0a101c);
    scene.fog.color.set(0x0a101c);
    scene.fog.density = 0.012;
    hemi.intensity = 0.28;
    hemi.color.set(0x6a7a9a);
    hemi.groundColor.set(0x1a1520);
    sun.intensity = 0.35;
    sun.color.set(0xc8d4e8);
    fill.intensity = 0.18;
    renderer.toneMappingExposure = 0.95;
  }
}

document.querySelectorAll(".ambience button").forEach((btn) => {
  btn.addEventListener("click", () => applyAmbience(btn.dataset.amb));
});

stopBtn.addEventListener("click", () => {
  simRunning = !simRunning;
  stopBtn.classList.toggle("paused", !simRunning);
  stopBtn.setAttribute("aria-pressed", String(!simRunning));
  stopBtn.innerHTML = simRunning
    ? '<span class="stop-icon"></span> Stop Simulation'
    : '<span class="stop-icon"></span> Resume Simulation';
  logActivity(simRunning ? "Simulation <strong>resumed</strong>" : "Simulation <strong>paused</strong>");
});

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickables, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.botId) obj = obj.parent;
    if (obj?.userData.botId) openPanel(obj.userData.botId);
  }
});

function ambientDrift() {
  if (!simRunning) return;
  const idle = BOTS.filter((b) => state.get(b.id).status === "idle");
  if (!idle.length) return;
  const b = idle[Math.floor(Math.random() * idle.length)];
  const st = state.get(b.id);
  if (st.glide) return;
  const roll = Math.random();
  if (roll < 0.4) {
    setBotStatus(b.id, "thinking", "巡视中");
    const tx = THREE.MathUtils.clamp(b.home.x + (Math.random() - 0.5) * 4, -7, 7);
    const tz = THREE.MathUtils.clamp(b.home.z + (Math.random() - 0.5) * 4, -6, 5.5);
    glideBot(b.id, tx, tz, 2.8 + Math.random() * 1.5);
    setTimeout(() => {
      if (state.get(b.id).status === "thinking") {
        setBotStatus(b.id, "idle", "待命中");
        glideBot(b.id, b.home.x, b.home.z, 2.2);
      }
    }, 5500 + Math.random() * 3500);
  } else if (roll < 0.65) {
    setBotStatus(b.id, "working", "自主任务");
    glideBot(b.id, b.desk.x, b.desk.z, 2);
    setTimeout(() => {
      if (state.get(b.id).status === "working" && state.get(b.id).task === "自主任务") {
        setBotStatus(b.id, "idle", "待命中");
        glideBot(b.id, b.home.x, b.home.z, 2);
      }
    }, 9000 + Math.random() * 5000);
  } else if (roll < 0.8) {
    setBotStatus(b.id, "browsing", "浏览中");
    setTimeout(() => {
      if (state.get(b.id).status === "browsing") setBotStatus(b.id, "idle", "待命中");
    }, 6000 + Math.random() * 4000);
  }
}

/* ─── animate ─── */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const now = performance.now();

  // blink server LEDs
  blinkLeds.forEach((led) => {
    const pulse = led.userData.base * (0.4 + 0.6 * Math.abs(Math.sin(t * 3 + led.userData.blink)));
    led.material.emissiveIntensity = pulse;
  });

  BOTS.forEach((b) => {
    const st = state.get(b.id);
    const mesh = botMeshes.get(b.id);
    if (!mesh) return;

    let moving = false;
    if (simRunning && st.glide) {
      const g = st.glide;
      const u = Math.min(1, (now - g.t0) / g.dur);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      st.x = g.fromX + (g.toX - g.fromX) * e;
      st.z = g.fromZ + (g.toZ - g.fromZ) * e;
      moving = u < 1;
      if (u >= 1) st.glide = null;
      if (moving) updateTrail(b.id, st.x, st.z);
    }

    // float height + idle bob
    const bob = Math.sin(t * 1.6 + st.bobPhase) * 0.06;
    const baseY = 1.2 + bob;
    mesh.position.set(st.x, baseY, st.z);

    // subtle scale pulse when working
    const pulse = st.status === "working" || st.status === "terminal"
      ? 1 + Math.sin(t * 3.5 + st.bobPhase) * 0.06
      : 1 + Math.sin(t * 1.2 + st.bobPhase) * 0.02;
    mesh.scale.setScalar(pulse);

    const light = botLights.get(b.id);
    if (light) {
      light.intensity = (st.status === "idle" ? 0.55 : 1.0) * (0.85 + Math.sin(t * 2.2 + st.bobPhase) * 0.15);
    }

    projectLabel(b.id);
  });

  renderer.render(scene, camera);
}

function onResize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

/* boot */
buildOffice();
BOTS.forEach(createSphereBot);
applyAmbience("night");
renderTeam();
updateStats();
activityLog.innerHTML = `<div class="act-empty">暂无活动 · 点击光球或 Team 列表呼叫 Bot</div>`;
logActivity(`<strong>YOUNG NAF Bot Office</strong> 可视化已上线`);
checkHealth();
probeWebhook();
setInterval(checkHealth, 30000);
setInterval(ambientDrift, 6500);
animate();
