import * as THREE from 'three';
import { Pose } from './pose.js';
import { ROUTES } from './routes.js';

const WALK_SPEED = 1.15;
const TURN_RATE = 6;          // rad/s
const SIT_TIME = 0.9;         // 座る・立つの遷移秒
const rand = ([a, b]) => a + Math.random() * (b - a);

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

class Resident {
  constructor(name, vrm, world) {
    this.name = name;
    this.vrm = vrm;
    this.world = world; // { nav, seats, spawns }
    this.root = vrm.scene;
    this.pose = new Pose(vrm);
    this.script = ROUTES[name];
    this.step = -1;
    this.state = 'idle';
    this.timer = 0;
    this.path = [];
    this.pi = 0;
    this.yaw = 0;
    this.node = -1;
    this.seat = null;
    this.seatT = 0;
    this.seatFrom = new THREE.Vector3();
    this.seatYawFrom = 0;
  }

  place(nodeIdx) {
    const n = this.world.nav.nodes[nodeIdx];
    this.node = nodeIdx;
    this.root.position.set(n.x, n.y, n.z);
  }

  resolve(target) {
    const { nav, seats, spawns } = this.world;
    if (target.seat) {
      const s = seats.find((v) => v.name === target.seat);
      if (!s) throw new Error(`seat not found: ${target.seat}`);
      return { node: nav.nearest(s.position[0], s.position[1] - 0.5, s.position[2]), seat: s };
    }
    const sp = spawns.find((v) => v.name === target.at);
    if (!sp) throw new Error(`spawn not found: ${target.at}`);
    return { node: nav.nearest(sp.pos[0], sp.pos[1], sp.pos[2]), seat: null };
  }

  nextStep() {
    this.step = (this.step + 1) % this.script.length;
    const st = this.script[this.step];
    if (st.wait) {
      this.state = 'idle';
      this.timer = rand(st.wait);
      return;
    }
    const { node, seat } = this.resolve(st);
    const path = this.world.nav.path(this.node, node);
    if (!path) { console.warn(`${this.name}: 経路なし → ${JSON.stringify(st)}`); this.state = 'idle'; this.timer = 1; return; }
    this.path = path;
    this.pi = 1;
    this.seat = seat;
    this.stay = st.stay;
    this.state = 'walk';
  }

  update(dt) {
    const p = this.pose;
    const pos = this.root.position;
    const nav = this.world.nav;

    if (this.state === 'idle') {
      this.timer -= dt;
      p.walk = Math.max(0, p.walk - dt * 4);
      if (this.timer <= 0) this.nextStep();
    } else if (this.state === 'walk') {
      p.walk = Math.min(1, p.walk + dt * 4);
      let budget = WALK_SPEED * dt;
      while (budget > 0 && this.pi < this.path.length) {
        const t = nav.nodes[this.path[this.pi]];
        const dx = t.x - pos.x, dz = t.z - pos.z;
        const d = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        if (d > 0.01) this.yaw = angleLerp(this.yaw, want, Math.min(1, TURN_RATE * dt));
        if (d <= budget) {
          pos.set(t.x, t.y, t.z);
          budget -= d;
          this.node = this.path[this.pi];
          this.pi++;
        } else {
          const f = budget / d;
          pos.x += dx * f; pos.z += dz * f; pos.y += (t.y - pos.y) * f;
          budget = 0;
        }
      }
      p.speed = WALK_SPEED;
      if (this.pi >= this.path.length) {
        if (this.seat) this.beginSit();
        else { this.state = 'idle'; this.timer = 0.01; this.nextStep(); }
      }
    } else if (this.state === 'sitting' || this.state === 'sit-stay' || this.state === 'standing') {
      this.updateSeat(dt);
    }
    if (this.state !== 'walk') p.speed = 0;
    this.root.rotation.y = this.yaw;
    p.update(dt);
  }

  // ---- 着席
  beginSit() {
    const s = this.seat;
    this.state = 'sitting';
    this.seatT = 0;
    this.seatFrom.copy(this.root.position);
    this.seatYawFrom = this.yaw;
    this.seatYaw = Math.atan2(s.forward[0], s.forward[2]);
    this.seatPos = new THREE.Vector3(s.position[0], 0, s.position[2]);
    this.seatFloorY = this.root.position.y;
    const floorKind = s.kind === 'zabuton' || s.kind === 'zaisu';
    this.pose.sitKind = floorKind ? 'floor' : 'chair';
    // 腰の高さ（ルートから）: 座面 + 尻の厚み
    this.pose.hipsY = s.position[1] - this.seatFloorY + (floorKind ? 0.1 : 0.1);
    this.sitHold = rand(this.stay || [10, 20]);
  }

  updateSeat(dt) {
    const p = this.pose, pos = this.root.position;
    p.walk = Math.max(0, p.walk - dt * 6);
    if (this.state === 'sitting') {
      this.seatT = Math.min(1, this.seatT + dt / SIT_TIME);
      const e = this.seatT * this.seatT * (3 - 2 * this.seatT);
      p.sit = e;
      pos.x = THREE.MathUtils.lerp(this.seatFrom.x, this.seatPos.x, e);
      pos.z = THREE.MathUtils.lerp(this.seatFrom.z, this.seatPos.z, e);
      this.yaw = angleLerp(this.seatYawFrom, this.seatYaw, e);
      if (this.seatT >= 1) { this.state = 'sit-stay'; this.timer = this.sitHold; }
    } else if (this.state === 'sit-stay') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'standing'; this.seatT = 1; }
    } else {
      this.seatT = Math.max(0, this.seatT - dt / SIT_TIME);
      const e = this.seatT * this.seatT * (3 - 2 * this.seatT);
      p.sit = e;
      pos.x = THREE.MathUtils.lerp(this.seatFrom.x, this.seatPos.x, e);
      pos.z = THREE.MathUtils.lerp(this.seatFrom.z, this.seatPos.z, e);
      this.yaw = angleLerp(this.seatYawFrom, this.seatYaw, e);
      if (this.seatT <= 0) { p.sit = 0; this.seat = null; this.state = 'idle'; this.timer = 0.01; }
    }
  }
}

export class Residents {
  constructor(scene, vrms, nav, seats, spawns) {
    this.list = [];
    for (const [name, vrm] of Object.entries(vrms)) {
      const r = new Resident(name, vrm, { nav, seats, spawns });
      const start = r.resolve(ROUTES[name].find((s) => s.at || s.seat));
      r.place(start.node);
      r.nextStep();
      scene.add(vrm.scene);
      this.list.push(r);
    }
  }

  update(dt) { for (const r of this.list) r.update(dt); }
}
