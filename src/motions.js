/**
 * 使う VRMA モーション（assets/motions/ 以下）と、住人ごとの使い分け。
 * 'proc' は既存の手続きアニメーション（pose.js）を表す。VRMA と混ぜて使う。
 */
const B = 'assets/motions/Blender';
export const MOTIONS = {
  walk: `${B}/日常モーション/04_歩く/04_歩く_Walk.vrma`,
  walkFemale: `${B}/日常モーション/05_女性歩き/05_女性歩き_Walk_Female.vrma`,
  idleNormal: `${B}/待機モーション/普通の待機/普通の待機_Idle_Hold.vrma`,
  idleFormal: `${B}/待機モーション/かしこまった待機/かしこまった待機_Idle_Hold.vrma`,
  idleGenki: `${B}/待機モーション/元気な興味津々待機/元気な興味津々待機_Idle_Side.vrma`,
  idleFidget: `${B}/待機モーション/そわそわ待機/そわそわ待機_Idle_Look.vrma`,
  idleBangs: `${B}/待機モーション/身だしなみ待機/身だしなみ待機_Idle_Bangs.vrma`,
  sitIdle: `${B}/日常モーション/13_座って待機/13_座って待機_SitIdle.vrma`,
  stretch: `${B}/日常モーション/33_伸び/33_伸び_Stretch.vrma`,
  yawn: `${B}/日常モーション/34_あくび/34_あくび_Yawn.vrma`,
  hairEar: `${B}/日常モーション/35_髪を耳にかける/35_髪を耳にかける_Idle_Ear.vrma`,
  neckRoll: `${B}/日常モーション/38_首と肩を回す/38_首と肩を回す_NeckRoll.vrma`,
  watch: `${B}/日常モーション/39_時計を見る/39_時計を見る_CheckWatch.vrma`,
  bowLight: `${B}/日常モーション/15_お辞儀/15_お辞儀_Bow_Light.vrma`,
  tilt: `${B}/日常モーション/18_首をかしげる/18_首をかしげる_Tilt.vrma`,
  smallWave: `${B}/仕草モーション/G07_小さく手を振る/G07_小さく手を振る_SmallWave.vrma`,
  shy: `${B}/日常モーション/26_照れる/26_照れる_Shy.vrma`,
  angry: `${B}/日常モーション/28_怒る/28_怒る_Angry.vrma`,
};

/**
 * walk: 歩き方（キャラごとに固定）
 * idle: 立ち止まったときの待機。毎回この中から選ぶ
 * gesture: 待機中にときどき入る仕草（1 回再生）
 * greet: 話しかけられたときの 1 回目の反応
 * pat: 会話中に頭をクリックされたときの反応
 * chairIdle: 椅子・ベンチ・スツールに座っている間（床座りは手続きの正座）
 */
export const STYLE = {
  kyokucho: {
    walk: 'walk',
    idle: ['proc', 'idleNormal', 'idleGenki'],
    gesture: ['watch', 'stretch', 'neckRoll'],
    greet: 'tilt',
    pat: 'angry',
    chairIdle: ['sitIdle', 'proc'],
  },
  hachi: {
    walk: 'walkFemale',
    idle: ['proc', 'idleFormal'],
    gesture: ['hairEar', 'watch'],
    greet: 'bowLight',
    pat: 'tilt',
    chairIdle: ['sitIdle'],
  },
  shinkuro: {
    walk: 'proc',
    idle: ['proc', 'idleFidget', 'idleBangs'],
    gesture: ['yawn', 'hairEar', 'stretch'],
    greet: 'smallWave',
    pat: 'shy',
    chairIdle: ['proc', 'sitIdle'],
  },
};
