// 办公室「谁在、坐哪、怎么算过期」只改这一份。
// 渲染 / 寻路 / 服务器都会读它。加 bot：复制一条 AGENTS，选 kind + 给 desk 或 spot。

export const OFFICE = {
  owner: 'YOUNG NAF',
  title: 'Bot 办公室',
  wallName: 'YOUNG NAF',
};

export const GRID = { w: 14, d: 10 };

// 超过此时长没新事件 → 过期 / 离线。可按实际上报频率改。
export const FRESHNESS = {
  staleAfterSec: 180,
  offlineAfterSec: 900,
};

export const STATES = {
  coding:   { label: '写代码', color: '#8b7cf6' },
  browsing: { label: '浏览中', color: '#4ade80' },
  terminal: { label: '终端',   color: '#f43f5e' },
  needsYou: { label: '需要你', color: '#fb923c' },
  thinking: { label: '思考中', color: '#facc15' },
  error:    { label: '出错',   color: '#ef4444' },
  idle:     { label: '空闲',   color: '#9ca3af' },
};

export const PRESENCE = {
  fresh:       { label: '实时',   color: '#4ade80' },
  stale:       { label: '过期',   color: '#facc15' },
  offline:     { label: '离线',   color: '#94a3b8' },
  unknown:     { label: '未知',   color: '#64748b' },
  unconnected: { label: '未连接', color: '#64748b' },
};

export const CONVENE_ID = 'grok';

export const WORKING_STATES = ['coding', 'browsing', 'terminal', 'thinking', 'needsYou', 'error'];

// kind:
//   resident   主工位，有 desk
//   auxiliary  按需助手，不占主席，用 spot（休息区）
//   on_demand  工具型，默认不站楼面，有事件才出现
// contact:
//   expected     预期会发事件；没收到就显示「未知」
//   unconnected  配置保留席位，但当前不在可联系名单，显示「未连接」
export const AGENTS = [
  {
    id: 'grok', name: 'Grok Bot', role: '前台总管', color: '#3b82f6',
    kind: 'resident', contact: 'expected',
    aliases: ['grokbot', 'grok bot', '前台总管'],
    desk: { x: 7, y: 0 },
    demo: {
      tasks: [
        { state: 'thinking', text: '【演示】分派下一条请求' },
        { state: 'coding', text: '【演示】协调同事推进任务' },
      ],
      handoffs: [{ to: 'zhuxian', text: '【演示】把主线任务交给学习总管' }],
    },
  },
  {
    id: 'newbee', name: 'newbee naf', role: '个人助理', color: '#eab308',
    kind: 'resident', contact: 'expected',
    aliases: ['newbee naf', '个人助理'],
    desk: { x: 4, y: 4 },
    demo: {
      tasks: [
        { state: 'browsing', text: '【演示】查看日程和收件箱' },
        { state: 'thinking', text: '【演示】安排今天的节奏' },
      ],
      handoffs: [{ to: 'grok', text: '【演示】把事项升级给 Grok Bot' }],
    },
  },
  {
    id: 'guan', name: '观世界', role: 'AI 资讯', color: '#22d3ee',
    kind: 'resident', contact: 'expected',
    aliases: ['观世界'],
    desk: { x: 10, y: 1 },
    demo: {
      tasks: [
        { state: 'browsing', text: '【演示】扫 OpenAI / Anthropic / xAI' },
        { state: 'coding', text: '【演示】写早间简报' },
      ],
      handoffs: [{ to: 'diaoyan', text: '【演示】把一篇论文标给调研简报' }],
    },
  },
  {
    // 当前不在可联系名单，席位保留，默认「未连接」；一旦发来事件就按实时显示
    id: 'diaoyan', name: '调研简报', role: '调研写作', color: '#f97316',
    kind: 'resident', contact: 'unconnected',
    aliases: ['调研简报', 'JD调研', 'jd调研', 'jddiaoyan', 'jd'],
    desk: { x: 12, y: 4 },
    demo: {
      tasks: [
        { state: 'browsing', text: '【演示】读一篇论文或仓库' },
        { state: 'coding', text: '【演示】起草中文简报' },
      ],
      handoffs: [{ to: 'zhishiku', text: '【演示】把笔记归档到知识库' }],
    },
  },
  {
    id: 'zhuxian', name: '主线学习总管', role: '主线教务', color: '#8b7cf6',
    kind: 'resident', contact: 'expected',
    aliases: ['主线学习总管', '学习总管'],
    desk: { x: 8, y: 5 },
    demo: {
      tasks: [
        { state: 'thinking', text: '【演示】规划下一段学习' },
        { state: 'coding', text: '【演示】准备实验说明' },
      ],
      handoffs: [{ to: 'ziliao', text: '【演示】把资料任务交给资料员' }],
    },
  },
  {
    id: 'zhishiku', name: '知识库', role: '知识管理', color: '#22c55e',
    kind: 'resident', contact: 'expected',
    aliases: ['知识库'],
    desk: { x: 10, y: 8 },
    demo: {
      tasks: [
        { state: 'coding', text: '【演示】归档一条知识笔记' },
        { state: 'browsing', text: '【演示】检索相关笔记' },
      ],
      handoffs: [{ to: 'mianshi', text: '【演示】把口述要点发给面试陪练' }],
    },
  },
  {
    id: 'mianshi', name: '面试陪练', role: '面试口述', color: '#fb923c',
    kind: 'resident', contact: 'unconnected',
    aliases: ['面试陪练'],
    desk: { x: 12, y: 1 },
    demo: {
      tasks: [
        { state: 'thinking', text: '【演示】把方法收成口述要点' },
        { state: 'coding', text: '【演示】过一遍面试回答' },
      ],
      handoffs: [{ to: 'grok', text: '【演示】汇报面试准备情况' }],
    },
  },
  {
    id: 'qiwen', name: '奇闻异事', role: '观点闲聊', color: '#a855f7',
    kind: 'resident', contact: 'expected',
    aliases: ['奇闻异事'],
    desk: { x: 1, y: 6 },
    demo: {
      tasks: [
        { state: 'thinking', text: '【演示】顺着一条 X 上的观点往下聊' },
        { state: 'browsing', text: '【演示】读一条有意思的帖子' },
      ],
      handoffs: [{ to: 'guan', text: '【演示】把新闻角度递给观世界' }],
    },
  },
  {
    id: 'ziliao', name: '主线资料员', role: '按需助手', color: '#38bdf8',
    kind: 'auxiliary', contact: 'expected',
    aliases: ['主线资料员', '资料员'],
    spot: [3, 9],
    demo: {
      tasks: [
        { state: 'browsing', text: '【演示】给总管备一份资料' },
        { state: 'coding', text: '【演示】整理实验输入' },
      ],
      handoffs: [{ to: 'zhuxian', text: '【演示】把整理好的资料交回总管' }],
    },
  },
  {
    id: 'shiyan', name: '主线实验助教', role: '按需助手', color: '#c084fc',
    kind: 'auxiliary', contact: 'expected',
    aliases: ['主线实验助教', '实验助教'],
    spot: [8, 9],
    demo: {
      tasks: [
        { state: 'terminal', text: '【演示】帮总管跑一个小实验' },
        { state: 'thinking', text: '【演示】看实验有没有卡住' },
      ],
      handoffs: [{ to: 'yanshou', text: '【演示】把结果交给验收员' }],
    },
  },
  {
    id: 'yanshou', name: '主线验收员', role: '按需助手', color: '#2dd4bf',
    kind: 'auxiliary', contact: 'expected',
    aliases: ['主线验收员', '验收员'],
    spot: [5, 7],
    demo: {
      tasks: [
        { state: 'browsing', text: '【演示】对照验收标准' },
        { state: 'thinking', text: '【演示】写一句验收结论' },
      ],
      handoffs: [{ to: 'zhuxian', text: '【演示】把验收结果交回总管' }],
    },
  },
  {
    id: 'eggbot', name: 'Dr Eggbot', role: '按需设计', color: '#f472b6',
    kind: 'on_demand', contact: 'expected',
    aliases: ['dr eggbot', 'eggbot', 'egg'],
    spot: [1, 8],
    demo: {
      tasks: [{ state: 'coding', text: '【演示】按需出一版设计' }],
      handoffs: [],
    },
  },
];

