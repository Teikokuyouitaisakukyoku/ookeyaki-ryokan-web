import { MOMENTS } from './story.js';
import { sunTimes } from './sky.js';

/**
 * 住人の時間割（プレイヤーのパソコンの時計で動く）。ここに書いた時間帯以外は routes.js の道順どおり。
 *   sleep: 自室の布団で寝る（プレイヤーが近づくと起きて、その夜は普段の行動に戻る）
 *   room:  自室の席で待機する
 * 開発・確認用: URL に ?time=23:30 を付けると、その時刻から時計が進む。
 */
export const SCHEDULE = {
  kyokucho: { mode: 'sleep', from: 23, to: 5, bed: 'kyokucho' },
  shinkuro: { mode: 'sleep', from: 23, to: 5, bed: 'shinkuro' },
  hachi: { mode: 'room', from: 1, to: 4, seat: 'Seat_Room206_03' },
};

/**
 * 布団。center = 布団の中心（上面の高さ）、head = 枕の向き（単位ベクトル xz）。
 * 202 は舞台の布団。201 は夜だけ 202 の布団を複製して敷く（stage-edits.js）。
 */
export const BEDS = {
  shinkuro: { center: [-4.425, 3.59, -3.775], head: [0, -1] },
  kyokucho: { center: [-7.45, 3.59, -3.775], head: [0, -1] },
};

let offset = 0;
/** 時計をこの時刻に合わせる（以後はふつうに進む）。開発・確認用 */
export function setTime(h, m = 0) {
  const t = new Date();
  t.setHours(h, m, 0, 0);
  offset = t - Date.now();
}
const fixed = new URLSearchParams(location.search).get('time')?.match(/^(\d{1,2}):(\d{2})$/);
if (fixed) setTime(+fixed[1], +fixed[2]);

export function now() { return new Date(Date.now() + offset); }

/** 時刻が from 時〜to 時（日付をまたいでもよい）の中か */
export function inHours(d, from, to) {
  const h = d.getHours() + d.getMinutes() / 60;
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** 夜の識別子（正午で日付を切り替える）。起こされた夜を覚えるのに使う */
export function nightOf(d) {
  const t = new Date(d.getTime() - 12 * 3600e3);
  return `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
}

/**
 * 館にいるのは同時に 3 人まで（読み込みとメモリを 3 人分に抑える）。残りのひとりは出かけていて、玄関から出入りする。
 *   夜（23〜5 時）: 市目瞭子が自室（203）にこもる（舞台には出ない）。ほかの 3 人は時間割どおり寝る・待機する
 *   昼（5〜23 時）: 2 時間ごとに OUT_ORDER の順でひとりずつ出かける（日によって順番がずれる）
 */
export const ROSTER = ['kyokucho', 'hachi', 'shinkuro', 'ichimokuryouko'];
export const MAX_PRESENT = 3;
const OUT_ORDER = ['ichimokuryouko', 'shinkuro', 'hachi', 'kyokucho'];

/** 時刻 d に出かけている住人 */
export function awayAt(d) {
  if (inHours(d, 23, 5)) return 'ichimokuryouko';
  const block = Math.floor((d.getHours() - 5) / 2);
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
  return OUT_ORDER[(block + day) % OUT_ORDER.length];
}

/** 時刻 d に name が見せる「時間帯限定のできごと」（story.js の MOMENTS）。なければ undefined */
export function momentAt(name, d) {
  const h = d.getHours() + d.getMinutes() / 60;
  return MOMENTS.find((m) => {
    if (m.who !== name || m.wake || (m.days && !m.days.includes(d.getDay()))) return false;
    const [from, to] = m.sunset ? m.sunset.map((o) => sunTimes(d).set + o) : [m.from, m.to];
    return h >= from && h < to;
  });
}
