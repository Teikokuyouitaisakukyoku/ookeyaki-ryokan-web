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
    { wait: [3, 5] },
    { seat: 'Seat_Hiroma_03', stay: [20, 30] },
    { at: '縁側' },
    { wait: [4, 7] },
  ],
  hachi: [
    { seat: 'Seat_Counter_01', stay: [15, 25] },
    { at: '広間' },
    { wait: [3, 5] },
    { seat: 'Seat_Lobby_01', stay: [10, 20] },
    { at: '玄関土間' },
    { wait: [2, 4] },
  ],
  shinkuro: [
    { seat: 'Seat_Ima_01', stay: [20, 30] },
    { at: '縁側' },
    { wait: [3, 6] },
    { seat: 'Seat_Hiroma_08', stay: [15, 25] },
    { at: '広間' },
    { wait: [3, 5] },
  ],
};
