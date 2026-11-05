// Vehicle mode screenshots + smoke checks. Usage: node tests/e2e-ui/vehicle-shots.mjs [baseUrl] [outDir]
// The app has a single (light) theme; the 3D viewport's dark HUD is not shown in Vehicle mode.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tests/e2e-ui/screenshots/vehicle';
fs.mkdirSync(out, { recursive: true });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));
  await p.addInitScript(() => {
    if (!sessionStorage.getItem('ef-clean')) {
      localStorage.clear();
      sessionStorage.setItem('ef-clean', '1');
    }
  });
  await p.goto(base);
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.click('[data-testid="mode-switch"] button:has-text("Vehicle")');
  await p.waitForSelector('[data-testid="chart-tractive"] svg path.recharts-line-curve');
  await p.waitForTimeout(600);
  const s = (n) => p.screenshot({ path: `${out}/${w}-${n}.png` });
  await s('01-default-metric');
  ok(await p.isVisible('[data-testid="kpi-0-60"]'), 'KPI tiles visible');
  ok((await p.textContent('[data-testid="kpi-top-speed"]')).includes('plausibility'), 'top speed marked as estimate');
  // preset
  await p.selectOption('[data-testid="vehicle-panel"] select', 'corvette-z06-2006');
  await p.waitForTimeout(700);
  await s('02-preset-z06');
  ok(await p.isVisible('[data-testid="reference-check"]'), 'reference check shown for preset');
  // imperial
  await p.click('[data-testid="units"] button:has-text("Imperial")');
  await p.waitForTimeout(400);
  await s('03-imperial');
  // optimizer
  await p.click('[data-testid="optimize-btn"]');
  await p.waitForSelector('[data-testid="optimizer-result"]', { timeout: 30000 });
  await p.waitForTimeout(300);
  ok(await p.isVisible('[data-testid="optimizer-note"]'), 'optimizer caveat visible');
  await p.locator('[data-testid="optimizer"]').scrollIntoViewIfNeeded();
  await s('04-optimizer');
  // garage round-trip
  await p.click('[data-testid="optimizer-apply"]');
  await p.waitForTimeout(500);
  await p.click('[data-testid="garage-btn"]');
  await p.click('[data-testid="garage-save-0"]');
  await p.waitForTimeout(200);
  await s('05-garage');
  await p.reload();
  await p.waitForSelector('[data-testid="vehicle-panel"]');
  await p.waitForTimeout(800);
  ok((await p.locator('[data-testid="gear-grid"] input').count()) === 6, 'vehicle persisted across reload');
  // old save without vehicle still loads
  await p.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('engine-forge:garage:v1'));
    delete g[0].vehicle;
    localStorage.setItem('engine-forge:garage:v1', JSON.stringify(g));
  });
  await p.reload();
  await p.waitForSelector('[data-testid="vehicle-panel"]');
  await p.click('[data-testid="garage-btn"]');
  await p.click('[data-testid="garage-load-0"]');
  await p.waitForTimeout(500);
  ok(await p.isVisible('[data-testid="vehicle-kpis"]'), 'legacy save (no vehicle) loads in Vehicle mode');
  await s('06-legacy-save-loaded');
  // back to engine mode
  await p.click('[data-testid="mode-switch"] button:has-text("Engine")');
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  ok(true, 'back to engine mode');
  await ctx.close();
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
