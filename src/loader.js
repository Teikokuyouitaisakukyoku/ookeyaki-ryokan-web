import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { MOTIONS } from './motions.js';
import { MOBILE } from './device.js';
import { ROSTER } from './schedule.js';

// ビルド時に vite.config.js が埋め込む実ファイルサイズ（バイト）。圧縮配信でも % がずれないように使う
const SIZES = __ASSET_SIZES__;

const M = MOBILE ? 'mobile' : 'web';
export const FILES = {
  // npm run optimize-stage / optimize-vrm で元の素材から作る軽量版。PC 用は .web（画像 1024px）、スマホ用は .mobile（512px）
  stage: `assets/stage/OokeyakiRyokan.${M}.glb`,
  ...Object.fromEntries(ROSTER.map((n) => [n, `assets/characters/${n}.${M}.vrm`])),
};

const url = (p) => new URL(p, document.baseURI).href;
// 開発用: ?stage=full で軽量化前の舞台と VRM を読む（見た目・当たりの比較用。本番には載せていない）
if (new URLSearchParams(location.search).get('stage') === 'full') {
  FILES.stage = 'assets/stage/OokeyakiRyokan.glb';
  for (const n of ROSTER) FILES[n] = `assets/characters/${n}.vrm`;
}

async function fetchWithProgress(path, onBytes) {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.length);
  }
  return new Blob(chunks).arrayBuffer();
}

const jsonOf = (path) => fetch(url(path)).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const parse = (loader, buf) => new Promise((ok, ng) => loader.parse(buf, '', ok, ng));
const vrmLoader = new GLTFLoader();
vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

async function parseVRM(buf) {
  const gltf = await parse(vrmLoader, buf);
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  if (vrm.lookAt) { // VRMA の視線トラックの受け口
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'lookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }
  return vrm;
}

/** モーション（VRMA）をこの VRM 用のクリップにする */
const clipsFor = (vrm, anims) => Object.fromEntries(Object.entries(anims).map(([k, a]) => [k, createVRMAnimationClip(a, vrm)]));

/** 途中から登場する住人を読み込む: { vrm, clips } */
export async function loadResident(name, anims) {
  const res = await fetch(url(FILES[name]));
  if (!res.ok) throw new Error(`${FILES[name]}: HTTP ${res.status}`);
  const vrm = await parseVRM(await res.arrayBuffer());
  return { vrm, clips: clipsFor(vrm, anims) };
}

/**
 * 舞台・いまいる住人（names）・設定 JSON・モーションをまとめて読み込む。
 * onProgress(0..1, メッセージ): ダウンロード 0〜90%、パース 90〜100%。
 * anims（モーション）は、あとから登場する住人のクリップを作るために返す。
 */
export async function loadAll(onProgress, names) {
  const motionList = Object.entries(MOTIONS);
  const files = [FILES.stage, ...names.map((n) => FILES[n])];
  const total = [...files, ...motionList.map(([, p]) => p)].reduce((s, p) => s + (SIZES[p] || 1), 0);
  const steps = names.length + 2;
  let loaded = 0;
  let parsed = 0;
  const report = (msg) => onProgress(Math.min(0.9, (loaded / total) * 0.9) + (parsed / steps) * 0.1, msg);
  const download = (p) => fetchWithProgress(p, (n) => { loaded += n; report('読み込み中…'); });

  const [[stageBuf, ...vrmBufs], spawns, seats, nav, motionBufs] = await Promise.all([
    Promise.all(files.map(download)),
    jsonOf('assets/stage/spawns.json'), jsonOf('assets/stage/OokeyakiRyokan_seats.json'),
    jsonOf('assets/stage/nav.json'),
    // モーションは 1 本読めなくても全体を止めない（その動きは手続きで代用）
    Promise.all(motionList.map(([, p]) => download(p).catch((e) => { console.warn(e.message); return null; }))),
  ]);

  report('舞台を組み立て中…');
  const stageLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const stage = (await parse(stageLoader, stageBuf)).scene;
  parsed++; report('住人を呼んでいます…');

  const vrms = {};
  for (const [i, name] of names.entries()) {
    vrms[name] = await parseVRM(vrmBufs[i]);
    parsed++; report('住人を呼んでいます…');
  }

  report('動きを準備中…');
  const vrmaLoader = new GLTFLoader();
  vrmaLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const anims = {};
  for (let i = 0; i < motionList.length; i++) {
    if (!motionBufs[i]) continue;
    const anim = (await parse(vrmaLoader, motionBufs[i])).userData.vrmAnimations?.[0];
    if (anim) anims[motionList[i][0]] = anim;
  }
  const clips = Object.fromEntries(Object.entries(vrms).map(([n, vrm]) => [n, clipsFor(vrm, anims)]));
  parsed++;
  return { stage, vrms, clips, anims, spawns: spawns.spawns, seats: seats.seats, nav };
}
