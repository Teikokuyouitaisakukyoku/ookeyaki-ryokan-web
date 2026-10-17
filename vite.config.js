import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// assets/ はリポジトリ直下に置いたまま、開発時は /assets/ で配信し、ビルド時は dist/assets/ へ複製する
const ASSET_DIR = path.resolve('assets');
const TYPES = { '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.json': 'application/json' };

function assetSizes() {
  const out = {};
  for (const f of fs.readdirSync(ASSET_DIR, { recursive: true })) {
    const full = path.join(ASSET_DIR, f);
    if (fs.statSync(full).isFile()) out[`assets/${f.split(path.sep).join('/')}`] = fs.statSync(full).size;
  }
  return out;
}

function serveAssets() {
  return {
    name: 'serve-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const file = path.join(ASSET_DIR, decodeURIComponent(req.url.split('?')[0]));
        if (!file.startsWith(ASSET_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
        res.setHeader('Content-Length', fs.statSync(file).size);
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      // 元の重い舞台・VRM は配信しない。軽量版（.web.glb / .web.vrm）だけを載せる
      fs.cpSync(ASSET_DIR, path.resolve('dist/assets'), {
        recursive: true,
        filter: (src) => !/^(OokeyakiRyokan\.glb|[^.]+\.vrm)$/.test(path.basename(src)),
      });
      // ライセンス表記も配信物に載せる
      for (const f of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(f, path.resolve('dist', f));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveAssets()],
  define: { __ASSET_SIZES__: JSON.stringify(assetSizes()) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
