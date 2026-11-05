// Screenshot every panel/tab/modal. Usage: node tests/e2e-ui/theme-shots.mjs <outDir> [baseUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const out = process.argv[2] ?? 'tests/e2e-ui/screenshots/light-theme';
const base = process.argv[3] ?? 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
for (const [w, h] of [[1440, 900], [1280, 720]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => localStorage.clear());
  await p.goto(base);
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.waitForTimeout(1500);
  const s = async (n) => p.screenshot({ path: `${out}/${w}-${n}.png` });
  await s('01-default');
  for (const t of ['block', 'heads', 'induction', 'exhaust', 'fuel', 'materials']) {
    await p.click(`[data-testid="tab-${t}"]`);
    await p.waitForTimeout(250);
    await s(`02-tab-${t}`);
  }
  await p.click('[data-testid="preset-button"]');
  await p.waitForTimeout(250);
  await s('03-presets');
  await p.keyboard.press('Escape');
  await p.mouse.click(700, 400);
  await p.click('[data-testid="garage-btn"]');
  await p.waitForTimeout(250);
  await s('04-garage');
  await p.click('[data-testid="garage-save-0"]');
  await p.waitForTimeout(250);
  await s('05-garage-saved');
  await p.mouse.click(700, 400);
  await p.click('[data-testid="snapshot-btn"]');
  await p.click('[data-testid="dyno-pull"]');
  await p.waitForTimeout(3000);
  await s('06-dyno-pull');
  await p.waitForTimeout(6000);
  await p.hover('[data-testid="dyno-chart"]', { position: { x: 300, y: 80 } });
  await p.waitForTimeout(200);
  await s('07-chart-hover');
  const al = p.locator('[data-testid="hud-alerts"]');
  if (await al.count()) {
    await al.first().click();
    await p.waitForTimeout(250);
    await s('08-alerts');
  }
  await p.click('[data-testid="tab-induction"]');
  await p.click('[data-testid="viewmode"] button:has-text("X-ray")');
  await p.waitForTimeout(500);
  await s('09-xray');
  await p.click('button[aria-label="Collapse panel"]');
  await p.waitForTimeout(500);
  await s('10-collapsed');
  await ctx.close();
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
