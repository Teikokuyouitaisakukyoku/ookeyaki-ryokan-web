import * as THREE from 'three';

/**
 * 住人へのタッチ。部位はキャラ自身から見た左右（右胸 = キャラの右側）。
 *   通常モード: 手のカーソル（V）でクリック。VR モード: 空間の手で触れる。
 *   手・腕はつかんだまま動かすと引っ張れる（通常モード: マウスを押したまま、VR: グリップ）。
 *
 * line: 触れられたときのせりふ / motion: そのときの動き（motions.js の名前、立っているときだけ）
 * pull: 引っ張られ始めたとき / wake: 寝ているところを触られたとき
 * 文面はキャラ設定（teikoku-youitan-workspace）に沿う。自由に書き換えてよい
 */
export const TOUCH = {
  kyokucho: {
    head: { line: 'なにすんのよ！ セクハラよ！ セクハラ！', motion: 'angry' },
    chestR: { line: 'あんたねぇ！ どこ触ってんのよ！', motion: 'angry' },
    chestL: { line: 'あんたねぇ！ どこ触ってんのよ！', motion: 'angry' },
    belly: { line: 'ちょっと！ おなかはやめなさいよ！', motion: 'pout' },
    legR: { line: 'なによ、足元に何かいるの？ ……ナメクジじゃないでしょうね！？', motion: 'surprise' },
    legL: { line: 'なによ、足元に何かいるの？ ……ナメクジじゃないでしょうね！？', motion: 'surprise' },
    armR: { line: 'なによ、用事？', motion: 'tilt' },
    armL: { line: 'なによ、用事？', motion: 'tilt' },
    handR: { line: 'なに手なんか握ってんのよ。……ま、まあいいけど', motion: 'shy' },
    handL: { line: 'なに手なんか握ってんのよ。……ま、まあいいけど', motion: 'shy' },
    pull: { line: 'ちょ、ちょっと！ どこ連れてく気よ！' },
    wake: { line: 'ん……なによ、こんな夜中に……' },
  },
  hachi: {
    head: { line: 'えっと……どうも、ありがとうございます？', motion: 'tilt' },
    chestR: { line: '……それは秘書の業務範囲外でございます', motion: 'pout' },
    chestL: { line: '……それは秘書の業務範囲外でございます', motion: 'pout' },
    belly: { line: '体重に関するお問い合わせは、検閲対象でございます', motion: 'pout' },
    legR: { line: '足元にお気をつけくださいませ', motion: 'bowLight' },
    legL: { line: '足元にお気をつけくださいませ', motion: 'bowLight' },
    armR: { line: 'はい、なんでございましょう？', motion: 'tilt' },
    armL: { line: 'はい、なんでございましょう？', motion: 'tilt' },
    handR: { line: 'まあ……。女性として扱っていただけるのは、嬉しいものでございますね', motion: 'shy' },
    handL: { line: 'まあ……。女性として扱っていただけるのは、嬉しいものでございますね', motion: 'shy' },
    pull: { line: 'どちらへご案内いたしましょう？' },
    wake: { line: 'はい、なにかご用でしょうか？' },
  },
  shinkuro: {
    head: { line: 'えへへ、くすぐったいですん……', motion: 'shy' },
    chestR: { line: 'ぴゃっ！？ な、なにするですん！', motion: 'surprise' },
    chestL: { line: 'ぴゃっ！？ な、なにするですん！', motion: 'surprise' },
    belly: { line: 'くすぐったいですん～！ 晩ごはんが入らなくなるですん！', motion: 'laugh' },
    legR: { line: 'わわっ、転んじゃうですん！', motion: 'surprise' },
    legL: { line: 'わわっ、転んじゃうですん！', motion: 'surprise' },
    armR: { line: 'どうかしたですかん？', motion: 'tilt' },
    armL: { line: 'どうかしたですかん？', motion: 'tilt' },
    handR: { line: 'えへへ、手つなぎですん！', motion: 'shy' },
    handL: { line: 'えへへ、手つなぎですん！', motion: 'shy' },
    pull: { line: 'わわっ、どこ行くですかん！？ 美味しいものですかん！？' },
    wake: { line: 'ふぁ……もう朝ですかん……？' },
  },
};

