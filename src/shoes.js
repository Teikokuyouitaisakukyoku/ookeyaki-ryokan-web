import * as THREE from 'three';

/**
 * 靴のメッシュを探す（表示・非表示で脱ぎ履きする）。
 *   素材が分かれているモデル: VRoid の素材名 ..._Shoes_..._CLOTH のメッシュ（素材は本体と輪郭線の 2 つ組）
 *   素材を 1 つにまとめて書き出したモデル: 体のメッシュから、足・つま先・すねのボーンだけで動く
 *   ひとつながりの部品（＝靴）を切り出して、別のメッシュにする
 */
export function findShoes(vrm) {
  const shoes = [];
  vrm.scene.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => /Shoes/i.test(m.name))) shoes.push(o); });
  if (shoes.length) return shoes;

  const h = vrm.humanoid;
  const footBones = new Set(['leftFoot', 'rightFoot', 'leftToes', 'rightToes', 'leftLowerLeg', 'rightLowerLeg']
    .map((n) => h.getRawBoneNode(n)).filter(Boolean));
  const meshes = [];
  vrm.scene.traverse((o) => { if (o.isSkinnedMesh && o.geometry.index) meshes.push(o); });
  for (const mesh of meshes) {
    const shoe = splitShoes(mesh, footBones);
    if (shoe) shoes.push(shoe);
  }
  return shoes;
}

function splitShoes(mesh, footBones) {
  const g = mesh.geometry;
  const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const idx = g.index.array;
  const n = pos.count;
  // ひとつながりの部品に分ける（同じ位置の頂点 = UV の継ぎ目もつなぐ）
  const par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const join = (a, b) => { par[find(b)] = find(a); };
  for (let t = 0; t < idx.length; t += 3) { join(idx[t], idx[t + 1]); join(idx[t], idx[t + 2]); }
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
    if (seen.has(k)) join(seen.get(k), i); else seen.set(k, i);
  }
  // いちばん強く効くボーンが足まわり以外の頂点を 1 つでも含む部品は靴ではない
  const notShoe = new Set();
  for (let i = 0; i < n; i++) {
    let best = 0, w = -1;
    for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); best = si.getComponent(i, k); }
    if (!footBones.has(mesh.skeleton.bones[best])) notShoe.add(find(i));
  }
  const body = [], shoe = [];
  for (let t = 0; t < idx.length; t += 3) (notShoe.has(find(idx[t])) ? body : shoe).push(idx[t], idx[t + 1], idx[t + 2]);
  if (!shoe.length || !body.length) return null;

  // 靴の三角形を体から外し、同じ頂点・同じ骨組みを使う別のメッシュにする
  const setTris = (geo, tris) => {
    geo.setIndex(tris);
    geo.clearGroups();
    [].concat(mesh.material).forEach((_, m) => geo.addGroup(0, tris.length, m)); // 本体と輪郭線
  };
  const sg = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) sg.setAttribute(name, attr);
  setTris(sg, shoe);
  setTris(g, body);
  const s = new THREE.SkinnedMesh(sg, mesh.material);
  s.name = `${mesh.name}_Shoes`;
  s.frustumCulled = mesh.frustumCulled;
  mesh.parent.add(s);
  s.position.copy(mesh.position); s.quaternion.copy(mesh.quaternion); s.scale.copy(mesh.scale);
  s.bind(mesh.skeleton, mesh.bindMatrix);
  return s;
}
