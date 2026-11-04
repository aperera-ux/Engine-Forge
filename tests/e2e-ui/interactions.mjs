// Share-URL roundtrip, persistence, cylinder hover tooltip, keyboard shortcuts.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:5175/';
const out = process.argv[3] ?? 'tests/e2e-ui/out';
const browser = await chromium.launch({ args: process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(base);
await p.waitForSelector('[data-testid="dyno-chart"] svg');
await p.fill('.hud-name', 'Share Test V12');
await p.click('[data-testid="layout-seg"] button:has-text("Vee")');
await p.click('[data-testid="cyl-chips"] button:has-text("12")');
await p.click('[data-testid="share-btn"]');
await p.waitForTimeout(400);
const url = p.url();
console.log('share url has cfg:', url.includes('#cfg='));
const p2 = await ctx.newPage();
await p2.goto(url);
await p2.waitForSelector('.hud-name');
console.log('roundtrip name:', await p2.inputValue('.hud-name'), '| firing:', await p2.locator('.firing-order').textContent());
// persistence (no hash)
const p3 = await ctx.newPage();
await p3.goto(base);
await p3.waitForSelector('.hud-name');
console.log('persisted name:', await p3.inputValue('.hud-name'));
// hover sweep for tooltip
const vb = await p3.locator('[data-testid="viewport"]').boundingBox();
let found = false;
for (let y = 0.25; y < 0.75 && !found; y += 0.05)
  for (let x = 0.3; x < 0.75 && !found; x += 0.04) {
    await p3.mouse.move(vb.x + vb.width * x, vb.y + vb.height * y);
    await p3.waitForTimeout(40);
    if (await p3.locator('[data-testid="cyl-tooltip"]').count()) found = true;
  }
console.log('tooltip found:', found, found ? await p3.locator('[data-testid="cyl-tooltip"]').textContent() : '');
if (found) await p3.screenshot({ path: `${out}/08-tooltip.png` });
// keyboard
await p3.mouse.move(5, 5);
await p3.keyboard.press('Space');
console.log('running after space:', await p3.getAttribute('[data-testid="run-toggle"]', 'aria-label'));
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
