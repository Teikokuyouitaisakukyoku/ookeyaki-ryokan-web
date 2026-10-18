/**
 * 舞台への小さな手直し（当たり判定を作る前に当てる）。
 * 住人の自室の入口の襖を開けた状態にする: 2 枚重ねの襖を戸袋側（+x）へ 1 枚分ずらす。
 * 歩行グラフ（nav.json）もこの状態で作るので、変えたら npm run build-nav し直す。
 */
const OPEN_FUSUMA = [
  { names: ['H2_Fusuma_37', 'H2_Fusuma_38'], dx: 0.6 }, // 201 局長
  { names: ['H2_Fusuma_46', 'H2_Fusuma_47'], dx: 0.6 }, // 202 不破寺真九郎
  { names: ['H2_Fusuma_82', 'H2_Fusuma_83'], dx: 0.6 }, // 206 Hachi
];

export function applyStageEdits(stage) {
  for (const { names, dx } of OPEN_FUSUMA) {
    for (const n of names) {
      const o = stage.getObjectByName(n);
      if (o) o.position.x += dx;
      else console.warn(`stage-edits: ${n} が見つからない`);
    }
  }
  stage.updateMatrixWorld(true);
}

/**
 * 夜（23〜5 時）の局長の部屋（201）: 座卓まわりを片付けて布団を敷く。
 * 布団は 202 の布団を複製する。片付けた家具は当たり判定からも外す。
 */
export function setupNightProps(stage, collision) {
  const src = stage.getObjectByName('H2_Room202_Futon_455');
  const futon = src.clone();
  futon.position.x += -7.45 - -4.425; // 202 の布団と同じ位置を 201 へ
  futon.visible = false;
  stage.add(futon);
  futon.updateMatrixWorld(true);
  const stash = ['H2_Room201_Zataku_441', 'H2_Room201_Zaisu_442', 'H2_Room201_Zabuton_444', 'H2_Room201_Cup_448']
    .map((n) => stage.getObjectByName(n)).filter(Boolean);
  const meshes = [];
  for (const o of stash) o.traverse((m) => { if (m.isMesh) meshes.push(m); });
  let night = null;
  const setNight = (isNight) => {
    if (isNight === night) return;
    night = isNight;
    futon.visible = isNight;
    for (const o of stash) o.visible = !isNight;
    collision.setActive(meshes, !isNight);
  };
  setNight.objects = [futon, ...stash]; // 表示を切り替える部品（描画をまとめない）
  return setNight;
}
