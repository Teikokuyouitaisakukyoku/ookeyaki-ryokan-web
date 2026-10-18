import * as THREE from 'three';

/**
 * 空の明るさと色調（プレイヤーのパソコンの時計で動く。?time=HH:MM でも確認できる）。
 * 日の出・日の入りは季節で動かす（東京のおおよその時刻: 夏至 4:25 / 19:00、冬至 6:50 / 16:30）。
 *
 * 各時刻の見え方。at = 日の出（rise）・日の入り（set）からの時間（時）、sky = 背景、
 * hemi = 空の光 [空側の色, 地面側の色, 強さ]、sun = 日光（夜は月明かり）[色, 強さ]
 */
// 館内の灯り: 夕方から点いて、消灯（23 時）で消える。消えたあとは月明かりだけの暗さ
const LAMP = { color: 0xffe2b8, intensity: 0.9, on: -0.6, fadeIn: 1.5, off: 23, fadeOut: 0.25 }; // on: 日の入りからの時間（時）
const KEYS = [
  { from: 'rise', at: -1.2, sky: 0x0d1628, hemi: [0x46557a, 0x1f1d26, 0.6], sun: [0x9fb4e0, 0.35] }, // 夜
  { from: 'rise', at: -0.4, sky: 0x3a4466, hemi: [0x7a7fa0, 0x3a3440, 0.8], sun: [0xc0a8c8, 0.5] }, // 明け方
  { from: 'rise', at: 0.3, sky: 0xe9b48e, hemi: [0xe6c4aa, 0x7a6658, 1.05], sun: [0xffb878, 1.3] }, // 朝焼け
  { from: 'rise', at: 2, sky: 0xa9c6dc, hemi: [0xe4eef7, 0xd8cdb8, 1.4], sun: [0xffeeda, 2.1] }, // 朝
  { from: 'set', at: -2.5, sky: 0xa9c6dc, hemi: [0xe4eef7, 0xd8cdb8, 1.5], sun: [0xfff1dc, 2.2] }, // 昼
  { from: 'set', at: -0.6, sky: 0xd9b48c, hemi: [0xe6cdb0, 0x8a7460, 1.2], sun: [0xffc890, 1.7] }, // 夕方
  { from: 'set', at: 0.1, sky: 0xd97a52, hemi: [0xd8a088, 0x5a4840, 0.95], sun: [0xff9058, 1.2] }, // 夕焼け
  { from: 'set', at: 0.8, sky: 0x3c3e66, hemi: [0x6c6c98, 0x2c2832, 0.7], sun: [0x8890c0, 0.45] }, // 宵
  { from: 'set', at: 1.6, sky: 0x0d1628, hemi: [0x46557a, 0x1f1d26, 0.6], sun: [0x9fb4e0, 0.35] }, // 夜
];

/** その日の日の出・日の入り（時） */
export function sunTimes(d) {
  const day = (d - new Date(d.getFullYear(), 0, 0)) / 864e5;
  const c = Math.cos((2 * Math.PI * (day - 172)) / 365); // 夏至で 1、冬至で -1
  return { rise: 5.6 - 1.2 * c, set: 17.75 + 1.25 * c };
}

const _a = new THREE.Color(), _b = new THREE.Color();
const mix = (out, x, y, t) => out.copy(_a.setHex(x)).lerp(_b.setHex(y), t);

export class Sky {
  constructor(scene, hemi, sun, lamp) {
    Object.assign(this, { scene, hemi, sun, lamp });
    lamp.color.setHex(LAMP.color);
    this.center = sun.target.position.clone();
    this.dist = sun.position.distanceTo(this.center);
  }

  update(d) {
    const { rise, set } = sunTimes(d);
    const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    const keys = KEYS.map((k) => ({ ...k, h: (k.from === 'rise' ? rise : set) + k.at }));
    // h を挟む 2 つの見え方を探す（最後の夜から翌朝の夜明け前までは夜のまま）
    let i = keys.findIndex((k) => k.h > h);
    let t = 0, a, b;
    if (i <= 0) { a = b = keys[i === 0 ? 0 : keys.length - 1]; }
    else { a = keys[i - 1]; b = keys[i]; t = (h - a.h) / (b.h - a.h); }
    t = t * t * (3 - 2 * t); // なめらかに

    mix(this.scene.background, a.sky, b.sky, t);
    mix(this.hemi.color, a.hemi[0], b.hemi[0], t);
    mix(this.hemi.groundColor, a.hemi[1], b.hemi[1], t);
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemi[2], b.hemi[2], t);
    mix(this.sun.color, a.sun[0], b.sun[0], t);
    this.sun.intensity = THREE.MathUtils.lerp(a.sun[1], b.sun[1], t);
    const lit = Math.min((h - set - LAMP.on) / LAMP.fadeIn, (LAMP.off - h) / LAMP.fadeOut);
    this.lamp.intensity = LAMP.intensity * THREE.MathUtils.smoothstep(lit, 0, 1);

    // 日光の向き: 日の出に東の低い位置、正午ごろ高く、日の入りに西の低い位置。夜は月として高めに置く
    const day = THREE.MathUtils.clamp((h - rise) / (set - rise), 0, 1);
    const night = h < rise - 0.5 || h > set + 0.5;
    const elev = night ? 0.9 : 0.15 + Math.sin(day * Math.PI) * 0.95;
    const az = night ? 2.4 : Math.PI * day; // 東（+x）から南（+z、これまでの日光の側）を通って西（-x）へ
    this.sun.position.set(
      this.center.x + Math.cos(az) * Math.cos(elev) * this.dist,
      this.center.y + Math.sin(elev) * this.dist,
      this.center.z + Math.sin(az) * Math.cos(elev) * this.dist,
    );
  }
}
