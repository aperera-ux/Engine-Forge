// UI smoke + screenshots. Usage: node tests/e2e-ui/shots.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const out = process.argv[2] ?? 'tests/e2e-ui/out';
const base = process.argv[3] ?? 'http://localhost:5175/';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: process.env.SWIFTSHADER ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${w}x${h}] ${m.text()}`);
  });
  p.on('pageerror', (e) => errors.push(`[${w}x${h}] pageerror ${e.message}`));
  await p.addInitScript(() => localStorage.clear());
  await p.goto(base);
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.waitForTimeout(1500);
  return p;
}

const p = await page(1440, 900);
await p.screenshot({ path: `${out}/01-default-1440.png` });
const scroll = await p.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]);
console.log('scroll size 1440x900:', scroll);

// Preset change
await p.click('[data-testid="preset-button"]');
await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/02-preset-list.png` });
const opts = p.locator('[data-testid="preset-list"] .preset-item');
const n = await opts.count();
console.log('presets:', n);
const target = p.locator('[data-testid="preset-list"] .preset-item', { hasText: /LS3/ });
if (await target.count()) await target.first().click();
else await opts.nth(Math.min(5, n - 1)).click();
await p.waitForTimeout(600);
console.log('name after preset:', await p.locator('.preset-name').textContent());
console.log('kpi power:', await p.locator('[data-testid="kpi-power"] .kpi-v').textContent());

// Snapshot then move slider
await p.click('[data-testid="snapshot-btn"]');
const bore = p.locator('[data-testid="slider-bore"] input[type=range]');
await bore.focus();
for (let i = 0; i < 40; i++) await p.keyboard.press('ArrowRight');
await p.waitForTimeout(300);
console.log('kpi power after bore+:', await p.locator('[data-testid="kpi-power"] .kpi-v').textContent());
console.log('delta:', await p.locator('[data-testid="snapshot-delta"]').first().textContent());

// Dyno pull mid-way
await p.click('[data-testid="dyno-pull"]');
await p.waitForTimeout(3200);
await p.screenshot({ path: `${out}/03-dyno-mid.png` });
await p.waitForTimeout(5000);
console.log('rpm after pull:', await p.locator('.rpm-ctl-row .mono').textContent());

// Turbo + imperial + cutaway
await p.click('[data-testid="tab-induction"]');
await p.click('[data-testid="induction-seg"] button:has-text("Turbo")');
await p.click('[data-testid="units"] button:has-text("Imperial")');
await p.click('[data-testid="viewmode"] button:has-text("Cutaway")');
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/04-turbo-imperial.png` });

// Valve too big
await p.click('[data-testid="tab-heads"]');
const iv = p.locator('[data-testid="slider-intake-valve"] input.num-input');
await iv.fill('2.4');
await iv.press('Enter');
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/05-heads-valvefit.png` });

// Collapse panel
await p.click('button[aria-label="Collapse panel"]');
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/06-collapsed.png` });

// Audio toggle (just ensure no errors)
await p.click('[data-testid="audio-toggle"]');
await p.waitForTimeout(400);
await p.click('[data-testid="audio-toggle"]');

const p2 = await page(1280, 800);
await p2.screenshot({ path: `${out}/07-default-1280.png` });
console.log('scroll size 1280x800:', await p2.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]));

console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
await browser.close();
