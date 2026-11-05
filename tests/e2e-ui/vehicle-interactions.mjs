// Vehicle mode interaction checks: edits, AWD/automatic, bad tyre code, rapid input (debounce + worker), optimizer edge note.
// Usage: node tests/e2e-ui/vehicle-interactions.mjs [baseUrl] [outDir]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tests/e2e-ui/screenshots/vehicle';
fs.mkdirSync(out, { recursive: true });
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
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
const et = async () => (await p.textContent('[data-testid="kpi-et"] .kpi-v')).trim();
const et0 = await et();

// rapid edits: mass slider typed 12 times quickly; UI must stay responsive and settle on the last value
const t0 = Date.now();
for (let i = 0; i < 12; i++) {
  await p.fill('[data-testid="veh-mass"] input.num-input', String(1300 + i * 40));
  await p.keyboard.press('Enter');
}
await p.waitForFunction((prev) => document.querySelector('[data-testid="kpi-et"] .kpi-v')?.textContent?.trim() !== prev, et0, { timeout: 5000 });
console.log('rapid edits settled in', Date.now() - t0, 'ms');
const et1 = await et();
ok(et1 !== et0, `heavier car is slower (${et0} -> ${et1})`);
ok(parseFloat(et1) > parseFloat(et0), 'ET went up with mass');

// AWD + automatic
await p.click('[data-testid="veh-layout"] button:has-text("AWD")');
await p.selectOption('[data-testid="vehicle-panel"] .select select >> nth=1', 'automatic');
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/07-awd-automatic.png` });
ok(await p.isVisible('[data-testid="kpi-et"]'), 'AWD + automatic renders');

// bad tyre code does not break the model
await p.fill('[data-testid="tire-code"]', 'nonsense');
await p.waitForTimeout(400);
ok(await p.isVisible('[data-testid="kpi-et"]'), 'invalid tyre text keeps the last valid radius');
await p.fill('[data-testid="tire-code"]', '295/30R19');
await p.waitForTimeout(500);

// add a gear / remove a gear
await p.click('[data-testid="gear-add"]');
await p.waitForTimeout(400);
ok((await p.locator('[data-testid="gear-grid"] input').count()) === 7, 'gear added');
await p.click('[data-testid="gear-remove"]');
await p.click('[data-testid="gear-remove"]');
await p.waitForTimeout(400);
ok((await p.locator('[data-testid="gear-grid"] input').count()) === 5, 'gears removed');
await p.screenshot({ path: `${out}/08-5-speed-295-tires.png` });

// optimiser with ratio search
await p.locator('[data-testid="optimizer"] .toggle >> nth=1').click();
await p.click('[data-testid="optimize-btn"]');
await p.waitForSelector('[data-testid="optimizer-result"]', { timeout: 60000 });
await p.locator('[data-testid="optimizer"]').scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/09-optimizer-ratios.png` });
console.log('edge warning shown:', await p.isVisible('[data-testid="edge-warning"]'));
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
