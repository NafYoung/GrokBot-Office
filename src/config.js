// 所有"数据"都在这里:谁在办公室、办公室长什么样。
// 改这个文件就能换人、换布局,不用碰渲染和模拟逻辑。

export const OWNER = 'David';

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
    id: 'alfred', name: 'Alfred', role: 'Chief of Staff', color: '#2f5bff',
    tasks: [
      { state: 'thinking', text: 'Planning the week for the team' },
      { state: 'coding', text: 'Writing the morning brief' },
    ],
    handoffs: [{ to: 'atlas', text: 'Sent the priorities to Atlas' }],
  },
  {
    id: 'atlas', name: 'Atlas', role: 'Calendar', color: '#facc15',
    tasks: [
      { state: 'thinking', text: "Lining up next week's calendar" },
      { state: 'coding', text: 'Drafting meeting invites' },
      { state: 'browsing', text: 'Checking availability' },
    ],
    handoffs: [{ to: 'alfred', text: 'Took the updated schedule to Alfred' }],
  },
  {
    id: 'fetch', name: 'Fetch', role: 'Execution', color: '#f97316',
    tasks: [
      { state: 'terminal', text: 'Running the errand checklist' },
      { state: 'browsing', text: 'Tracking a delivery' },
    ],
    handoffs: [{ to: 'claim', text: 'Dropped off a parcel for Claim' }],
  },
  {
    id: 'scout', name: 'Scout', role: 'Research', color: '#22d3ee',
    tasks: [
      { state: 'browsing', text: 'Researching market reports' },
      { state: 'coding', text: 'Summarizing findings' },
    ],
    handoffs: [{ to: 'radar', text: 'Handed over the research notes' }],
  },
  {
    id: 'warren', name: 'Warren', role: 'Finance', color: '#22c55e',
    tasks: [
      { state: 'coding', text: 'Reconciling the monthly budget' },
      { state: 'browsing', text: 'Checking account balances' },
    ],
    handoffs: [{ to: 'alfred', text: 'Delivered the budget file' }],
  },
  {
    id: 'claim', name: 'Claim', role: 'Insurance', color: '#9ca3af',
    tasks: [
      { state: 'browsing', text: 'Reviewing a policy renewal' },
      { state: 'coding', text: 'Filing claim paperwork' },
    ],
    handoffs: [{ to: 'warren', text: 'Passed the invoice to Warren' }],
  },
  {
    id: 'radar', name: 'Radar', role: 'X Intel', color: '#1f2937',
    tasks: [
      { state: 'terminal', text: 'Scanning the X timeline' },
      { state: 'browsing', text: 'Tracking trending topics' },
    ],
    handoffs: [{ to: 'scout', text: 'Flagged a trend for Scout' }],
  },
  {
    id: 'drone', name: 'Drone Business', role: 'Drones', color: '#92400e',
    tasks: [
      { state: 'coding', text: 'Planning a drone shoot' },
      { state: 'terminal', text: 'Editing aerial footage' },
    ],
    handoffs: [{ to: 'alfred', text: 'Sent the shoot plan to Alfred' }],
  },
];

// 桌子占 (x,y)、(x+1,y) 两格;座位固定在 (x, y+1),访客站位在 (x+1, y+1)
export const DESKS = {
  alfred: { x: 7, y: 0 },
  atlas:  { x: 4, y: 4 },
  warren: { x: 8, y: 5 },
  claim:  { x: 10, y: 8 },
  fetch:  { x: 12, y: 4 },
  scout:  { x: 10, y: 1 },
  radar:  { x: 12, y: 1 },
  drone:  { x: 1, y: 6 },
};

// 地毯分区(地面坐标,单位:格)
export const RUGS = [
  { label: 'DRONE BUSINESS',            color: '#a855f7', x0: 0.5,  y0: 5.5, x1: 3.5,  y1: 8.5 },
  { label: 'CALENDAR AND SCHEDULING',   color: '#eab308', x0: 3.5,  y0: 3.5, x1: 6.5,  y1: 6.5 },
  { label: 'FINANCE',                   color: '#22c55e', x0: 7,    y0: 4,   x1: 10,   y1: 7 },
  { label: 'HEALTH AND INSURANCE',      color: '#ec4899', x0: 9,    y0: 7.5, x1: 12,   y1: 10 },
  { label: 'OPERATIONS AND EXECUTION',  color: '#f97316', x0: 11.5, y0: 3.5, x1: 14,   y1: 6.5 },
  { label: 'RESEARCH AND INTELLIGENCE', color: '#3b82f6', x0: 9.5,  y0: 0.2, x1: 14,   y1: 3.4 },
];

// 家具占用的格子(不能走)。桌子由 DESKS 自动加入。
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
