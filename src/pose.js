import * as THREE from 'three';
import { VRMHumanBoneList } from '@pixiv/three-vrm';

/**
 * VRM の正規化ヒューマノイド（T ポーズ・全ボーン回転 0 が基準）に手続きで姿勢を付ける。
 * VRM1 は +Z が正面、左腕が +X。
 *   脚・腕を前後に振る = X 軸回転（+ で後ろ）、腕を下ろす = Z 軸回転（左 −、右 +）
 * 状態は weight で連続的に混ぜる: walk（歩行の振り）, sit（座り姿勢）
 *
 * VRMA（AnimationMixer）と手続きアニメーションはボーンごとに slerp で混ぜる。
 *   play('名前') で VRMA へ、play(null) で手続きへ、fade 秒かけて移る。
 * 首・頭の向き（lookYaw / lookPitch）は最後に上乗せするので、どちらの上でもこちらを向ける。
 */
const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
];

const _e = new THREE.Euler();
// 呼吸の大きさ（rad）と、普段の速さ（回/秒 = 4 秒に 1 回）
export const BREATH = { chest: 0.012, shoulder: 0.018, rate: 0.25 };
const lerp = (a, b, t) => a + (b - a) * t;

// 座り姿勢（椅子 / 床）。各ボーンの [x, y, z] オイラー角（rad）
const SIT = {
  chair: {
    hipsDrop: 0.0, // 腰の高さは NPC 側で座面に合わせる
    leftUpperLeg: [-1.5, 0.05, -0.05], rightUpperLeg: [-1.5, -0.05, 0.05],
    leftLowerLeg: [1.5, 0, 0], rightLowerLeg: [1.5, 0, 0],
    leftFoot: [0.1, 0, 0], rightFoot: [0.1, 0, 0],
    spine: [0.05, 0, 0], chest: [0.03, 0, 0],
    leftUpperArm: [-0.35, 0, -1.15], rightUpperArm: [-0.35, 0, 1.15],
    leftLowerArm: [0, -0.9, 0], rightLowerArm: [0, 0.9, 0],
  },
  floor: { // 正座
    leftUpperLeg: [-1.45, 0.08, -0.12], rightUpperLeg: [-1.45, -0.08, 0.12],
    leftLowerLeg: [2.55, 0, 0], rightLowerLeg: [2.55, 0, 0],
    leftFoot: [0.55, 0, 0], rightFoot: [0.55, 0, 0],
    spine: [0.03, 0, 0], chest: [0.02, 0, 0],
    leftUpperArm: [-0.3, 0, -1.2], rightUpperArm: [-0.3, 0, 1.2],
    leftLowerArm: [0, -0.8, 0], rightLowerArm: [0, 0.8, 0],
  },
};

