// Zoomed logo screenshot + selectability check. Usage: node tests/e2e-ui/logo-shot.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'tests/e2e-ui/screenshots/light-theme';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
await p.goto(base);
await p.waitForSelector('.brand-logo');
await p.waitForTimeout(500);
await p.locator('.brand').screenshot({ path: `${out}/logo-3x.png` });
await p.keyboard.press('Meta+a');
const sel = await p.evaluate(() => window.getSelection().toString());
const img = await p.evaluate(() => {
  const i = document.querySelector('.brand-logo');
  return { alt: i.alt, draggable: i.draggable, us: getComputedStyle(i).userSelect };
});
console.log('alt/draggable/user-select:', JSON.stringify(img), '| selection contains brand text:', /engine\s*forge/i.test(sel));
await browser.close();
