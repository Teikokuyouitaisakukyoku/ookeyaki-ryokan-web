import * as THREE from 'three';

/**
 * 舞台の当たり判定から歩行グラフを作る（開発用・ブラウザ内で実行 → scripts/build-nav.mjs が nav.json に保存）。
 * 床とみなす面は _Floor / _Stairs_Col / _Landings / _Trim（敷居）/ Site_Ground などの名前のメッシュだけ。
 * 家具の天板や屋根の上は床にならない。
 */
const FLOOR_RE = /(_Floor|_Stairs_Col|_Landings|_Trim|Site_Ground|Site_Garden|Site_Road|Site_Stairs_Col|_Col)$/; // _Trim: 敷居
const CELL = 0.25;
const RADIUS = 0.2;      // 壁からの余裕（プレイヤーと同じ。客室の襖の開口 0.62m を通れる幅）
const HEADROOM = 1.75;
const MAX_STEP = 0.42;   // 上がり框(0.40)まで
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export function buildNav(col, startPos, bounds) {
  const colliders = col.colliders;
  const sides = new Map(colliders.map((o) => [o.material, o.material.side]));
  for (const m of sides.keys()) m.side = THREE.DoubleSide;
  const floorMeshes = colliders.filter((o) => {
    for (let p = o; p; p = p.parent) if (FLOOR_RE.test(p.name)) return true;
    return false;
  });
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const normalY = (h) => col._n.copy(h.face.normal).transformDirection(h.object.matrixWorld).y;

  const { minX, maxX, minZ, maxZ, top } = bounds;
  const nx = Math.ceil((maxX - minX) / CELL), nz = Math.ceil((maxZ - minZ) / CELL);
  const cells = new Map(); // key -> [node index...]
  const nodes = [];
  const cellKey = (ix, iz) => iz * nx + ix;

  // 1) 各セルの垂直レイで床の高さを集める
  const pos = new THREE.Vector3();
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + (ix + 0.5) * CELL, z = minZ + (iz + 0.5) * CELL;
      pos.set(x, top, z);
      col.nearAt = null;
      const near = col.nearColliders(pos);
      const nearFloors = near.filter((o) => floorMeshes.includes(o));
      ray.set(pos, down); ray.near = 0; ray.far = top + 5;
      const ys = [];
      for (const h of ray.intersectObjects(nearFloors, false)) {
        if (normalY(h) < 0.5) continue;
        if (!ys.length || ys[ys.length - 1] - h.point.y > 0.05) ys.push(h.point.y);
      }
      for (const y of ys) {
        // 頭上が空いているか・体が壁に触れないか
        ray.set(pos.set(x, y + 0.1, z), up); ray.near = 0; ray.far = HEADROOM;
        if (ray.intersectObjects(near, false).some((h) => normalY(h) < -0.3)) continue;
        let ok = true;
        const foot = new THREE.Vector3(x, y, z);
        for (let k = 0; k < 8 && ok; k++) {
          const a = k * Math.PI / 4, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const hit = col.wallHit(foot, dir, RADIUS);
          if (hit) ok = false;
        }
        if (!ok) continue;
        const idx = nodes.length;
        nodes.push({ ix, iz, y });
        const k = cellKey(ix, iz);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(idx);
      }
    }
  }

  // 2) 隣接セルへ辺を張る（段差・間の壁を確認）
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (const [dx, dz] of DIRS) {
      const list = cells.get(cellKey(a.ix + dx, a.iz + dz));
      if (!list) continue;
      let best = -1, bd = MAX_STEP;
      for (const j of list) {
        const d = Math.abs(nodes[j].y - a.y);
        if (d <= bd) { bd = d; best = j; }
      }
      if (best < 0) continue;
      const b = nodes[best];
      if (best < i) continue; // 無向辺は 1 回だけ
      const ax = minX + (a.ix + 0.5) * CELL, az = minZ + (a.iz + 0.5) * CELL;
      const bx = minX + (b.ix + 0.5) * CELL, bz = minZ + (b.iz + 0.5) * CELL;
      const dir = new THREE.Vector3(bx - ax, 0, bz - az);
      const len = dir.length();
      dir.divideScalar(len);
      const foot = new THREE.Vector3(ax, Math.min(a.y, b.y), az);
      const hit = col.wallHit(foot, dir, len);
      if (hit) continue;
      edges.push(i, best);
    }
  }

  // 3) 出発点から辿れるノードだけを残す
  const adj = nodes.map(() => []);
  for (let e = 0; e < edges.length; e += 2) { adj[edges[e]].push(edges[e + 1]); adj[edges[e + 1]].push(edges[e]); }
  let start = -1, bd = Infinity;
  nodes.forEach((n, i) => {
    const d = (minX + (n.ix + 0.5) * CELL - startPos.x) ** 2 + (minZ + (n.iz + 0.5) * CELL - startPos.z) ** 2 + (n.y - startPos.y) ** 2 * 9;
    if (d < bd) { bd = d; start = i; }
  });
  const seen = new Int32Array(nodes.length).fill(-1);
  const stack = [start];
  seen[start] = 0;
  while (stack.length) { const u = stack.pop(); for (const v of adj[u]) if (seen[v] < 0) { seen[v] = 0; stack.push(v); } }
  const remap = new Int32Array(nodes.length).fill(-1);
  const outNodes = [];
  nodes.forEach((n, i) => { if (seen[i] >= 0) { remap[i] = outNodes.length; outNodes.push([n.ix, n.iz, +n.y.toFixed(3)]); } });
  const outEdges = [];
  for (let e = 0; e < edges.length; e += 2) {
    if (remap[edges[e]] >= 0 && remap[edges[e + 1]] >= 0) outEdges.push(remap[edges[e]], remap[edges[e + 1]]);
  }
  for (const [m, side] of sides) m.side = side;
  return { cell: CELL, x0: minX, z0: minZ, nx, nz, nodes: outNodes, edges: outEdges, total: nodes.length };
}
