import * as THREE from 'three';
import { Pose, BREATH } from './pose.js';
import { ROUTES } from './routes.js';
import { STYLE } from './motions.js';
import { SCHEDULE, BEDS, now, inHours, nightOf } from './schedule.js';
import { TOUCH } from './touch.js';
import { findShoes } from './shoes.js';

const WALK_SPEED = 1.15;
const TURN_RATE = 6;          // rad/s
const SIT_TIME = 0.9;         // 座る・立つの遷移秒
const rand = ([a, b]) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// 靴: 館内では脱ぐ。足元がこの高さより低い（土間・屋外）ときだけ履く（3 人とも）
// 踏み石・沓脱石など途中の高さで脱ぎ履きを繰り返さないよう、履くのは SHOE_ON より下へ、脱ぐのは SHOE_OFF より上へ行くとき
const SHOE_Y = 0.2;
const SHOE_ON = 0.1;
const SHOE_OFF = 0.3;
const SHOE_WEARERS = ['kyokucho', 'shinkuro', 'hachi'];
const SHOE_SWAP = 0.45;       // しゃがむ動きのこの割合のところで靴を付け外しする
const PULL_SPEED = 2.2;        // 引っ張られて動く最大速度(m/s)
const ARM_LEN = 0.55;         // つかまれた手と体の距離
const LIE_TIME = 1.8;         // 横になる・起き上がる秒
const WAKE_R = 1.8;           // 寝ている住人がこの距離まで近づかれると起きる
const NOTICE_R = 3.0;         // この距離まで近づくと立ち止まってこちらを見る
const NOTICE_OUT = 3.6;       // 離れたら元の動きに戻る距離
const TALK_R = 1.4;           // 正面のこの距離で会話
const NOTICE_WAIT = 4;        // 気づいたあと、この秒数プレイヤーが近づいてこなければ元の動きに戻る
const NEAR_STEP = 0.3;        // これだけ近づくと「近づいてきた」として待ち時間を数え直す
const RENOTICE = 0.5;         // 見るのをやめたあと、そこからさらにこれだけ近づかれたらまた気づく
export const TALK = {
  // name: 表示名 / pat: 会話中に頭をクリックしたとき（通常モードの点カーソル）。会話の文面は lines.js
  kyokucho: { name: '局長', pat: 'なにすんのよ！ セクハラよ！ セクハラ！' },
  hachi: { name: 'Hachi', pat: 'えっと……どうも、ありがとうございます？' },
  shinkuro: { name: '真九郎', pat: 'えへへ、くすぐったいですん……' },
};
export { NOTICE_OUT };

