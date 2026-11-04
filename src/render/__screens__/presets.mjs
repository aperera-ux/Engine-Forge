// node presets.mjs <outDir> query1 query2 ...  (full app, picks preset via search)
import { chromium } from 'playwright';
const [outDir, ...qs] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('FIT')) errs.push(m.text().slice(0, 400)); });
await page.goto('http://localhost:5174/');
await page.waitForTimeout(6000);
for (const q of qs) {
  await page.click('[data-testid=preset-button]');
  await page.fill('.preset-search', q);
  await page.click('.preset-item >> nth=0');
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${outDir}/app-${q}.png` });
  console.log(q, await page.$eval('.preset-name', (e) => e.textContent), errs.splice(0).join(' | '));
}
await browser.close();
