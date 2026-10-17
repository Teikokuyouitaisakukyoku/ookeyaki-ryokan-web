import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// VRoid 標準体型（身長 1.61m・目の高さ 1.47m）
export const BODY = { height: 1.61, eye: 1.47, radius: 0.2, step: 0.45, walk: 1.5, run: 3.2 };
const RAYS_H = [0.55, 1.0, 1.4]; // 壁を調べる高さ（足元から）。0.55 未満の段は上れる
const NEAR_R = 2.5;
const DOWN = new THREE.Vector3(0, -1, 0);

export class Collision {
  constructor(stageScene) {
    this.colliders = [];
    this.spheres = new Map();
    this.near = this.colliders;
    this.nearAt = null;
    this.ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this.build(stageScene);
  }

  // glTF は素材ごとにメッシュが分かれるので、_Col は不可視の当たり専用、_NoCol は当たり無し
  build(root) {
    const invisible = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false });
    const tagged = (o, re) => { for (let p = o; p && p !== root; p = p.parent) if (re.test(p.name)) return true; return false; };
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry.index) o.geometry.setIndex(o.geometry.index.clone()); // BVH は index を並べ替えるので共有を分ける
      o.geometry.computeBoundsTree();
      if (tagged(o, /_Col$/)) { o.material = invisible; this.colliders.push(o); return; }
      if (o.material.transparent) o.material.depthWrite = false;
      if (tagged(o, /_NoCol$/) || tagged(o, /_Stairs$/)) return; // 樹冠・階段の段（当たりは斜面で取る）
      this.colliders.push(o);
    });
    root.updateMatrixWorld(true);
    for (const o of this.colliders) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      this.spheres.set(o, o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld));
    }
  }

  nearColliders(p) {
    if (this.nearAt && Math.hypot(p.x - this.nearAt.x, p.z - this.nearAt.z) < 0.5) return this.near;
    this.nearAt = p.clone();
    this.near = this.colliders.filter((o) => {
      const s = this.spheres.get(o);
      return Math.hypot(s.center.x - p.x, s.center.z - p.z) < s.radius + NEAR_R;
    });
    return this.near;
  }

  worldNormal(hit) {
    return this._n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  }

  /** 足元から step 上を起点に下へ。歩ける面（上向き）の高さ。なければ null */
  groundAt(p) {
    this.ray.set(this._v.set(p.x, p.y + BODY.step + 0.05, p.z), DOWN);
    this.ray.near = 0; this.ray.far = BODY.step + 80;
    for (const h of this.ray.intersectObjects(this.nearColliders(p), false)) {
      if (this.worldNormal(h).y > 0.5) return h.point.y;
    }
    return null;
  }

  wallHit(p, dir, far) {
    let best = null;
    for (const hgt of RAYS_H) {
      this.ray.set(this._v.set(p.x, p.y + hgt, p.z), dir);
      this.ray.near = 0; this.ray.far = far;
      for (const h of this.ray.intersectObjects(this.nearColliders(p), false)) {
        const n = this.worldNormal(h);
        if (Math.abs(n.y) > 0.5) continue; // 床・斜面・天井は壁ではない
        if (!best || h.distance < best.t) best = { t: h.distance, n: n.clone() };
        break;
      }
    }
    return best;
  }

  /** p = 足元（書き換える）、d = 水平の移動量、body.vy = 落下速度 */
  moveBody(p, d, dt, body) {
    d = d.clone();
    for (let it = 0; it < 3 && d.lengthSq() > 1e-10; it++) {
      const len = d.length(), dir = d.clone().divideScalar(len);
      const hit = this.wallHit(p, dir, len + BODY.radius);
      if (!hit) { p.add(d); break; }
      const go = Math.min(Math.max(0, hit.t - BODY.radius), len);
      p.addScaledVector(dir, go);
      const n = hit.n.setY(0).normalize();
      if (n.dot(dir) > 0) n.negate();
      d.multiplyScalar(1 - go / len);
      d.addScaledVector(n, -d.dot(n)); // 壁に沿って滑らせる
    }
    for (let k = 0; k < 8; k++) { // めり込みを押し戻す
      const a = k * Math.PI / 4, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const hit = this.wallHit(p, dir, BODY.radius);
      if (hit) p.addScaledVector(dir, -(BODY.radius - hit.t));
    }
    const g = this.groundAt(p);
    if (g !== null) {
      if (g >= p.y - 0.02) { p.y = g; body.vy = 0; } // 段を上る・床に立つ
      else { body.vy -= 9.8 * dt; p.y = Math.max(g, p.y + body.vy * dt); if (p.y === g) body.vy = 0; }
    }
  }
}
