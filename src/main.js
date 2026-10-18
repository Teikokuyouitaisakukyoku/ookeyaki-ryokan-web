import * as THREE from 'three';
import { loadAll } from './loader.js';
import { Collision } from './collision.js';
import { applyStageEdits, setupNightProps } from './stage-edits.js';
import { now, inHours, setTime } from './schedule.js';
import { Sky } from './sky.js';
import { batchStage } from './batch.js';
import { Player } from './player.js';
import { NavGraph } from './nav.js';
import { Residents } from './npc.js';
import { Conversation } from './talk.js';
import { VR } from './vr.js';
import { pickRay, GRAB } from './touch.js';
import { MOBILE } from './device.js';
import { TouchControls } from './mobile.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---- 描画
const canvas = $('view');
// スマホは描画解像度を下げ、アンチエイリアスを切る（GPU の負荷とメモリを減らす）
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(MOBILE ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 2));
if (MOBILE) document.body.classList.add('mobile');
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c6dc);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, MOBILE ? 90 : 400); // スマホは遠くを描かない
const hemi = new THREE.HemisphereLight(0xe4eef7, 0xd8cdb8, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-18, 32, 22);
sun.target.position.set(8, 0, -10);
scene.add(sun, sun.target);
const lamp = new THREE.AmbientLight();
scene.add(lamp);
const sky = new Sky(scene, hemi, sun, lamp); // 時刻で空の明るさと色・館内の灯りを変える
sky.update(now());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

// ---- ローディング表示
const loading = $('loading');
function showProgress(p, msg) {
  const pct = Math.round(p * 100);
  $('pct').textContent = `${pct}%`;
  loading.querySelector('#bar i').style.width = `${pct}%`;
  if (msg) $('msg').textContent = msg;
}
// 舞い散る欅の葉
for (let i = 0; i < 14; i++) {
  const leaf = document.createElement('div');
  leaf.className = 'leaf';
  leaf.style.left = `${Math.random() * 100}%`;
  leaf.style.animationDuration = `${7 + Math.random() * 7}s`;
  leaf.style.animationDelay = `${-Math.random() * 12}s`;
  leaf.style.setProperty('--dx', `${(Math.random() - 0.5) * 240}px`);
  leaf.style.setProperty('--rot', `${360 + Math.random() * 540}deg`);
  leaf.style.background = ['#b9602a', '#c98a3d', '#8a4a22'][i % 3];
  loading.appendChild(leaf);
}

// ---- 読み込み
let world;
try {
  world = await loadAll(showProgress);
} catch (e) {
  $('msg').textContent = `読み込みに失敗しました: ${e.message}`;
  throw e;
}
applyStageEdits(world.stage);
scene.add(world.stage);
const collision = new Collision(world.stage);
const setNight = setupNightProps(world.stage, collision);
setNight(inHours(now(), 23, 5));
if (!params.has('nobatch')) scene.add(batchStage(world.stage, setNight.objects)); // 描画をまとめる（?nobatch で無効）

const player = new Player(camera, canvas, collision, world.spawns);
const startIdx = Math.max(0, world.spawns.findIndex((s) => s.name.includes('玄関土間')));
player.goSpawn(startIdx);

let residents = null;
const nav = world.nav && !params.get('nonav') ? new NavGraph(world.nav) : null;
if (nav) {
  residents = new Residents(scene, world.vrms, nav, world.seats, world.spawns, world.clips, collision);
}

const startEl = $('start');
player.onLockChange = (locked) => {
  if (locked) talk?.relocked();
  // お知らせ中はリンクを押せるよう、操作案内を出さずにカーソルだけ解放する
  startEl.classList.toggle('show', !locked && talk?.state !== 'news');
};
startEl.addEventListener('click', () => (MOBILE ? startEl.classList.remove('show') : player.lock()));
startEl.querySelector('.credit a').addEventListener('click', (e) => e.stopPropagation()); // ライセンス表記は別タブで開くだけ
canvas.addEventListener('click', () => { if (!player.locked) player.lock(); });

showProgress(1, '');
loading.classList.add('done');
setTimeout(() => loading.remove(), 800);
startEl.classList.add('show');

// ---- 会話（正面まで来た住人と話す。スペース／クリックで返事）
const talk = residents ? new Conversation($('dialog'), residents, camera) : null;
if (talk) talk.onEnd = () => startEl.classList.toggle('show', !MOBILE && !player.locked && !vr?.active);
let vr = null;
if (residents) {
  vr = new VR({ renderer, scene, camera, player, collision, residents, talk, button: $('vr-btn') });
  vr.onStart = () => { document.exitPointerLock?.(); startEl.classList.remove('show'); document.body.classList.add('vr'); };
  vr.onEnd = () => { document.body.classList.remove('vr'); startEl.classList.add('show'); };
}
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); talk?.input('key'); }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') talk?.openLink();
});