/** つかんで引っ張れる部位と、そのときに伸ばす腕 */
export const GRAB = { handR: 'right', handL: 'left', armR: 'right', armL: 'left' };

const v = () => new THREE.Vector3();
const _a = v(), _b = v(), _c = v(), _f = v(), _s = v(), _p = v(), _q = new THREE.Quaternion();

/**
 * 住人の体を、部位ごとの球・カプセルで近似する（ボーンの今の位置から毎回作る）。
 * 返す形: [{ part, a, b, r }]（a = b なら球）
 */
export function bodyShapes(vrm) {
  const h = vrm.humanoid;
  const pos = (name, out) => h.getNormalizedBoneNode(name)?.getWorldPosition(out);
  const out = [];
  const add = (part, a, b, r) => out.push({ part, a: a.clone(), b: b.clone(), r });
  // 胸の向き（正規化ボーンは +Z が前、+X がキャラの左）
  const chestNode = h.getNormalizedBoneNode('upperChest') || h.getNormalizedBoneNode('chest');
  chestNode.getWorldQuaternion(_q);
  _f.set(0, 0, 1).applyQuaternion(_q);
  _s.set(1, 0, 0).applyQuaternion(_q);
  const head = pos('head', _a).addScaledVector(_s.clone().cross(_f), -0.08); // 頭ボーンは首の付け根。上へ
  add('head', head, head, 0.13);
  const chest = pos('upperChest', _b) || pos('chest', _b);
  _c.copy(chest).addScaledVector(_f, 0.09);
  add('chestL', _p.copy(_c).addScaledVector(_s, 0.075), _p, 0.075);
  add('chestR', _p.copy(_c).addScaledVector(_s, -0.075), _p, 0.075);
  pos('spine', _a).addScaledVector(_f, 0.07);
  add('belly', _a, _a, 0.11);
  for (const [side, key] of [['left', 'L'], ['right', 'R']]) {
    add(`leg${key}`, pos(`${side}UpperLeg`, _a), pos(`${side}LowerLeg`, _b), 0.08);
    add(`leg${key}`, _b, pos(`${side}Foot`, _c), 0.07);
    add(`arm${key}`, pos(`${side}UpperArm`, _a), pos(`${side}LowerArm`, _b), 0.055);
    add(`arm${key}`, _b, pos(`${side}Hand`, _c), 0.05);
    // 手のひら: 手首から指先側へ少し
    _p.copy(_c).sub(_b).normalize().multiplyScalar(0.06).add(_c);
    add(`hand${key}`, _p, _p, 0.065);
  }
  return out;
}

/**
 * 視線（ray）が当たる部位: { part, t }（t = 当たった距離）。maxT より遠いものは無視。
 * 部位どうしが近い（胸と腕など）ので、手前のものではなく、視線がいちばん中心近くを通る部位を選ぶ
 */
export function pickRay(vrm, ray, maxT) {
  let best = null;
  for (const s of bodyShapes(vrm)) {
    const onRay = v();
    // 視線が中心線をちょうど通ると、丸め誤差でわずかに負になる（そのままだと平方根が NaN になる）
    const d2 = Math.max(0, s.a.equals(s.b) ? ray.distanceSqToPoint(s.a) : ray.distanceSqToSegment(s.a, s.b, onRay));
    if (d2 > s.r * s.r) continue;
    if (s.a.equals(s.b)) ray.closestPointToPoint(s.a, onRay);
    const t = onRay.distanceTo(ray.origin) - Math.sqrt(s.r * s.r - d2);
    if (t > maxT || t < 0) continue;
    const off = Math.sqrt(d2) / s.r; // 0 = 中心を通る、1 = 縁をかすめる
    if (!best || off < best.off) best = { part: s.part, t, off };
  }
  return best;
}

/** 点（VR の手）が触れている部位: { part, depth } か null。margin だけ外側まで触れたことにする */
export function pickPoint(vrm, point, margin = 0.03) {
  let best = null;
  const line = new THREE.Line3();
  for (const s of bodyShapes(vrm)) {
    line.set(s.a, s.b);
    const d = (s.a.equals(s.b) ? point.distanceTo(s.a) : point.distanceTo(line.closestPointToPoint(point, true, _p))) - s.r;
    if (d > margin) continue;
    if (!best || d < best.depth) best = { part: s.part, depth: d };
  }
  return best;
}
