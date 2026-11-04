// Live-path check: enable sound, run a dyno pull (key D), verify the worklet,
// context state, non-silent output and no console errors.
//   node scripts/audio/live-check.mjs http://localhost:5176/
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:5176/';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const warns = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning' && /engine-forge/.test(m.text())) warns.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const reqs = [];
page.on('request', (r) => { if (/worklet/.test(r.url())) reqs.push(r.url()); });
await page.goto(base);
await page.waitForSelector('[data-testid="audio-toggle"]');
await page.click('[data-testid="audio-toggle"]');
await page.waitForFunction(() => !!window.__engineForgeAudio, null, { timeout: 10000 });
await page.waitForTimeout(800);
const info = await page.evaluate(() => ({ mode: window.__engineForgeAudio.mode, state: window.__engineForgeAudio.ctx.state, sr: window.__engineForgeAudio.ctx.sampleRate }));
const rmsIdle = await page.evaluate(() => window.__engineForgeAudio.rms());
await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.keyboard.press('d');
const samples = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(500);
  samples.push(await page.evaluate(async () => ({ rms: window.__engineForgeAudio.rms(), stats: await window.__engineForgeAudio.stats() })));
}
const maxRms = Math.max(...samples.map((s) => s.rms));
const maxRpm = Math.max(...samples.map((s) => s.stats?.rpm ?? 0));
console.log(JSON.stringify({ base, ...info, workletRequests: reqs, rmsIdle, maxRms, maxRpm, limiterSeen: samples.some((s) => s.stats?.limiter), errors, warns }, null, 1));
await browser.close();
const ok = info.mode === 'worklet' && info.state === 'running' && maxRms > 1e-3 && errors.length === 0;
console.log(ok ? 'LIVE CHECK PASS' : 'LIVE CHECK FAIL');
process.exit(ok ? 0 : 1);
