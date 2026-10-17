/**
 * スマホ（指で操作する端末）かどうか。?mobile=1 / ?mobile=0 で強制できる（PC での確認用）。
 * スマホでは軽い素材（*.mobile.*）・低い描画解像度・タッチ操作を使う
 */
const forced = new URLSearchParams(location.search).get('mobile');
export const MOBILE = forced !== null
  ? forced === '1'
  : matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
