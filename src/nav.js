/**
 * 歩行グラフ。nav.json は scripts/build-nav.mjs が舞台の当たり判定から事前に作る。
 *   cell: 格子の幅(m) / nodes: [ix, iz, y] / edges: 隣接ノード番号の組（平坦配列）
 */
const INDOOR_Y = 0.2;  // これ以上の床は館内（靴を脱ぐ）
const CROSS_COST = 15; // 館内 ⇔ 外の出入り 1 回の重み(m)

export class NavGraph {
  constructor(data) {
    this.cell = data.cell;
    this.x0 = data.x0;
    this.z0 = data.z0;
    this.nodes = data.nodes.map(([ix, iz, y]) => ({
      x: this.x0 + (ix + 0.5) * this.cell,
      z: this.z0 + (iz + 0.5) * this.cell,
      y,
    }));
    this.adj = this.nodes.map(() => []);
    for (let i = 0; i < data.edges.length; i += 2) {
      const a = data.edges[i], b = data.edges[i + 1];
      this.adj[a].push(b);
      this.adj[b].push(a);
    }
  }

  /** (x, y, z) に最も近いノード番号。y の差は重く見て階を取り違えない */
  nearest(x, y, z) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /**
   * A*。ノード番号の列を返す（到達不能なら null）。
   * 館内（床 0.2m 以上）と土間・屋外の境目をまたぐたびに CROSS_COST(m) を足し、
   * 外から外へ行くのに館内を通り抜ける（靴を何度も脱ぎ履きする）ような経路を避ける
   */
  path(from, to) {
    if (from === to) return [from];
    const N = this.nodes;
    const g = new Float32Array(N.length).fill(Infinity);
    const prev = new Int32Array(N.length).fill(-1);
    const closed = new Uint8Array(N.length);
    const h = (i) => Math.hypot(N[i].x - N[to].x, N[i].z - N[to].z, (N[i].y - N[to].y) * 2);
    const heap = [[h(from), from]];
    g[from] = 0;
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [, u] = pop();
      if (u === to) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const v of this.adj[u]) {
        const cross = (N[u].y < INDOOR_Y) !== (N[v].y < INDOOR_Y) ? CROSS_COST : 0;
        const w = g[u] + Math.hypot(N[u].x - N[v].x, N[u].z - N[v].z, N[u].y - N[v].y) + cross;
        if (w < g[v]) { g[v] = w; prev[v] = u; push([w + h(v), v]); }
      }
    }
    if (prev[to] < 0) return null;
    const out = [];
    for (let i = to; i >= 0; i = prev[i]) out.push(i);
    return out.reverse();
  }
}
