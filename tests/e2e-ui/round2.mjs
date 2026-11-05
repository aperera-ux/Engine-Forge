// Round-2 checks: turbo seeding on LS3, alerts popover, build sheet, onboarding, narrow layouts.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const out = process.argv[2] ?? 'tests/e2e-ui/out';
fs.mkdirSync(out, { recursive: true });
const base = process.argv[3] ?? 'http://localhost:5175/';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(w, h, clear = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${w}] ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`[${w}] ${m.text().slice(0, 200)}`));
  if (clear) await p.addInitScript(() => { if (!sessionStorage.getItem('x')) { localStorage.clear(); sessionStorage.setItem('x', '1'); } });
  await p.goto(base);
  await p.waitForSelector('.hud-name');
  await p.waitForTimeout(1800);
  return p;
}
const kpi = (p) => p.locator('[data-testid="kpi-power"] .kpi-v').textContent();
const p = await open(1440, 900);
console.log('onboarding visible:', await p.locator('[data-testid="onboarding"]').count());
await p.screenshot({ path: `${out}/r2-01-firstrun-1440.png` });
await p.click('[data-testid="preset-button"]');
await p.fill('.preset-search', 'LS3');
await p.locator('.preset-item').first().click();
await p.waitForTimeout(500);
console.log('onboarding after preset:', await p.locator('[data-testid="onboarding"]').count());
const na = await kpi(p);
await p.click('[data-testid="tab-induction"]');
await p.click('[data-testid="induction-seg"] button:has-text("Turbo")');
await p.waitForTimeout(500);
console.log('LS3 NA:', na, '-> turbo seeded:', await kpi(p), '| inducer:', await p.locator('[data-testid="slider-inducer"] .num-input').inputValue());
await p.screenshot({ path: `${out}/r2-02-ls3-turbo.png` });
// choke hint: shrink inducer
const ind = p.locator('[data-testid="slider-inducer"] .num-input');
await ind.fill('34'); await ind.press('Enter');
await p.waitForTimeout(400);
console.log('choke hint:', await p.locator('[data-testid="slider-inducer"] .ctl-hint').count() ? await p.locator('[data-testid="slider-inducer"] .ctl-hint').textContent() : 'none');
await p.click('[data-testid="autosize-turbo"]');
await p.waitForTimeout(300);
console.log('after auto-size:', await ind.inputValue(), await kpi(p));
// push into trouble for warnings
await p.click('[data-testid="tab-fuel"]');
const rl = p.locator('[data-testid="slider-redline"] .num-input');
await rl.fill('8500'); await rl.press('Enter');
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/r2-03-warnings-1440.png` });
if (await p.locator('[data-testid="hud-alerts"]').count()) {
  await p.click('[data-testid="hud-alerts"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/r2-04-alerts-pop.png` });
  await p.keyboard.press('Escape');
  await p.mouse.click(700, 800);
}
await p.click('[data-testid="sheet-btn"]');
await p.waitForTimeout(300);
const sheet = await p.evaluate(() => window.__efLastSheet);
fs.writeFileSync(`${out}/r2-buildsheet.txt`, sheet ?? '');
console.log('sheet lines:', (sheet ?? '').split('\n').length);
// hover tooltip with real crank angle
const vb = await p.locator('[data-testid="viewport"]').boundingBox();
let tip = '';
for (let y = 0.3; y < 0.7 && !tip; y += 0.05) for (let x = 0.35; x < 0.8 && !tip; x += 0.04) {
  await p.mouse.move(vb.x + vb.width * x, vb.y + vb.height * y); await p.waitForTimeout(30);
  if (await p.locator('[data-testid="cyl-tooltip"]').count()) tip = await p.locator('[data-testid="cyl-tooltip"]').textContent();
}
console.log('tooltip:', tip || 'none');
const p2 = await open(1280, 800, false);
await p2.screenshot({ path: `${out}/r2-05-1280.png` });
const p3 = await open(900, 1000);
await p3.screenshot({ path: `${out}/r2-06-900.png`, fullPage: true });
console.log('900 hscroll:', await p3.evaluate(() => document.documentElement.scrollWidth));
const p4 = await open(390, 844);
await p4.screenshot({ path: `${out}/r2-07-390.png`, fullPage: true });
console.log('390 hscroll:', await p4.evaluate(() => document.documentElement.scrollWidth));
console.log('ERRORS:', errors.length ? errors.slice(0, 5).join('\n') : 'none');
await browser.close();