export class Pose {
  constructor(vrm, clips = {}) {
    this.vrm = vrm;
    this.bone = {};
    for (const n of BONES) this.bone[n] = vrm.humanoid.getNormalizedBoneNode(n);
    this.allBones = VRMHumanBoneList.map((n) => vrm.humanoid.getNormalizedBoneNode(n)).filter(Boolean);
    this.phase = Math.random() * Math.PI * 2;  // 歩行周期
    this.t = Math.random() * 10;
    // 呼吸（どの動きにも上乗せする基本動作）。周期はキャラごとにずらす
    this.breathPhase = Math.random() * Math.PI * 2;
    this.breathRate = BREATH.rate;  // 回/秒。NPC 側で歩行・就寝に合わせて変える
    this.breathDepth = 1;
    // 自動まばたき: 次のまばたきまでの秒数（個体ごとにずらす）
    this.blinkT = 2 + Math.random() * 4;
    this.blinkOut = 0;  // 前のフレームに自分が書いた blink の値
    this.blinkHold = 0; // npc.js が指定した blink（就寝中の 1 など）。これより開けない
    this.upperChest = vrm.humanoid.getNormalizedBoneNode('upperChest');
    this.shoulderL = vrm.humanoid.getNormalizedBoneNode('leftShoulder');
    this.shoulderR = vrm.humanoid.getNormalizedBoneNode('rightShoulder');
    this.restHips = this.bone.hips.position.clone(); // 正規化 hips の基準位置（ルートからの m）
    this.restHipsY = this.restHips.y;
    this.walk = 0;       // 0..1
    this.sit = 0;        // 0..1
    this.sitKind = 'chair';
    this.speed = 0;      // 実際の移動速度(m/s)。歩幅に反映
    this.hipsY = this.restHipsY; // 座っているとき目標とする腰の高さ（ルートからの m）
    this.lookYaw = 0;    // 首・頭で向ける角度（体に対して。+ で左）
    this.lookPitch = 0;  // + で下を向く
    this.reach = null;   // 'left' | 'right': 引っ張られて、その腕を前へ伸ばす
    this.reachW = 0;

    // VRMA
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    this.action = null;
    this.current = null;     // 再生中の VRMA 名（null = 手続き）
    this.procWeight = 1;     // 手続きの割合
    this.fadeTime = 0.4;
    this.onDone = null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.action && this.onDone) { const f = this.onDone; this.onDone = null; f(); }
    });
    this._q = new THREE.Quaternion();
    this._proc = {};
    for (const n of BONES) this._proc[n] = new THREE.Quaternion();
  }

  has(name) { return name === 'proc' || !!this.clips[name]; }

  /** name: VRMA 名、'proc' または null で手続き。once なら 1 回再生して onDone を呼ぶ */
  play(name, { once = false, fade = 0.4, timeScale = 1, onDone = null } = {}) {
    if (name === 'proc') name = null;
    if (name && !this.clips[name]) name = null; // 読めなかったものは手続きで代用
    this.onDone = onDone;
    this.fadeTime = fade;
    if (name === this.current && !once) { if (this.action) this.action.timeScale = timeScale; return; }
    const prev = this.action;
    if (name) {
      const a = this.mixer.clipAction(this.clips[name]);
      a.reset();
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = once;
      a.timeScale = timeScale;
      a.fadeIn(fade).play();
      this.action = a;
    } else {
      this.action = null;
      if (onDone) { this.onDone = null; onDone(); }
    }
    if (prev && prev !== this.action) prev.fadeOut(fade);
    this.current = name;
  }

  /**
   * VRMA の歩きの再生速度倍率。足の前後の振れ幅と周期から歩く速さを出し、speed(m/s) に合わせる。
   * 支持脚は 1 周期の半分で振れ幅ぶん後ろへ動く → 速さ ≒ 振れ幅 × 2 × 周期数 / 長さ
   */
  walkTimeScale(name, speed) {
    const clip = this.clips[name];
    if (!clip) return 1;
    const a = this.mixer.clipAction(clip);
    a.reset().play();
    const foot = this.vrm.humanoid.getNormalizedBoneNode('leftFoot');
    const v = new THREE.Vector3();
    const zs = [];
    const N = 120;
    for (let i = 0; i <= N; i++) {
      for (const b of this.allBones) b.quaternion.identity();
      this.bone.hips.position.copy(this.restHips);
      this.mixer.setTime((clip.duration * i) / N);
      this.bone.hips.position.x = this.restHips.x;
      this.bone.hips.position.z = this.restHips.z;
      this.vrm.scene.updateMatrixWorld(true);
      zs.push(foot.getWorldPosition(v).z - this.vrm.scene.position.z);
    }
    a.stop();
    for (const b of this.allBones) b.quaternion.identity();
    this.bone.hips.position.copy(this.restHips);
    const min = Math.min(...zs), max = Math.max(...zs), mean = (min + max) / 2;
    let cycles = 0;
    for (let i = 1; i < zs.length; i++) if (zs[i - 1] < mean && zs[i] >= mean) cycles++;
    const clipSpeed = ((max - min) * 2 * Math.max(1, cycles)) / clip.duration;
    return THREE.MathUtils.clamp(speed / clipSpeed, 0.5, 2);
  }

  /** 手続きの姿勢を this._proc に計算する（ボーンにはまだ書かない） */
  procedural(dt) {
    const w = this.walk * (1 - this.sit);
    this.phase += dt * Math.PI * 2 * (this.speed / 1.35) * 0.95 * (this.walk > 0.01 ? 1 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const sit = SIT[this.sitKind];
    const k = this.sit;
    const stand = {
      hips: [0, Math.sin(this.phase) * 0.06 * w, Math.sin(this.phase) * 0.03 * w],
      spine: [0.02, -s * 0.07 * w, 0],
      chest: [0, -s * 0.07 * w, 0],
      neck: [0, 0, 0], head: [0, s * 0.05 * w, 0],
      leftUpperLeg: [s * 0.55 * w, 0, -0.03],
      rightUpperLeg: [-s * 0.55 * w, 0, 0.03],
      leftLowerLeg: [Math.max(0, -c) * 0.7 * w, 0, 0],
      rightLowerLeg: [Math.max(0, c) * 0.7 * w, 0, 0],
      leftFoot: [0, 0, 0], rightFoot: [0, 0, 0],
      leftUpperArm: [-s * 0.45 * w, 0, -1.2],
      rightUpperArm: [s * 0.45 * w, 0, 1.2],
      leftLowerArm: [0, -0.25 - 0.2 * w * Math.max(0, s), 0],
      rightLowerArm: [0, 0.25 + 0.2 * w * Math.max(0, -s), 0],
      leftHand: [0, 0, 0], rightHand: [0, 0, 0],
    };
    // 引っ張られている腕を前へ伸ばす（+X が左腕。Y 回転で前へ向ける）
    this.reachW += ((this.reach ? 1 : 0) - this.reachW) * Math.min(1, dt * 8);
    if (this.reachW > 0.01) {
      const k2 = this.reachW, side = this.reach || this._lastReach;
      if (side === 'left') { stand.leftUpperArm = [0, -1.4 * k2, -1.2 * (1 - k2) - 0.15 * k2]; stand.leftLowerArm = [0, -0.25 * (1 - k2), 0]; }
      else { stand.rightUpperArm = [0, 1.4 * k2, 1.2 * (1 - k2) + 0.15 * k2]; stand.rightLowerArm = [0, 0.25 * (1 - k2), 0]; }
    }
    if (this.reach) this._lastReach = this.reach;
    for (const n of BONES) {
      const a = stand[n] || [0, 0, 0];
      const b = sit[n];
      const e = b && k > 0
        ? _e.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), 'XYZ')
        : _e.set(a[0], a[1], a[2], 'XYZ');
      this._proc[n].setFromEuler(e);
    }
    return this.restHipsY - Math.abs(c) * 0.025 * w; // 立ちの腰の高さ
  }

  update(dt) {
    this.t += dt;
    const standY = this.procedural(dt);

    // 手続き ⇔ VRMA の割合を fade 秒で移す
    const target = this.current ? 0 : 1;
    const step = dt / Math.max(0.05, this.fadeTime);
    this.procWeight += Math.max(-step, Math.min(step, target - this.procWeight));

    // VRMA: 毎フレーム基準姿勢に戻してから mixer に書かせる（止めた動きのボーンが残らないように）
    for (const b of this.allBones) b.quaternion.identity();
    this.bone.hips.position.copy(this.restHips);
    // まばたき: 前のフレームから値が変わっていれば npc.js が指定した（就寝など）。0 に戻してから mixer に書かせ、
    // VRMA に入っているまばたきの値だけを取り出す（入っていない動きなら 0 のまま）
    const em = this.vrm.expressionManager;
    if (em) {
      const cur = em.getValue('blink') ?? 0;
      if (cur !== this.blinkOut) this.blinkHold = cur;
      em.setValue('blink', 0);
    }
    this.mixer.update(dt);
    const clipY = this.bone.hips.position.y;

    const pw = this.procWeight;
    for (const n of BONES) {
      const b = this.bone[n];
      if (!b) continue;
      if (pw >= 1) b.quaternion.copy(this._proc[n]);
      else if (pw > 0) b.quaternion.slerp(this._proc[n], pw);
    }

    // 腰: 前後左右の移動は捨てる（位置は NPC 側で動かす）。高さは立ち＝混ぜる、座り＝座面に合わせる
    const hips = this.bone.hips.position;
    hips.x = this.restHips.x;
    hips.z = this.restHips.z;
    const upY = lerp(clipY, standY, pw);
    hips.y = lerp(upY, this.hipsY, this.sit);

    // 呼吸（上乗せ）: 吸うと胸がわずかに反り、肩が少し上がる
    this.breathPhase += dt * Math.PI * 2 * this.breathRate;
    const inhale = (1 - Math.cos(this.breathPhase)) / 2 * this.breathDepth; // 0（吐き切り）〜1（吸い切り）
    const lift = -inhale * BREATH.chest; // X 回転の − で上体が後ろへ反る
    this.bone.spine?.quaternion.multiply(this._q.setFromEuler(_e.set(lift * 0.4, 0, 0, 'XYZ')));
    this.bone.chest?.quaternion.multiply(this._q.setFromEuler(_e.set(lift * 0.6, 0, 0, 'XYZ')));
    this.upperChest?.quaternion.multiply(this._q.setFromEuler(_e.set(lift * 0.5, 0, 0, 'XYZ')));
    // 肩: 左は +X 向きなので Z 回転の + で上がる（右は逆）
    this.shoulderL?.quaternion.multiply(this._q.setFromEuler(_e.set(0, 0, inhale * BREATH.shoulder, 'XYZ')));
    this.shoulderR?.quaternion.multiply(this._q.setFromEuler(_e.set(0, 0, -inhale * BREATH.shoulder, 'XYZ')));

    // こちらを見る（上乗せ）
    if (this.lookYaw || this.lookPitch) {
      this.bone.neck?.quaternion.multiply(this._q.setFromEuler(_e.set(this.lookPitch * 0.4, this.lookYaw * 0.4, 0, 'XYZ')));
      this.bone.head?.quaternion.multiply(this._q.setFromEuler(_e.set(this.lookPitch * 0.6, this.lookYaw * 0.6, 0, 'XYZ')));
    }
    // 自動まばたき: 2〜6 秒おきに 0.15 秒で閉じて開く。VRMA のまばたき・就寝中の指定とは大きいほうを使う
    if (em) {
      this.blinkT -= dt;
      const b = this.blinkT < 0 ? Math.sin(Math.min(1, -this.blinkT / 0.15) * Math.PI) : 0;
      if (this.blinkT < -0.15) this.blinkT = 2 + Math.random() * 4;
      this.blinkOut = Math.max(b, em.getValue('blink') ?? 0, this.blinkHold);
      em.setValue('blink', this.blinkOut);
    }
    this.vrm.update(dt);
  }
}
