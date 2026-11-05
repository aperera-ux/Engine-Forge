// Calibrate to your engine: import, fit, overlay, apply / revert, garage persistence, errors, cancel.
// Usage: node tests/e2e-ui/calibrate.mjs http://localhost:5199/ tests/e2e-ui/screenshots/calibrate
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5199/';
const out = process.argv[3] ?? 'tests/e2e-ui/screenshots/calibrate';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
let fails = 0;
const ok = (c, m) => {
  if (!c) fails++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const preset = async (name) => {
  await p.click('[data-testid="preset-button"]');
  await p.click(`.preset-item:has-text("${name}")`);
};
const sample = async (file) => {
  await p.selectOption('.cal select', file);
  await p.waitForSelector('[data-testid="calibrate-summary"], [data-testid="calibrate-error"]');
};
const scrollPanel = (y) => p.evaluate((yy) => (document.querySelector('.cfg-scroll').scrollTop = yy), y);
const scrollTo = (sel, off = 0) => p.evaluate(([q, o]) => { const sc = document.querySelector('.cfg-scroll'); const el = document.querySelector(q); sc.scrollTop = el.offsetTop - o; }, [sel, off]);

await p.goto(base);
await p.evaluate(() => {
  localStorage.removeItem('engine-forge:garage:v1');
  localStorage.removeItem('engine-forge:calibration:v1');
});
await p.reload();
await p.waitForSelector('[data-testid="dyno-chart"] svg');

// 1. LS3 + the LS3 sample (crank, lb-ft + hp)
await preset('LS3');
await p.click('[data-testid="tab-calibrate"]');
await p.waitForSelector('[data-testid="calibrate-panel"]');
await shot('01_panel_empty');
await sample('ls3_crank_lbft_hp.csv');
ok((await p.textContent('[data-testid="calibrate-summary"]')).includes('ls3_crank'), 'sample imported');
ok(await p.isVisible('[data-testid="measured-legend"]'), 'measured legend visible on the dyno card');
await shot('02_imported_overlay');

await p.click('[data-testid="calibrate-fit"]');
await p.waitForSelector('[data-testid="calibrate-rms"]', { timeout: 60000 });
const after = parseFloat(await p.textContent('[data-testid="calibrate-rms-after"]'));
ok(after < 5, `fit result shown, RMS after ${after}%`);
ok(await p.isVisible('[data-testid="calibrate-apply"]'), 'Apply visible');
await scrollTo('[data-testid="calibrate-rms"]', 120);
await p.waitForTimeout(200);
await shot('03_fit_result_top');
await scrollTo('.cal-params', 40);
await p.waitForTimeout(200);
await shot('04_fit_result_params');

await p.click('[data-testid="calibrate-apply"]');
await p.waitForSelector('[data-testid="calibrated-badge"]');
ok(await p.isVisible('[data-testid="header-calibrated"]'), 'header badge visible');
ok((await p.textContent('[data-testid="calibrated-badge"]')).includes('Calibrated to'), 'dyno badge visible');
await scrollPanel(0);
await shot('05_applied_badge');

// 2. Garage keeps the calibration
await p.click('[data-testid="garage-btn"]');
await p.click('[data-testid="garage-save-0"]');
await p.waitForSelector('[data-testid="garage-calibrated-0"]');
await p.waitForTimeout(500);
await shot('06_garage_calibrated');
ok(true, 'garage slot shows the calibration');
await p.keyboard.press('Escape');
await p.reload();
await p.waitForSelector('[data-testid="calibrated-badge"]');
ok(true, 'calibration survives a reload');
await p.click('[data-testid="preset-button"]');
await p.click('.preset-item:has-text("K20")');
ok((await p.locator('[data-testid="calibrated-badge"]').count()) === 0, 'loading another preset clears the badge');
await p.click('[data-testid="garage-btn"]');
await p.click('[data-testid="garage-load-0"]');
await p.waitForSelector('[data-testid="calibrated-badge"]');
ok(true, 'loading the garage save restores the calibration');
await p.click('[data-testid="tab-calibrate"]');
await p.waitForSelector('[data-testid="calibrate-revert"]');
await shot('07_applied_panel');
await p.click('[data-testid="calibrate-revert"]');
await p.waitForTimeout(200);
ok((await p.locator('[data-testid="calibrated-badge"]').count()) === 0, 'revert removes the badge');

// 3. Poor fit: an LS7 curve against a K20A must be called out
await preset('K20');
await p.click('[data-testid="tab-calibrate"]');
await sample('ls7_wheel_synthetic.tsv');
await p.waitForSelector('[data-testid="calibrate-basis"]');
ok(await p.isVisible('[data-testid="calibrate-loss"]'), 'wheel data shows the drivetrain-loss input');
ok((await p.inputValue('#cal-loss')) === '15', 'default drivetrain loss 15 %');
await shot('08_wheel_interpretation');
await p.click('[data-testid="calibrate-fit"]');
await p.waitForSelector('[data-testid="calibrate-poor-banner"]', { timeout: 60000 });
ok(true, 'poor fit banner shown (> 5 % RMS)');
await scrollTo('[data-testid="calibrate-rms"]', 120);
await p.waitForTimeout(200);
await shot('09_poor_fit');
ok((await p.locator('[data-testid^="calibrate-bound-"]').count()) > 0, 'at-bound flags shown');
await p.click('[data-testid="calibrate-discard"]');

// 4. Bad input
await p.click('[data-testid="calibrate-paste-toggle"]');
await p.fill('[data-testid="calibrate-paste"]', 'hello\nthis is not a dyno file\n1 2');
await p.click('[data-testid="calibrate-paste-use"]');
await p.waitForSelector('[data-testid="calibrate-error"]');
ok(true, 'clear error for a bad paste');
await shot('10_error');

// 5. Upload a real file through the file input + wheel/crank
await p.setInputFiles('[data-testid="calibrate-file"]', 'public/samples/b58_340i_crank_nm_kw_semicolon.csv');
await p.waitForSelector('[data-testid="calibrate-summary"]');
ok((await p.textContent('[data-testid="calibrate-summary"]')).includes('b58_340i'), 'file input works (semicolon + decimal commas)');

// 6. Plateau peak range on a stock turbo preset, then fit + cancel
await preset('B58');
await p.waitForTimeout(300);
const rangeTxt = await p.textContent('[data-testid="peak-torque-range"]').catch(() => null);
ok(!!rangeTxt && /–/.test(rangeTxt), `peak torque range shown: ${rangeTxt}`);
await shot('11_peak_range');
await p.click('[data-testid="tab-calibrate"]');
await p.waitForSelector('[data-testid="calibrate-fit"]');
await p.click('[data-testid="calibrate-fit"]');
await p.waitForSelector('[data-testid="calibrate-progress"]');
await p.waitForTimeout(700);
await shot('12_progress');
await p.click('[data-testid="calibrate-cancel"]');
await p.waitForSelector('[data-testid="calibrate-fit"]');
ok((await p.locator('[data-testid="calibrate-rms"]').count()) === 0, 'cancel stops the fit without a result');
await p.click('[data-testid="calibrate-fit"]');
await p.waitForSelector('[data-testid="calibrate-rms"]', { timeout: 90000 });
ok(true, 'fit can be started again after a cancel');
await shot('13_b58_result');

ok(errs.length === 0, `no page errors ${errs.join(' | ')}`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
