// Usage: node src/render/__screens__/shoot.mjs <outDir> name=query [name=query ...]
import { chromium } from 'playwright';
const [outDir, ...shots] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:5174/src/render/preview.html';
const wait = Number(process.env.WAIT ?? 6000);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 800) } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text().slice(0, 1500)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.stack));
for (const s of shots) {
  const [name, query] = s.split('=', 2).length === 2 ? [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)] : [s, ''];
  errs.length = 0;
  await page.goto(`${base}?${query}`);
  await page.waitForTimeout(wait);
  const fps = await page.$eval('#fps', (e) => e.textContent).catch(() => '?');
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, 'fps', fps, errs.length ? '\n  ' + [...new Set(errs)].slice(0, 6).join('\n  ') : '');
}
await browser.close();
