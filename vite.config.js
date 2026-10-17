import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// assets/ はリポジトリ直下に置いたまま、開発時は /assets/ で配信し、ビルド時は dist/assets/ へ複製する
const ASSET_DIR = path.resolve('assets');
const TYPES = { '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary', '.json': 'application/json' };

function assetSizes() {
  const out = {};
  for (const sub of ['stage', 'characters']) {
    for (const f of fs.readdirSync(path.join(ASSET_DIR, sub))) {
      out[`assets/${sub}/${f}`] = fs.statSync(path.join(ASSET_DIR, sub, f)).size;
    }
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
      // 元の重い舞台（OokeyakiRyokan.glb）は配信しない。軽量版 .web.glb だけを載せる
      fs.cpSync(ASSET_DIR, path.resolve('dist/assets'), {
        recursive: true,
        filter: (src) => path.basename(src) !== 'OokeyakiRyokan.glb',
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serveAssets()],
  define: { __ASSET_SIZES__: JSON.stringify(assetSizes()) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