// ---- タッチ（通常モード: 手のカーソルで住人をクリック。手・腕は押したまま動かすと引っ張る）
const REACH = 2.5; // 手が届く距離
const ray = new THREE.Ray();
let press = null;  // 手・腕を押している: { r, part, t, at（押した点）, dragging, sx, sy（スマホは指の位置） }
const raycaster = new THREE.Raycaster();
/** 照準（画面中央）か、画面の点 (sx, sy) を通る視線 */
function aimRay(sx, sy) {
  if (sx === undefined) {
    camera.getWorldPosition(ray.origin);
    camera.getWorldDirection(ray.direction);
  } else {
    raycaster.setFromCamera(new THREE.Vector2(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
    ray.copy(raycaster.ray);
  }
  return ray;
}
function pickResident(sx, sy) {
  if (!residents) return null;
  aimRay(sx, sy);
  let best = null;
  for (const r of residents.list) {
    if (r.root.position.distanceTo(ray.origin) > REACH + 1.5) continue;
    const hit = pickRay(r.vrm, ray, REACH);
    if (hit && (!best || hit.t < best.t)) best = { r, ...hit };
  }
  return best;
}
const handCursor = () => cross.classList.contains('hand');
document.addEventListener('mousedown', (e) => { if (e.button === 0 && player.locked) pressStart(); });
addEventListener('mouseup', (e) => { if (e.button === 0) pressEnd(); });
function pressStart() {
  if (handCursor()) {
    const hit = pickResident();
    if (hit) {
      if (GRAB[hit.part] && hit.r.canGrab()) press = { ...hit, at: ray.at(hit.t, new THREE.Vector3()), dragging: false };
      else talk?.touch(hit.r, hit.part);
      return;
    }
  }
  talk?.input('click'); // 照準（画面中央）の先をクリック: 返事・頭をなでる
}
function pressEnd() {
  if (!press) return;
  if (press.dragging) press.r.endDrag();
  else talk?.touch(press.r, press.part); // 動かさずに離した = 触れた
  press = null;
}
/** 押している間: 照準の先（押したときの距離）へ住人を引っ張る */
function updatePress() {
  if (!press) return;
  const target = aimRay(press.sx, press.sy).at(press.t, new THREE.Vector3());
  if (!press.dragging && Math.hypot(target.x - press.at.x, target.z - press.at.z) > 0.15) {
    if (press.r.beginDrag(GRAB[press.part])) { press.dragging = true; talk?.touch(press.r, 'pull'); }
    else { press = null; return; }
  }
  if (press.dragging) press.r.dragTarget.copy(target);
}

// ---- スマホ: タッチ操作と画面のボタン
if (MOBILE) {
  new TouchControls({
    surface: canvas,
    stick: $('stick'),
    player,
    // タップ: 住人に触れる。住人以外は返事（お知らせ中なら閉じる）
    onTap(x, y) {
      const hit = pickResident(x, y);
      if (hit) { talk?.touch(hit.r, hit.part); return; }
      if (talk?.state === 'news') talk.relocked();
      else talk?.input('key');
    },
    // 長押し: 手・腕なら引っ張る。ほかの部位なら触れる
    onHoldStart(x, y) {
      const hit = pickResident(x, y);
      if (!hit) return false;
      if (GRAB[hit.part] && hit.r.beginDrag(GRAB[hit.part])) {
        press = { ...hit, at: ray.at(hit.t, new THREE.Vector3()), dragging: true, sx: x, sy: y };
        talk?.touch(hit.r, 'pull');
        return true;
      }
      talk?.touch(hit.r, hit.part);
      return false;
    },
    onHoldMove(x, y) { if (press) { press.sx = x; press.sy = y; } },
    onHoldEnd() { if (press) { press.r.endDrag(); press = null; } },
  });
  $('btn-shot').addEventListener('click', () => screenshot());
  $('btn-menu').addEventListener('click', () => startEl.classList.add('show'));
}

// ---- 撮影（F5）・カーソル切り替え（V）
const toastEl = $('toast');
let toastTimer = 0;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
function screenshot() {
  renderer.render(scene, camera); // 描いた直後に読み出す（描画バッファが消える前に）
  canvas.toBlob((blob) => {
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    const name = `ookeyaki_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`撮影しました（${name}）`);
  }, 'image/png');
}
const cross = $('cross');
const setHand = (on) => {
  cross.classList.toggle('hand', on);
  try { localStorage.setItem('cursor', on ? 'hand' : 'point'); } catch {}
};
try { setHand(localStorage.getItem('cursor') === 'hand'); } catch {}
addEventListener('keydown', (e) => {
  if (e.code === 'F5') { e.preventDefault(); screenshot(); } // 再読み込みの代わりに撮影
  if (e.code === 'KeyV' && !e.repeat) setHand(!cross.classList.contains('hand'));
});

// ---- 毎フレーム
const hud = $('hud');
const clock = new THREE.Clock();
const eye = new THREE.Vector3();
let fpsT = 0, fpsN = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (vr?.active) vr.update(dt);
  else { player.update(dt); updatePress(); }
  const talker = residents?.update(dt, camera.getWorldPosition(eye), camera);
  talk?.update(dt, talker);
  renderer.render(scene, camera);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const p = player.feet;
    const d = now();
    setNight(inHours(d, 23, 5));
    sky.update(d);
    hud.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}   x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}   ${(fpsN / fpsT).toFixed(0)} fps`;
    fpsN = 0; fpsT = 0;
  }
});

// 動作確認・ナビ生成用
window.app = { THREE, scene, sky, camera, renderer, collision, player, world, nav, residents, talk, setTime, screenshot, vr, pickResident, aimRay, pressStart, pressEnd, updatePress, setHand };
