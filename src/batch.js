import * as THREE from 'three';

const CELL = 8; // まとめる範囲（m）。離れた場所の部品はまとめず、画面外の部分を描かずに済むようにする

/**
 * 舞台の描画をまとめる（素材が同じで近くにある部品を 1 つのメッシュにする）。
 * 舞台は約 1400 の部品に分かれていて、描画命令の大半を占めるため。
 * 元の部品は描画しないだけで残す（当たり判定・歩行グラフ・名前で探す手直しはそのまま使える）。
 * まとめないもの: 不可視の当たり専用（_Col）、半透明（重なり順が崩れる）、表示を切り替える部品（skip）
 */
export function batchStage(stage, skip = []) {
  const skipped = new Set();
  for (const o of skip) o.traverse((c) => skipped.add(c));
  stage.updateMatrixWorld(true);
  const groups = new Map();
  stage.traverse((o) => {
    if (!o.isMesh || skipped.has(o) || !o.visible) return;
    const m = o.material;
    if (Array.isArray(m) || !m.visible || m.transparent) return;
    const c = o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere);
    const p = c.center.clone().applyMatrix4(o.matrixWorld);
    const key = `${m.uuid}|${Math.floor(p.x / CELL)},${Math.floor(p.y / 3)},${Math.floor(p.z / CELL)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });

  const root = new THREE.Group();
  root.name = 'StageBatched';
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const mesh = new THREE.Mesh(merge(meshes), meshes[0].material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    for (const o of meshes) o.visible = false;
  }
  root.matrixAutoUpdate = false;
  // 舞台は動かないので、毎フレームの行列計算を省く（夜だけ出し入れする部品も表示の切り替えだけ）
  stage.traverse((o) => { o.matrixAutoUpdate = false; });
  return root;
}

/** 部品をワールド座標に置いた 1 つの形にする（量子化された頂点も float に戻す） */
function merge(meshes) {
  const names = Object.keys(meshes[0].geometry.attributes).filter((n) => meshes.every((o) => o.geometry.attributes[n]));
  let vCount = 0, iCount = 0;
  for (const o of meshes) {
    vCount += o.geometry.attributes.position.count;
    iCount += o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
  }
  const out = Object.fromEntries(names.map((n) => [n, new Float32Array(vCount * meshes[0].geometry.attributes[n].itemSize)]));
  const index = new Uint32Array(iCount);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const o of meshes) {
    const g = o.geometry, n = g.attributes.position.count;
    nm.getNormalMatrix(o.matrixWorld);
    for (const name of names) {
      const a = g.attributes[name], dst = out[name], k = a.itemSize;
      for (let i = 0; i < n; i++) {
        if (name === 'position') { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); v.toArray(dst, (vo + i) * 3); }
        else if (name === 'normal') { v.fromBufferAttribute(a, i).applyMatrix3(nm).normalize(); v.toArray(dst, (vo + i) * 3); }
        else for (let c = 0; c < k; c++) dst[(vo + i) * k + c] = a.getComponent(i, c);
      }
    }
    // 鏡写しの部品は、ワールド座標に直すと三角形の表裏が逆になるので、頂点の順を入れ替える
    const flip = o.matrixWorld.determinant() < 0;
    const count = g.index ? g.index.count : n;
    for (let i = 0; i < count; i++) {
      const j = flip ? i - (i % 3) + [0, 2, 1][i % 3] : i;
      index[io++] = (g.index ? g.index.getX(j) : j) + vo;
    }
    vo += n;
  }
  const geo = new THREE.BufferGeometry();
  for (const name of names) geo.setAttribute(name, new THREE.BufferAttribute(out[name], meshes[0].geometry.attributes[name].itemSize));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
