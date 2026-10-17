// 舞台の当たり判定から assets/stage/nav.json（住人の歩行グラフ）を作る。
// 使い方: npm run build-nav   （舞台を差し替えたときだけ実行すればよい）
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const server = await createServer({ server: { port: 5199 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5199/?nonav=1');
await page.waitForFunction(() => window.app?.collision, null, { timeout: 300000 });
const nav = await page.evaluate(async () => {
  const { buildNav } = await import('/src/navbuild.js');
  const { THREE, collision, world } = window.app;
  const box = new THREE.Box3();
  for (const o of collision.colliders) if (/(_Floor|_Stairs_Col|_Landings)$/.test(o.name) || /Floor|Stairs_Col|Landings/.test(o.parent?.name || '')) box.expandByObject(o);
  const spawn = world.spawns.find((s) => s.name.includes('玄関土間')).pos;
  return buildNav(collision, { x: spawn[0], y: spawn[1], z: spawn[2] },
    { minX: Math.floor(box.min.x) - 1, maxX: Math.ceil(box.max.x) + 1, minZ: Math.floor(box.min.z) - 1, maxZ: Math.ceil(box.max.z) + 1, top: box.max.y + 2 });
});
fs.writeFileSync('assets/stage/nav.json', JSON.stringify(nav));
console.log(`nav: ${nav.nodes.length}/${nav.total} nodes, ${nav.edges.length / 2} edges, grid ${nav.nx}x${nav.nz}`);
await browser.close();
await server.close();