// 已撤席：不要加 desk。发事件会 422，并带上原因。
// JD调研已合并到调研简报，作为 diaoyan 的别名，不放这里。
export const RETIRED = [
  { id: 'python-roadmap', name: 'Python Roadmap', reason: '休眠，席位已让给奇闻异事' },
  { id: 'lunwen', name: '论文证据核对员', reason: '休眠，不设席位' },
];

export const DESKS = Object.fromEntries(
  AGENTS.filter((a) => a.desk).map((a) => [a.id, a.desk]),
);

export const RUGS = [
  { label: '闲聊', color: '#a855f7', x0: 0.5,  y0: 5.5, x1: 3.5,  y1: 8.5 },
  { label: '个人', color: '#eab308', x0: 3.5,  y0: 3.5, x1: 6.5,  y1: 6.5 },
  { label: '主线', color: '#8b7cf6', x0: 7,    y0: 4,   x1: 10,   y1: 7 },
  { label: '知识', color: '#22c55e', x0: 9,    y0: 7.5, x1: 12,   y1: 10 },
  { label: '调研', color: '#f97316', x0: 11.5, y0: 3.5, x1: 14,   y1: 6.5 },
  { label: '资讯', color: '#22d3ee', x0: 9.5,  y0: 0.2, x1: 11.6, y1: 3.4 },
  { label: '面试', color: '#fb923c', x0: 11.6, y0: 0.2, x1: 14,   y1: 3.4 },
];

export const BLOCKS = [
  [0, 2], [0, 3], [0, 4], [0, 5],
  [2, 3], [2, 4],
  [5, 0], [9, 0],
  [5, 8], [6, 8], [7, 8], [6, 9],
  [2, 9],
  [0, 9], [13, 9], [9, 3], [6, 6],
];

export const WALLS = [
  { axis: 'x', at: 5, from: 0, to: 3 },
  { axis: 'x', at: 9, from: 0, to: 3 },
  { axis: 'y', at: 3, from: 5, to: 9, gap: [6, 7] },
];

export const GATHER = [[5, 1], [6, 1], [8, 1], [5, 2], [6, 2], [7, 2], [8, 2]];
export const LOUNGE = [[5, 9], [7, 9], [4, 9], [8, 9]];
// 空闲时的去处。只有「实时 + 空闲」才会走过去，不代表有新任务。
export const COFFEE = [[1, 2], [1, 5], [3, 5]];
export const STRETCH = [[4, 7], [6, 7], [8, 7], [11, 6]];

export const FONT = '"WenQuanYi Micro Hei", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
