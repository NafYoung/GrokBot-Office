// 所有"数据"都在这里:谁在办公室、办公室长什么样。
// 改这个文件就能换人、换布局,不用碰渲染和模拟逻辑。

export const OWNER = 'YOUNG NAF';

// 地面格子数:w 沿 gx 方向(向右下),d 沿 gy 方向(向左下)
export const GRID = { w: 14, d: 10 };

export const STATES = {
  coding:   { label: 'Coding',      color: '#8b7cf6' },
  browsing: { label: 'Browsing',    color: '#4ade80' },
  terminal: { label: 'In terminal', color: '#f43f5e' },
  needsYou: { label: 'Needs you',   color: '#fb923c' },
  thinking: { label: 'Thinking',    color: '#facc15' },
  error:    { label: 'Error',       color: '#ef4444' },
  idle:     { label: 'Idle',        color: '#9ca3af' },
};

// handoff.to:交接对象;text:活动日志文案
export const AGENTS = [
  {
    id: 'grok', name: 'Grok Bot', role: '前台总管', color: '#2f5bff',
    tasks: [
      { state: 'thinking', text: 'Routing the next ask' },
      { state: 'coding', text: 'Coordinating teammates' },
    ],
    handoffs: [{ to: 'zhuxian', text: 'Handed a main-track task to 主线学习总管' }],
  },
  {
    id: 'newbee', name: 'newbee naf', role: '个人助理', color: '#facc15',
    tasks: [
      { state: 'browsing', text: 'Checking calendar and inbox' },
      { state: 'thinking', text: 'Planning the day' },
    ],
    handoffs: [{ to: 'grok', text: 'Escalated to Grok Bot' }],
  },
  {
    id: 'guan', name: '观世界', role: 'AI 资讯', color: '#22d3ee',
    tasks: [
      { state: 'browsing', text: 'Scanning OpenAI / Anthropic / xAI / Meta' },
      { state: 'coding', text: 'Writing the morning brief' },
    ],
    handoffs: [{ to: 'diaoyan', text: 'Flagged a paper for 调研简报' }],
  },
  {
    id: 'diaoyan', name: '调研简报', role: '调研写作', color: '#f97316',
    tasks: [
      { state: 'browsing', text: 'Reading a paper or repo' },
      { state: 'coding', text: 'Drafting a Chinese brief' },
    ],
    handoffs: [{ to: 'zhishiku', text: 'Filed notes to 知识库' }],
  },
  {
    id: 'zhuxian', name: '主线学习总管', role: '主线教务', color: '#8b7cf6',
    tasks: [
      { state: 'thinking', text: 'Planning the next study block' },
      { state: 'coding', text: 'Preparing an experiment brief' },
    ],
    handoffs: [{ to: 'python', text: 'Passed a Python drill to Roadmap' }],
  },
  {
    id: 'zhishiku', name: '知识库', role: '知识管理', color: '#22c55e',
    tasks: [
      { state: 'coding', text: 'Filing a new knowledge note' },
      { state: 'browsing', text: 'Retrieving related notes' },
    ],
    handoffs: [{ to: 'mianshi', text: 'Sent talking points to 面试陪练' }],
  },
  {
    id: 'mianshi', name: '面试陪练', role: '面试口述', color: '#fb923c',
    tasks: [
      { state: 'thinking', text: 'Turning a method into spoken points' },
      { state: 'coding', text: 'Drilling an interview answer' },
    ],
    handoffs: [{ to: 'grok', text: 'Reported interview readiness' }],
  },
  {
    id: 'python', name: 'Python Roadmap', role: 'Python 辅导', color: '#92400e',
    tasks: [
      { state: 'coding', text: 'Coaching a Python exercise' },
      { state: 'terminal', text: 'Checking a student run' },
    ],
    handoffs: [{ to: 'zhuxian', text: 'Sent progress back to 主线学习总管' }],
  },
];


export const DESKS = {
  grok:    { x: 7, y: 0 },
  newbee:  { x: 4, y: 4 },
  zhuxian: { x: 8, y: 5 },
  zhishiku:{ x: 10, y: 8 },
  diaoyan: { x: 12, y: 4 },
  guan:    { x: 10, y: 1 },
  mianshi: { x: 12, y: 1 },
  python:  { x: 1, y: 6 },
};


export const RUGS = [
  { label: 'PYTHON ROADMAP',     color: '#a855f7', x0: 0.5,  y0: 5.5, x1: 3.5,  y1: 8.5 },
  { label: 'PERSONAL',           color: '#eab308', x0: 3.5,  y0: 3.5, x1: 6.5,  y1: 6.5 },
  { label: 'MAIN TRACK',         color: '#8b7cf6', x0: 7,    y0: 4,   x1: 10,   y1: 7 },
  { label: 'KNOWLEDGE',          color: '#22c55e', x0: 9,    y0: 7.5, x1: 12,   y1: 10 },
  { label: 'RESEARCH',           color: '#f97316', x0: 11.5, y0: 3.5, x1: 14,   y1: 6.5 },
  { label: 'WORLD + INTERVIEW',  color: '#3b82f6', x0: 9.5,  y0: 0.2, x1: 14,   y1: 3.4 },
];

export const BLOCKS = [
  [0, 2], [0, 3], [0, 4], [0, 5],   // 厨房台面
  [2, 3], [2, 4],                   // 厨房中岛
  [5, 0], [9, 0],                   // 书架、服务器机柜
  [5, 8], [6, 8], [7, 8], [6, 9],   // 沙发、茶几
  [2, 9],                           // 圆桌
  [0, 9], [13, 9], [9, 3], [6, 6],  // 绿植、落地灯
];

// 玻璃隔断:axis 'x' 表示沿 gy 方向延伸的墙(x = at),axis 'y' 表示沿 gx 方向(y = at)
// gap:[a,b) 是门洞占的格子区间
export const WALLS = [
  { axis: 'x', at: 5, from: 0, to: 3 },
  { axis: 'x', at: 9, from: 0, to: 3 },
  { axis: 'y', at: 3, from: 5, to: 9, gap: [6, 7] },
];

// 全员开会时的站位(Alfred 的办公室内部)
export const GATHER = [[5, 1], [6, 1], [8, 1], [5, 2], [6, 2], [7, 2], [8, 2]];

// 休息区站位
export const LOUNGE = [[5, 9], [7, 9], [4, 9], [8, 9]];
