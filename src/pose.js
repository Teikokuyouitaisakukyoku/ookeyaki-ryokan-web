import * as THREE from 'three';

/**
 * VRM の正規化ヒューマノイド（T ポーズ・全ボーン回転 0 が基準）に手続きで姿勢を付ける。
 * VRM1 は +Z が正面、左腕が +X。
 *   脚・腕を前後に振る = X 軸回転（+ で後ろ）、腕を下ろす = Z 軸回転（左 −、右 +）
 * 状態は weight で連続的に混ぜる: walk（歩行の振り）, sit（座り姿勢）
 */
const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand',
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot',
];

const _e = new THREE.Euler();
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
  constructor(vrm) {
    this.vrm = vrm;
    this.bone = {};
    for (const n of BONES) this.bone[n] = vrm.humanoid.getNormalizedBoneNode(n);
    this.phase = Math.random() * Math.PI * 2;  // 歩行周期
    this.t = Math.random() * 10;                // 呼吸・視線
    this.restHipsY = this.bone.hips.position.y; // 正規化 hips の基準高さ（ルートからの m）
    this.walk = 0;       // 0..1
    this.sit = 0;        // 0..1
    this.sitKind = 'chair';
    this.speed = 0;      // 実際の移動速度(m/s)。歩幅に反映
    this.hipsY = this.restHipsY; // 座っているとき目標とする腰の高さ（ルートからの m）
    this.lookYaw = 0;    // 首・頭で向ける角度（体に対して。+ で左）
    this.lookPitch = 0;  // + で下を向く
  }

  set(name, x, y, z) {
    const b = this.bone[name];
    if (b) b.quaternion.setFromEuler(_e.set(x, y, z, 'XYZ'));
  }

  update(dt) {
    this.t += dt;
    const w = this.walk * (1 - this.sit);
    this.phase += dt * Math.PI * 2 * (this.speed / 1.35) * 0.95 * (this.walk > 0.01 ? 1 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const breath = Math.sin(this.t * 1.6) * 0.012;
    const sit = SIT[this.sitKind];
    const k = this.sit;

    // 立ち（歩行）の基準
    const stand = {
      hips: [0, Math.sin(this.phase) * 0.06 * w, Math.sin(this.phase) * 0.03 * w],
      spine: [0.02 + breath, -s * 0.07 * w, 0],
      chest: [breath, -s * 0.07 * w, 0],
      neck: [this.lookPitch * 0.4, this.lookYaw * 0.4, 0],
      head: [this.lookPitch * 0.6, s * 0.05 * w + this.lookYaw * 0.6, 0],
      leftUpperLeg: [s * 0.55 * w, 0, -0.03],
      rightUpperLeg: [-s * 0.55 * w, 0, 0.03],
      leftLowerLeg: [Math.max(0, -c) * 0.7 * w + (s > 0 ? 0 : 0), 0, 0],
      rightLowerLeg: [Math.max(0, c) * 0.7 * w, 0, 0],
      leftFoot: [0, 0, 0], rightFoot: [0, 0, 0],
      leftUpperArm: [-s * 0.45 * w, 0, -1.2],
      rightUpperArm: [s * 0.45 * w, 0, 1.2],
      leftLowerArm: [0, -0.25 - 0.2 * w * Math.max(0, s), 0],
      rightLowerArm: [0, 0.25 + 0.2 * w * Math.max(0, -s), 0],
      leftHand: [0, 0, 0], rightHand: [0, 0, 0],
    };
    for (const n of BONES) {
      const a = stand[n] || [0, 0, 0];
      const b = sit[n];
      if (b && k > 0) this.set(n, lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
      else this.set(n, a[0], a[1], a[2]);
    }
    // 腰の高さ: 立ちでは基準 + 歩行の上下動、座りでは座面に合わせた高さへ
    const standY = this.restHipsY - Math.abs(c) * 0.025 * w;
    this.bone.hips.position.y = lerp(standY, this.hipsY, k);
    this.vrm.update(dt);
  }
}
