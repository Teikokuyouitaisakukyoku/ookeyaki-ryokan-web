// VRM の画像だけを軽くする（表情・揺れもの・視線・MToon などの VRM 情報はそのまま）。
// 使い方: npm run optimize-vrm   → assets/characters/*.vrm から *.web.vrm（PC 用）と *.mobile.vrm（スマホ用）を作る
//   テクスチャ: 最大 MAX px（スマホ用は MOBILE_MAX px）に縮小して WebP（EXT_texture_webp）。サムネイルは THUMB px
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAX = 1024;
const MOBILE_MAX = 512;
const THUMB = 256;
const QUALITY = 85;
const DIR = 'assets/characters';

function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { json, bin };
}

function writeGlb(json, bin) {
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const b = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.write(type, 4); return c; };
  return Buffer.concat([head, chunk(j.length, 'JSON'), j, chunk(b.length, 'BIN\0'), b]);
}

async function optimize(file, MAX, suffix) {
  const { json, bin } = readGlb(fs.readFileSync(file));
  const views = json.bufferViews.map((v) => bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
  const thumbIdx = json.extensions?.VRMC_vrm?.meta?.thumbnailImage;
  for (const [i, img] of json.images.entries()) {
    const max = i === thumbIdx ? THUMB : MAX;
    const src = sharp(views[img.bufferView]);
    const { width, height } = await src.metadata();
    const scale = Math.min(1, max / Math.max(width, height));
    views[img.bufferView] = await src
      .resize(Math.round(width * scale), Math.round(height * scale))
      .webp({ quality: QUALITY, alphaQuality: 100, effort: 5 })
      .toBuffer();
    img.mimeType = 'image/webp';
  }
  // テクスチャは EXT_texture_webp で参照する（three.js の GLTFLoader が対応）
  for (const t of json.textures) {
    if (t.source === undefined) continue;
    t.extensions = { ...t.extensions, EXT_texture_webp: { source: t.source } };
    delete t.source;
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'EXT_texture_webp'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'EXT_texture_webp'])];
  // bufferView を詰め直す（4 バイト境界）
  const parts = [];
  let off = 0;
  json.bufferViews.forEach((v, i) => {
    const data = views[i];
    v.byteOffset = off;
    v.byteLength = data.length;
    parts.push(data);
    off += data.length;
    const padLen = (4 - (off % 4)) % 4;
    if (padLen) { parts.push(Buffer.alloc(padLen)); off += padLen; }
  });
  json.buffers = [{ byteLength: off }];
  const out = file.replace(/\.vrm$/, `.${suffix}.vrm`);
  fs.writeFileSync(out, writeGlb(json, Buffer.concat(parts)));
  console.log(`${path.basename(file)} ${(fs.statSync(file).size / 1e6).toFixed(1)}MB → ${path.basename(out)} ${(fs.statSync(out).size / 1e6).toFixed(1)}MB`);
}

for (const f of fs.readdirSync(DIR)) {
  if (!/^[^.]+\.vrm$/.test(f)) continue;
  await optimize(path.join(DIR, f), MAX, 'web');
  await optimize(path.join(DIR, f), MOBILE_MAX, 'mobile');
}
