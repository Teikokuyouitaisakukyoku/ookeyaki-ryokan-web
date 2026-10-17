import * as THREE from 'three';
import { loadAll } from './loader.js';
import { Collision } from './collision.js';
import { applyStageEdits, setupNightProps } from './stage-edits.js';
import { now, inHours, setTime } from './schedule.js';
import { Player } from './player.js';
import { NavGraph } from './nav.js';
import { Residents } from './npc.js';
import { Conversation } from './talk.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---- 描画
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa9c6dc);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
scene.add(new THREE.HemisphereLight(0xe4eef7, 0xd8cdb8, 1.5));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
sun.position.set(-18, 32, 22);
sun.target.position.set(8, 0, -10);
scene.add(sun, sun.target);

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

const player = new Player(camera, canvas, collision, world.spawns);
const startIdx = Math.max(0, world.spawns.findIndex((s) => s.name.includes('玄関土間')));
player.goSpawn(startIdx);

let residents = null;
const nav = world.nav && !params.get('nonav') ? new NavGraph(world.nav) : null;
if (nav) {
  residents = new Residents(scene, world.vrms, nav, world.seats, world.spawns, world.clips);
}

const startEl = $('start');
player.onLockChange = (locked) => {
  if (locked) talk?.relocked();
  // お知らせ中はリンクを押せるよう、操作案内を出さずにカーソルだけ解放する
  startEl.classList.toggle('show', !locked && talk?.state !== 'news');
};
startEl.addEventListener('click', () => player.lock());
canvas.addEventListener('click', () => { if (!player.locked) player.lock(); });

showProgress(1, '');
loading.classList.add('done');
setTimeout(() => loading.remove(), 800);
startEl.classList.add('show');

// ---- 会話（正面まで来た住人と話す。スペース／クリックで返事）
const talk = residents ? new Conversation($('dialog'), residents, camera) : null;
if (talk) talk.onEnd = () => startEl.classList.toggle('show', !player.locked);
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); talk?.input('key'); }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') talk?.openLink();
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && player.locked) talk?.input('click'); // 照準（画面中央）の先をクリック
});

// ---- 毎フレーム
const hud = $('hud');
const clock = new THREE.Clock();
let fpsT = 0, fpsN = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  const talker = residents?.update(dt, camera.position, camera);
  talk?.update(dt, talker);
  renderer.render(scene, camera);
  fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    const p = player.feet;
    const d = now();
    setNight(inHours(d, 23, 5));
    hud.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}   x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}   ${(fpsN / fpsT).toFixed(0)} fps`;
    fpsN = 0; fpsT = 0;
  }
});

// 動作確認・ナビ生成用
window.app = { THREE, scene, camera, renderer, collision, player, world, nav, residents, talk, setTime };
