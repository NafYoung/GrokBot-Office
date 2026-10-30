// 世界 = 一张格子地图 + 墙。只负责"哪里能走、怎么走",不画任何东西,所以能在 Node 里直接测试。
import { GRID, DESKS, BLOCKS, WALLS } from './config.js';

export class World {
  constructor() {
    this.w = GRID.w;
    this.d = GRID.d;
    this.walls = WALLS;
    this.blocked = new Set();
    for (const d of Object.values(DESKS)) {
      this.block(d.x, d.y);
      this.block(d.x + 1, d.y);
    }
    for (const [x, y] of BLOCKS) this.block(x, y);
  }

  block(x, y) { this.blocked.add(`${x},${y}`); }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.d; }

  walkable(x, y) { return this.inBounds(x, y) && !this.blocked.has(`${x},${y}`); }

  // 从格子 a 走到相邻格子 b,是否穿过玻璃墙(门洞除外)
  crossesWall(ax, ay, bx, by) {
    for (const wall of this.walls) {
      if (wall.axis === 'x' && ay === by) {
        // 水平移动,穿过竖线 x = max(ax,bx)
        if (Math.max(ax, bx) === wall.at && ay >= wall.from && ay < wall.to) return true;
      }
      if (wall.axis === 'y' && ax === bx) {
        if (Math.max(ay, by) === wall.at && ax >= wall.from && ax < wall.to) {
          const g = wall.gap;
          if (g && ax >= g[0] && ax < g[1]) continue; // 门洞
          return true;
        }
      }
    }
    return false;
  }

  // 广度优先搜索(每步代价相同,BFS 就是最短路)。返回不含起点的格子序列,到不了返回 null。
  findPath(from, to) {
    const key = (x, y) => y * this.w + x;
    if (!this.walkable(to[0], to[1])) return null;
    if (from[0] === to[0] && from[1] === to[1]) return [];
    const prev = new Map([[key(from[0], from[1]), null]]);
    const queue = [from];
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let i = 0; i < queue.length; i++) {
      const [cx, cy] = queue[i];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.walkable(nx, ny)) continue;
        if (this.crossesWall(cx, cy, nx, ny)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, [cx, cy]);
        if (nx === to[0] && ny === to[1]) {
          const path = [];
          let cur = [nx, ny];
          while (cur && !(cur[0] === from[0] && cur[1] === from[1])) {
            path.push(cur);
            cur = prev.get(key(cur[0], cur[1]));
          }
          return path.reverse();
        }
        queue.push([nx, ny]);
      }
    }
    return null;
  }
}
