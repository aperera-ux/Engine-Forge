// Demo path: Engine -> Calibrate (sample, fit, apply) -> Vehicle -> Garage -> share-link round trip, at 1440 and 1280.
// Usage: node tests/e2e-ui/demo-path.mjs http://localhost:5291/ tests/e2e-ui/screenshots/demo-path
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5291/';
const out = process.argv[3] ?? 'tests/e2e-ui/screenshots/demo-path';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => {
  if (!c) fails++;
  console.log(c ? 'PASS' : 'FAIL', m);
};

for (const width of [1440, 1280]) {
  const height = width === 1440 ? 900 : 800;
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const shot = (name) => p.screenshot({ path: `${out}/${width}_${name}.png` });
  const noHScroll = async (label) => {
    const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(o <= 0, `${width} ${label}: no horizontal page overflow (${o})`);
  };

  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.click('[data-testid="preset-button"]');
  await p.click('.preset-item:has-text("LS3")');
  await p.waitForTimeout(500);
  await p.waitForTimeout(2000);
  await shot('01_engine');
  await noHScroll('engine');

  // Calibrate
  await p.click('[data-testid="tab-calibrate"]');
  await p.waitForSelector('[data-testid="calibrate-panel"]');
  await p.selectOption('.cal select', 'ls3_crank_lbft_hp.csv');
  await p.waitForSelector('[data-testid="calibrate-summary"]');
  await shot('02_calibrate_loaded');
  await p.click('[data-testid="calibrate-fit"]');
  await p.waitForSelector('[data-testid="calibrate-rms"]', { timeout: 90000 });
  await shot('03_calibrate_fit');
  await p.click('[data-testid="calibrate-apply"]');
  await p.waitForSelector('[data-testid="calibrate-applied"]');
  await p.waitForTimeout(400);
  await shot('04_calibrate_applied');
  ok(await p.isVisible('[data-testid="header-calibrated"]'), `${width} header calibrated badge`);

  // Vehicle
  await p.click('[data-testid="mode-switch"] >> text=Vehicle');
  await p.waitForSelector('[data-testid="vehicle-charts"]');
  await p.waitForSelector('[data-testid="vehicle-engine-calibrated"]');
  await p.waitForTimeout(1200);
  await shot('05_vehicle_calibrated');
  await noHScroll('vehicle');
  const heads = await p.evaluate(() =>
    [...document.querySelectorAll('[data-testid="vehicle-charts"] .veh-card .panel-h')].map((h) => {
      const t = h.querySelector('.panel-title').getBoundingClientRect();
      const l = [...h.querySelectorAll('.lg')].map((e) => e.getBoundingClientRect());
      const tops = [t.top, ...l.map((r) => r.top)];
      const lg = h.querySelector('.legend'); return { oneLine: Math.max(...tops) - Math.min(...tops) < 8 && t.height < 20, clipped: !!lg && (lg.scrollWidth > lg.clientWidth + 1 || l.some((r) => r.right > lg.getBoundingClientRect().right + 0.5)) || h.scrollHeight > h.clientHeight + 1 };
    }),
  );
  ok(heads.length > 0 && heads.every((h) => h.oneLine && !h.clipped), `${width} vehicle chart titles and legends on one line ${JSON.stringify(heads)}`);
  ok(!(await p.isVisible('[data-testid="vehicle-engine-stale"]')), `${width} vehicle: no stale warning right after apply`);
  // Edit the build in Engine mode, come back: stale warning
  await p.click('[data-testid="mode-switch"] >> text=Engine');
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.click('[data-testid="cyl-chips"] button:has-text("6")').catch(() => {});
  await p.waitForTimeout(300);
  // restore the 8-cylinder build is not possible via chips alone; check the stale text then revert via garage-less path
  const staleEngine = await p.isVisible('[data-testid="calibrated-badge"]');
  ok(staleEngine, `${width} engine badge still visible after an edit`);
  await p.click('[data-testid="mode-switch"] >> text=Vehicle');
  await p.waitForSelector('[data-testid="vehicle-engine-calibrated"]');
  ok(await p.isVisible('[data-testid="vehicle-engine-stale"]'), `${width} vehicle shows the stale warning after an edit`);
  await shot('06_vehicle_stale');
  await p.click('[data-testid="mode-switch"] >> text=Engine');
  // reload the calibrated build (undo the edit): go back through the share-link / garage path below
  await p.evaluate(() => localStorage.removeItem('engine-forge:config:v1'));

  // Fresh calibrated build for garage + share
  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.click('[data-testid="preset-button"]');
  await p.click('.preset-item:has-text("LS3")');
  await p.click('[data-testid="tab-calibrate"]');
  await p.selectOption('.cal select', 'ls3_crank_lbft_hp.csv');
  await p.waitForSelector('[data-testid="calibrate-summary"]');
  await p.click('[data-testid="calibrate-fit"]');
  await p.waitForSelector('[data-testid="calibrate-rms"]', { timeout: 90000 });
  await p.click('[data-testid="calibrate-apply"]');
  await p.waitForSelector('[data-testid="calibrate-applied"]');

  // Garage
  await p.click('[data-testid="garage-btn"]');
  await p.click('[data-testid="garage-save-0"]');
  await p.waitForTimeout(200);
  await shot('07_garage_saved');
  await p.keyboard.press('Escape');
  await p.mouse.click(700, 500);

  // Share round trip
  await p.click('[data-testid="share-btn"]');
  await p.waitForTimeout(300);
  const url = await p.evaluate(() => location.href);
  ok(url.includes('cfg=') && url.includes('&cal='), `${width} share URL carries cfg and cal (${url.length} chars)`);
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto('about:blank');
  await p2.goto(url);
  await p2.evaluate(() => localStorage.clear()); // a stranger's browser: no saved calibration
  await p2.goto(url);
  await p2.reload();
  await p2.waitForSelector('[data-testid="dyno-chart"] svg');
  await p2.waitForSelector('[data-testid="calibrated-badge"]');
  ok(true, `${width} link opens calibrated`);
  ok(await p2.isVisible('[data-testid="measured-legend"]'), `${width} link opens with the measured overlay`);
  const bt = await p2.textContent('[data-testid="calibrated-badge"]');
  const bt1 = await p.textContent('[data-testid="calibrated-badge"]');
  ok(bt === bt1, `${width} badge text identical after round trip: "${bt}"`);
  await p2.waitForSelector('canvas', { timeout: 20000 }).catch(() => {});
  await p2.waitForTimeout(2500);
  await p2.screenshot({ path: `${out}/${width}_08_share_opened.png` });
  // Vehicle from the link
  await p2.click('[data-testid="mode-switch"] >> text=Vehicle');
  await p2.waitForSelector('[data-testid="vehicle-engine-calibrated"]');
  await p2.waitForTimeout(1000);
  await p2.screenshot({ path: `${out}/${width}_09_share_vehicle.png` });
  // Legacy link (cfg only)
  await p2.click('[data-testid="mode-switch"] >> text=Engine');
  const legacy = url.split('&cal=')[0];
  await p2.goto('about:blank');
  await p2.goto(legacy);
  await p2.reload();
  await p2.waitForSelector('[data-testid="dyno-chart"] svg');
  ok(!(await p2.isVisible('[data-testid="calibrated-badge"]')), `${width} legacy link opens uncalibrated`);
  // Link without a curve: strip m by building a hash with a huge-curve-free payload is covered by unit tests.
  ok(errs.length === 0 && errs2.length === 0, `${width} no page errors ${[...errs, ...errs2].join('|')}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