const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3(), _h3 = new THREE.Vector3();

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
    this.ignore = false;     // 会話の後は、いったん離れるまでプレイヤーに反応しない
    this.ignoreUntil = -Infinity; // 見飽きた（ignore）とき、この距離より近づかれたらまた気づく
    this.focused = false;    // この住人と会話中
    this.noticeT = 0;        // 気づいてから近づかれていない秒数
    this.nearest = Infinity; // 気づいてからいちばん近づかれた距離
    this.suppressed = false; // ほかの住人が会話中は反応しない
    // 時間割
    this.sched = SCHEDULE[name] || null;
    this.mode = 'routine';   // routine | sleep | room
    this.wokeNight = null;   // 起こされた夜（その夜はもう寝ない）
    this.root.rotation.order = 'YXZ'; // 向き → 傾き（横になる）の順
    this.shoes = SHOE_WEARERS.includes(name) ? findShoes(vrm) : [];
    this.shoesOn = true;
    if (this.sched?.bed) this.setupBed(BEDS[this.sched.bed]);
  }

  // ---- 時間割
  wantMode(d) {
    const s = this.sched;
    if (!s || !inHours(d, s.from, s.to)) return 'routine';
    if (s.mode === 'sleep' && this.wokeNight === nightOf(d)) return 'routine';
    return s.mode;
  }

  /** 時刻で行動を切り替える。今の動作（座る途中など）は区切りまで待つ */
  checkSchedule(d) {
    const want = this.wantMode(d);
    if (want === this.mode) return;
    this.mode = want;
    if (this.state === 'idle') this.timer = 0;
    else if (this.state === 'walk') this.nextStep();
    else if (this.state === 'sit-stay') this.timer = 0;
    else if (this.state === 'sleeping') this.wake();
  }

  setupBed(b) {
    const [cx, cy, cz] = b.center, [hx, hz] = b.head;
    this.bed = {
      center: new THREE.Vector3(cx, cy, cz),
      // 足元（体の原点）。頭が枕側に来るよう、中心から足側へ 0.5m
      root: new THREE.Vector3(cx - hx * 0.5, cy + 0.12, cz - hz * 0.5),
      yaw: Math.atan2(-hx, -hz), // 横になると体の -Z（後ろ）方向に頭が来る
      node: this.world.nav.nearest(cx - hx * 0.9, cy - 0.19, cz - hz * 0.9),
    };
  }

  /** 読み込んだ時点で就寝中: 布団の上に寝かせて置く */
  sleepNow() {
    this.setShoes(false);
    this.node = this.bed.node;
    this.lieFrom = this.nodePos(this.bed.node);
    this.lieYawFrom = this.bed.yaw;
    this.lieT = 1;
    this.applyLie();
    this.state = 'sleeping';
    this.setBlink(1);
  }

  nodePos(i) { const n = this.world.nav.nodes[i]; return new THREE.Vector3(n.x, n.y, n.z); }

  setBlink(v) { this.vrm.expressionManager?.setValue('blink', v); }

  beginLie() {
    this.state = 'lying';
    this.lieT = 0;
    this.lieFrom = this.root.position.clone();
    this.lieYawFrom = this.yaw;
    this.pose.play(null, { fade: 0.3 });
  }

  /** byPlayer: プレイヤーに起こされた（その夜はもう寝ない）。朝の起床は false */
  wake(byPlayer = false) {
    if (byPlayer) this.wokeNight = nightOf(now());
    this.mode = 'routine';
    this.state = 'waking';
    this.lieFrom = this.nodePos(this.bed.node);
    this.lieYawFrom = this.bed.yaw;
    this.setBlink(0);
  }

  /** lieT: 0 = 立っている、1 = 布団に横になっている。途中は床に座ってから後ろへ倒れる */
  applyLie() {
    const t = this.lieT, e = t * t * (3 - 2 * t);
    const pos = this.root.position;
    pos.lerpVectors(this.lieFrom, this.bed.root, e);
    this.yaw = angleLerp(this.lieYawFrom, this.bed.yaw, Math.min(1, e * 1.6));
    const back = THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1);
    this.root.rotation.x = -Math.PI / 2 * back * back * (3 - 2 * back);
    const p = this.pose;
    p.sitKind = 'floor';
    p.hipsY = 0.1;
    p.sit = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.95; // 途中で膝を曲げて座り、寝るときは脚を伸ばす
    p.walk = 0;
  }

  updateLie(dt) {
    if (this.state === 'lying') {
      this.lieT = Math.min(1, this.lieT + dt / LIE_TIME);
      if (this.lieT >= 1) { this.state = 'sleeping'; this.setBlink(1); }
    } else if (this.state === 'waking') {
      this.lieT = Math.max(0, this.lieT - dt / LIE_TIME);
      if (this.lieT <= 0) { this.root.rotation.x = 0; this.pose.sit = 0; this.state = 'idle'; this.timer = 0.01; this.node = this.bed.node; return; }
    }
    this.applyLie();
  }

  /** プレイヤー（eye = 目の位置）との距離から、気づく・話せるを決める */
  sense(eye) {
    const lying = this.state === 'sleeping' || this.state === 'lying' || this.state === 'waking';
    const pos = lying ? this.bed.center : this.root.position;
    const dy = eye.y - pos.y;
    const same = dy > 0.3 && dy < 2.6; // 同じ階にいる
    this.dist = same ? Math.hypot(eye.x - pos.x, eye.z - pos.z) : Infinity;
    if (this.state === 'dragged') { this.talkable = false; return; }
    if (lying) { // 寝ている: 近くまで来られたら起きる
      if (this.state === 'sleeping' && this.dist < WAKE_R) this.wake(true);
      this.talkable = false;
      return;
    }
    // 座る・立つの途中は気づいても動きを止めない
    const busy = this.state === 'sitting' || this.state === 'standing' || this.state === 'shoes';
    if (this.ignore && (this.dist > NOTICE_OUT || this.dist < this.ignoreUntil)) this.ignore = false;
    const can = !this.ignore && !this.suppressed;
    if (!this.attending && this.dist < NOTICE_R && !busy && can) this.startAttend();
    else if (this.attending && (this.dist > NOTICE_OUT || !can)) this.endAttend();
    // 正面: キャラの向きから ±50° 以内
    const toward = Math.atan2(eye.x - pos.x, eye.z - pos.z);
    const off = Math.abs(angleLerp(0, toward - this.yaw, 1));
    this.talkable = this.attending && this.dist < TALK_R && off < 0.9;
    this.toward = toward;
  }

  /** 見ている間、近づいてこないまま NOTICE_WAIT 秒たったら元の動きに戻る（会話中は除く） */
  waitPlayer(dt) {
    if (this.focused) return;
    if (this.dist < this.nearest - NEAR_STEP) { this.nearest = this.dist; this.noticeT = 0; return; }
    this.noticeT += dt;
    if (this.noticeT < NOTICE_WAIT) return;
    this.loseInterest();
    this.ignoreUntil = this.dist - RENOTICE;
  }

  startAttend() {
    this.attending = true;
    this.noticeT = 0;
    this.nearest = this.dist;
    if (this.state === 'walk' || this.state === 'idle') {
      // 立っていれば、挨拶の仕草を 1 回してから待機
      this.pose.play(this.style.greet, { once: true, fade: 0.3, onDone: () => this.attending && this.pose.play(pick(this.style.idle), { fade: 0.5 }) });
    }
  }

  /** 会話が終わった・返事がなかった: 元の動きに戻り、プレイヤーが離れるまで反応しない */
  loseInterest() {
    this.ignore = true;
    this.ignoreUntil = -Infinity;
    this.talkable = false;
    if (this.attending) this.endAttend();
  }

  // ---- タッチ・引っ張り
  /** 触れられた: 反応のせりふを返す。立っていれば動きも付ける。寝ていれば起きる */
  reactTouch(part) {
    const t = TOUCH[this.name];
    if (this.state === 'sleeping') { this.wake(true); return t.wake.line; }
    if (this.state === 'lying' || this.state === 'waking' || this.state === 'dragged') return null;
    const standing = this.state === 'walk' || this.state === 'idle';
    if (standing) {
      if (this.state === 'walk') { this.state = 'idle'; this.timer = 3; } // 立ち止まる
      this.attending = true;
      const m = t[part].motion;
      if (m) this.pose.play(m, { once: true, fade: 0.25, onDone: () => this.state === 'idle' && this.pose.play(pick(this.style.idle), { fade: 0.5 }) });
    }
    return t[part].line;
  }

  /** 引っ張れるか（立っているときだけ） */
  canGrab() { return this.state === 'walk' || this.state === 'idle'; }

  beginDrag(side) {
    if (!this.canGrab()) return false;
    this.state = 'dragged';
    this.attending = false;
    this.talkable = false;
    this.pose.play(null, { fade: 0.2 });
    this.pose.reach = side;
    this.dragTarget = this.root.position.clone();
    this.dragBody = { vy: 0 };
    return true;
  }

  updateDrag(dt) {
    const p = this.pose, pos = this.root.position;
    const dx = this.dragTarget.x - pos.x, dz = this.dragTarget.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), Math.min(1, 8 * dt));
    const want = Math.min(d - ARM_LEN, PULL_SPEED * dt);
    const before = pos.clone();
    if (want > 0) this.world.collision.moveBody(pos, new THREE.Vector3(dx / d * want, 0, dz / d * want), dt, this.dragBody);
    const speed = Math.hypot(pos.x - before.x, pos.z - before.z) / dt;
    p.walk += ((speed > 0.1 ? 1 : 0) - p.walk) * Math.min(1, dt * 8);
    p.speed = speed;
    if (this.needShoeChange(pos.y)) this.setShoes(!this.shoesOn); // 引っ張られて土間に降りたときは、その場で付け外し
  }

  endDrag() {
    if (this.state !== 'dragged') return;
    this.pose.reach = null;
    const pos = this.root.position;
    this.node = this.world.nav.nearest(pos.x, pos.y, pos.z);
    this.state = 'idle';
    this.timer = 2;
    this.startIdle();
  }

  /** 会話中に頭をなでられた */
  reactPat() {
    this.pose.play(this.style.pat, { once: true, fade: 0.25, onDone: () => this.attending && this.pose.play(pick(this.style.idle), { fade: 0.5 }) });
  }

  /** 視線（ray）がこの住人の頭か体に当たるか: 'head' | 'body' | null */
  hitTest(ray) {
    const h = this.vrm.humanoid;
    const head = h.getRawBoneNode('head').getWorldPosition(_h1);
    _h1.y += 0.08; // 頭ボーンは首の付け根。頭の中心へ上げる
    if (ray.distanceSqToPoint(head) < 0.15 ** 2) return 'head';
    const hips = h.getRawBoneNode('hips').getWorldPosition(_h2);
    const neck = h.getRawBoneNode('neck').getWorldPosition(_h3);
    if (ray.distanceSqToSegment(hips, neck) < 0.24 ** 2) return 'body';
    return null;
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
    this.setShoes(n.y < SHOE_Y);
  }

  // ---- 靴
  setShoes(on) {
    this.shoesOn = on;
    for (const m of this.shoes) m.visible = on;
  }

  /** 次に踏む場所（y）で靴を履いているべきか違うなら、立ち止まってしゃがみ、靴を脱ぐ・履く */
  needShoeChange(y) { return this.shoes.length > 0 && (this.shoesOn ? y > SHOE_OFF : y < SHOE_ON); }

  beginShoeChange() {
    this.state = 'shoes';
    this.shoeT = 0;
    this.shoeDone = false;
    const clip = this.pose.clips.squat;
    this.shoeDur = clip ? clip.duration : 2.0;
    this.pose.play('squat', { once: true, fade: 0.3, onDone: () => this.endShoeChange() });
    if (!clip) this.pose.sitKind = 'floor'; // モーションが読めなかったときは手続きで少し屈む
  }

  updateShoeChange(dt) {
    const p = this.pose;
    this.shoeT += dt;
    p.walk = Math.max(0, p.walk - dt * 6);
    if (!p.clips.squat) p.sit = Math.sin(Math.PI * Math.min(1, this.shoeT / this.shoeDur)) * 0.6;
    if (!this.shoeDone && this.shoeT >= this.shoeDur * SHOE_SWAP) { this.shoeDone = true; this.setShoes(!this.shoesOn); }
    if (!p.clips.squat && this.shoeT >= this.shoeDur) this.endShoeChange();
  }

  endShoeChange() {
    if (this.state !== 'shoes') return;
    if (!this.shoeDone) this.setShoes(!this.shoesOn);
    this.pose.sit = 0;
    this.state = 'walk';
    this.pose.play(this.style.walk, { timeScale: this.walkScale, fade: 0.35 });
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
    if (this.mode === 'sleep') return this.go({ bed: true });
    if (this.mode === 'room') return this.go({ seat: this.sched.seat, stay: 'forever' });
    this.step = (this.step + 1) % this.script.length;
    const st = this.script[this.step];
    if (st.wait) {
      this.state = 'idle';
      this.timer = rand(st.wait);
      this.startIdle();
      return;
    }
    this.go(st);
  }

  /** st の場所（席・出発点・布団）まで歩き出す */
  go(st) {
    const { node, seat } = st.bed ? { node: this.bed.node, seat: null } : this.resolve(st);
    const path = this.world.nav.path(this.node, node);
    if (!path) { console.warn(`${this.name}: 経路なし → ${JSON.stringify(st)}`); this.state = 'idle'; this.timer = 1; return; }
    this.path = path;
    this.pi = 1;
    this.seat = seat;
    this.toBed = !!st.bed;
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
    // 呼吸: 歩くと少し速く、寝ているとゆっくり深く
    const asleep = this.state === 'sleeping';
    p.breathRate = asleep ? 0.18 : BREATH.rate + 0.12 * p.walk;
    p.breathDepth = asleep ? 1.4 : 1;
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

    if (this.state === 'dragged') {
      this.updateDrag(dt);
      this.root.rotation.y = this.yaw;
      p.update(dt);
      return;
    }
    if (this.attending && this.state !== 'sitting' && this.state !== 'standing' && this.state !== 'shoes') {
      // 立ち止まって（座っていれば座ったまま）こちらを見る。タイマーも止める
      this.attend(dt, eye);
      this.waitPlayer(dt);
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
        if (this.needShoeChange(t.y)) { this.beginShoeChange(); break; } // 上がり框の手前で履き替える
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
        if (this.toBed) this.beginLie();
        else if (this.seat) this.beginSit();
        else { this.state = 'idle'; this.timer = 0.01; this.nextStep(); }
      }
    } else if (this.state === 'shoes') {
      this.updateShoeChange(dt);
    } else if (this.state === 'sitting' || this.state === 'sit-stay' || this.state === 'standing') {
      this.updateSeat(dt);
    } else if (this.state === 'lying' || this.state === 'sleeping' || this.state === 'waking') {
      this.updateLie(dt);
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
    this.sitHold = this.stay === 'forever' ? Infinity : rand(this.stay || [10, 20]);
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
  constructor(scene, vrms, nav, seats, spawns, clips = {}, collision = null) {
    this.list = [];
    for (const [name, vrm] of Object.entries(vrms)) {
      const r = new Resident(name, vrm, { nav, seats, spawns, collision }, clips[name] || {});
      // 読み込んだ時刻の時間割で置く: 就寝中なら布団の上、自室待機なら自室の席、ほかは道順の最初の場所
      r.mode = r.wantMode(now());
      if (r.mode === 'sleep') r.sleepNow();
      else {
        const first = r.mode === 'room' ? { seat: r.sched.seat } : ROUTES[name].find((s) => s.at || s.seat);
        r.place(r.resolve(first).node);
        r.nextStep();
      }
      scene.add(vrm.scene);
      this.list.push(r);
    }
  }

  /** r と会話を始めた: ほかの住人は通常の動きに戻る */
  focus(r) { for (const q of this.list) { q.suppressed = q !== r; q.focused = q === r; } }
  unfocus() { for (const q of this.list) { q.suppressed = false; q.focused = false; } }

  /** eye = プレイヤーの目の位置。いちばん近い「話せる」住人を返す */
  update(dt, eye, camera) {
    let talk = null;
    const d = now();
    for (const r of this.list) {
      r.checkSchedule(d);
      r.update(dt, eye, camera);
      if (r.talkable && (!talk || r.dist < talk.dist)) talk = r;
    }
    return talk;
  }
}
