import * as THREE from 'three';
import { Pose } from './pose.js';
import { ROUTES } from './routes.js';
import { STYLE } from './motions.js';

const WALK_SPEED = 1.15;
const TURN_RATE = 6;          // rad/s
const SIT_TIME = 0.9;         // 座る・立つの遷移秒
const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const NOTICE_R = 3.0;         // この距離まで近づくと立ち止まってこちらを見る
const NOTICE_OUT = 3.6;       // 離れたら元の動きに戻る距離
const TALK_R = 1.4;           // 正面のこの距離で会話
export const TALK = {
  kyokucho: { name: '局長', line: 'どうしたの？' },
  hachi: { name: 'Hachi', line: 'どうされましたか？' },
  shinkuro: { name: '真九郎', line: 'どうしたのですん？' },
};

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

class Resident {
  constructor(name, vrm, world, clips) {
    this.name = name;
    this.vrm = vrm;
    this.world = world; // { nav, seats, spawns }
    this.root = vrm.scene;
    this.pose = new Pose(vrm, clips);
    this.style = STYLE[name];
    // VRMA の歩きは足の運びから速さを測り、移動速度に合わせて再生速度を変える（足が滑らないように）
    this.walkScale = this.style.walk !== 'proc' ? this.pose.walkTimeScale(this.style.walk, WALK_SPEED) : 1;
    this.gestureAt = -1;
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
    this.attending = false; // プレイヤーに気づいて見ている
    this.talkable = false;  // 正面で話せる距離にいる
    this.dist = Infinity;
  }

  /** プレイヤー（eye = 目の位置）との距離から、気づく・話せるを決める */
  sense(eye) {
    const pos = this.root.position;
    const dy = eye.y - pos.y;
    const same = dy > 0.3 && dy < 2.6; // 同じ階にいる
    this.dist = same ? Math.hypot(eye.x - pos.x, eye.z - pos.z) : Infinity;
    // 座る・立つの途中は気づいても動きを止めない
    const busy = this.state === 'sitting' || this.state === 'standing';
    if (!this.attending && this.dist < NOTICE_R && !busy) this.startAttend();
    else if (this.attending && this.dist > NOTICE_OUT) this.endAttend();
    // 正面: キャラの向きから ±50° 以内
    const toward = Math.atan2(eye.x - pos.x, eye.z - pos.z);
    const off = Math.abs(angleLerp(0, toward - this.yaw, 1));
    this.talkable = this.attending && this.dist < TALK_R && off < 0.9;
    this.toward = toward;
  }

  startAttend() {
    this.attending = true;
    if (this.state === 'walk' || this.state === 'idle') {
      // 立っていれば、挨拶の仕草を 1 回してから待機
      this.pose.play(this.style.greet, { once: true, fade: 0.3, onDone: () => this.attending && this.pose.play(pick(this.style.idle), { fade: 0.5 }) });
    }
  }

  endAttend() {
    this.attending = false;
    if (this.state === 'walk') this.pose.play(this.style.walk, { timeScale: this.walkScale, fade: 0.4 });
    else if (this.state === 'idle') this.startIdle();
  }

  /** 首と目をプレイヤーへ。立っているなら体ごと向く */
  attend(dt, eye) {
    const p = this.pose, pos = this.root.position;
    const standing = this.state === 'walk' || this.state === 'idle';
    if (standing) {
      p.walk = Math.max(0, p.walk - dt * 5);
      this.yaw = angleLerp(this.yaw, this.toward, Math.min(1, 4 * dt));
    }
    const rel = Math.max(-1.0, Math.min(1.0, angleLerp(0, this.toward - this.yaw, 1)));
    const headY = pos.y + (this.state === 'sit-stay' ? 0.95 : 1.4);
    const pitch = -Math.atan2(eye.y - headY, Math.max(0.3, this.dist));
    p.lookYaw = THREE.MathUtils.lerp(p.lookYaw, rel, Math.min(1, 6 * dt));
    p.lookPitch = THREE.MathUtils.lerp(p.lookPitch, Math.max(-0.5, Math.min(0.5, pitch)), Math.min(1, 6 * dt));
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
      this.startIdle();
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
    this.pose.play(this.style.walk, { timeScale: this.walkScale, fade: 0.35 });
  }

  /** 立ち待機を選ぶ（手続きか VRMA）。長めの待機ではときどき仕草を挟む */
  startIdle() {
    this.pose.play(pick(this.style.idle), { fade: 0.5 });
    this.gestureAt = this.timer > 2.5 && Math.random() < 0.5 ? this.timer * rand([0.5, 0.8]) : -1;
  }

  update(dt, eye, camera) {
    const p = this.pose;
    const pos = this.root.position;
    const nav = this.world.nav;
    if (eye) this.sense(eye);
    else if (this.attending) { this.endAttend(); this.talkable = false; }
    this.vrm.lookAt && (this.vrm.lookAt.target = this.attending ? camera : null);
    if (!this.attending) {
      p.lookYaw = THREE.MathUtils.lerp(p.lookYaw, 0, Math.min(1, 3 * dt));
      p.lookPitch = THREE.MathUtils.lerp(p.lookPitch, 0, Math.min(1, 3 * dt));
      if (this.vrm.lookAt) { this.vrm.lookAt.yaw = 0; this.vrm.lookAt.pitch = 0; }
    }

    if (this.attending && this.state !== 'sitting' && this.state !== 'standing') {
      // 立ち止まって（座っていれば座ったまま）こちらを見る。タイマーも止める
      this.attend(dt, eye);
      p.speed = 0;
      this.root.rotation.y = this.yaw;
      p.update(dt);
      return;
    } else if (this.state === 'idle') {
      this.timer -= dt;
      p.walk = Math.max(0, p.walk - dt * 4);
      if (this.gestureAt > 0 && this.timer < this.gestureAt) {
        this.gestureAt = -1;
        p.play(pick(this.style.gesture), { once: true, fade: 0.4, onDone: () => this.state === 'idle' && p.play(pick(this.style.idle), { fade: 0.5 }) });
      }
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
    this.pose.play(null, { fade: 0.3 }); // 座る動きは手続きで
    // 腰の高さ（ルートから）: 座面 + 尻の厚み
    this.pose.hipsY = s.position[1] - this.seatFloorY + (floorKind ? 0.08 : 0.03);
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
      if (this.seatT >= 1) {
        this.state = 'sit-stay';
        this.timer = this.sitHold;
        // 椅子は VRMA の座り待機も使う（腰の高さは座面に合わせる）。床座りは手続きの正座
        if (p.sitKind === 'chair') p.play(pick(this.style.chairIdle), { fade: 0.6 });
      }
    } else if (this.state === 'sit-stay') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'standing'; this.seatT = 1; p.play(null, { fade: 0.3 }); }
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
  constructor(scene, vrms, nav, seats, spawns, clips = {}) {
    this.list = [];
    for (const [name, vrm] of Object.entries(vrms)) {
      const r = new Resident(name, vrm, { nav, seats, spawns }, clips[name] || {});
      const start = r.resolve(ROUTES[name].find((s) => s.at || s.seat));
      r.place(start.node);
      r.nextStep();
      scene.add(vrm.scene);
      this.list.push(r);
    }
  }

  /** eye = プレイヤーの目の位置。いちばん近い「話せる」住人を返す */
  update(dt, eye, camera) {
    let talk = null;
    for (const r of this.list) {
      r.update(dt, eye, camera);
      if (r.talkable && (!talk || r.dist < talk.dist)) talk = r;
    }
    return talk;
  }
}
