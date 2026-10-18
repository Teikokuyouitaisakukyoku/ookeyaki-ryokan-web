/**
 * 住人の道順。上から順に実行して、最後まで行ったら先頭へ戻る。
 *   { at: '出発点の名前' }              spawns.json の地点まで歩く
 *   { seat: 'Seat_...', stay: [最小秒, 最大秒] }  seats.json の席まで歩いて座る
 *   { wait: [最小秒, 最大秒] }          その場で立ち止まる
 */
export const ROUTES = {
  kyokucho: [
    { seat: 'Seat_Office_01', stay: [15, 25] },
    { wait: [2, 4] },
    { at: '玄関土間' },
    { wait: [2, 4] },
    { at: '玄関前（坂道）' }, // 玄関先で外の様子を見る
    { wait: [4, 7] },
    { at: '中庭' },
    { wait: [5, 8] },
    { seat: 'Seat_Hiroma_03', stay: [20, 30] },
    { at: '縁側' },
    { wait: [4, 7] },
  ],
  hachi: [
    { seat: 'Seat_Counter_01', stay: [15, 25] },
    { at: '広間' },
    { wait: [3, 5] },
    { at: '中庭' }, // 庭の手入れ
    { wait: [6, 10] },
    { seat: 'Seat_Lobby_01', stay: [10, 20] },
    { at: '玄関土間' },
    { wait: [2, 4] },
    { at: '玄関前（坂道）' }, // 玄関先の掃除
    { wait: [6, 10] },
  ],
  shinkuro: [
    { seat: 'Seat_Ima_01', stay: [20, 30] },
    { at: '縁側' },
    { wait: [3, 6] },
    { at: '中庭' },
    { wait: [5, 8] },
    { at: '玄関前（坂道）' },
    { wait: [4, 7] },
    { seat: 'Seat_Hiroma_08', stay: [15, 25] },
    { at: '広間' },
    { wait: [3, 5] },
  ],
  ichimokuryouko: [
    { seat: 'Seat_Room203_01', stay: [25, 40] }, // 自室（203）の PC
    { at: '2階 廊下' },
    { wait: [2, 4] },
    { seat: 'Seat_Office_02', stay: [15, 25] }, // 対策局サイトの更新
    { seat: 'Seat_Counter_02', stay: [10, 20] }, // おやつのプリン
    { at: '縁側' },
    { wait: [4, 7] },
    { at: '中庭' },
    { wait: [4, 6] },
  ],
};
