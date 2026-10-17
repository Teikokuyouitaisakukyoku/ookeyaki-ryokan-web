import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ビルド時に vite.config.js が埋め込む実ファイルサイズ（バイト）。圧縮配信でも % がずれないように使う
const SIZES = __ASSET_SIZES__;

export const FILES = {
  stage: 'assets/stage/OokeyakiRyokan.web.glb', // npm run optimize-stage で元の .glb から作る軽量版
  kyokucho: 'assets/characters/kyokucho.vrm',
  hachi: 'assets/characters/hachi.vrm',
  shinkuro: 'assets/characters/shinkuro.vrm',
};

const url = (p) => new URL(p, document.baseURI).href;
// 開発用: ?stage=full で軽量化前の舞台を読む（見た目・当たりの比較用。本番には載せていない）
if (new URLSearchParams(location.search).get('stage') === 'full') FILES.stage = 'assets/stage/OokeyakiRyokan.glb';

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

/**
 * 舞台・住人3体・設定JSONをまとめて読み込む。
 * onProgress(0..1, メッセージ): ダウンロード 0〜90%、パース 90〜100%。
 */
export async function loadAll(onProgress) {
  const total = Object.values(FILES).reduce((s, p) => s + (SIZES[p] || 1), 0);
  let loaded = 0;
  let parsed = 0;
  const report = (msg) => onProgress(Math.min(0.9, (loaded / total) * 0.9) + (parsed / 4) * 0.1, msg);
  const download = (p) => fetchWithProgress(p, (n) => { loaded += n; report('読み込み中…'); });

  const [stageBuf, kBuf, hBuf, sBuf, spawns, seats, nav] = await Promise.all([
    download(FILES.stage), download(FILES.kyokucho), download(FILES.hachi), download(FILES.shinkuro),
    jsonOf('assets/stage/spawns.json'), jsonOf('assets/stage/OokeyakiRyokan_seats.json'),
    jsonOf('assets/stage/nav.json'),
  ]);

  const parse = (loader, buf) => new Promise((ok, ng) => loader.parse(buf, '', ok, ng));

  report('舞台を組み立て中…');
  const stageLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const stage = (await parse(stageLoader, stageBuf)).scene;
  parsed++; report('住人を呼んでいます…');

  const vrmLoader = new GLTFLoader();
  vrmLoader.register((parser) => new VRMLoaderPlugin(parser));
  const vrms = {};
  for (const [name, buf] of [['kyokucho', kBuf], ['hachi', hBuf], ['shinkuro', sBuf]]) {
    const gltf = await parse(vrmLoader, buf);
    const vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    vrms[name] = vrm;
    parsed++; report('住人を呼んでいます…');
  }
  return { stage, vrms, spawns: spawns.spawns, seats: seats.seats, nav };
}
