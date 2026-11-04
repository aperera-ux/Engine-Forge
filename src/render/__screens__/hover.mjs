import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5174/src/render/preview.html?cfg=i4&still=1&q=low');
await page.waitForTimeout(5000);
const out = [];
for (const x of [520, 580, 640, 700, 760]) {
  await page.mouse.move(x, 330);
  await page.waitForTimeout(1200);
  out.push(x + ':' + (await page.$eval('#hud', (e) => e.textContent.match(/cyl (\S+)/)?.[1])));
}
console.log(out.join(' '));
await page.screenshot({ path: process.argv[2] });
await browser.close();
