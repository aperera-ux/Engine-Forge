// Layout probe for the demo path: top bar overlap and Diagnostics height at 1280 / 1440, worst cases.
// Usage: node tests/e2e-ui/demo-layout.mjs http://localhost:5291/ tests/e2e-ui/screenshots/demo-path
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
for (const [width, height] of [[1440, 900], [1280, 800]]) {
  const p = await (await browser.newContext({ viewport: { width, height } })).newPage();
  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('[data-testid="dyno-chart"] svg');
  await p.click('[data-testid="preset-button"]');
  await p.click('.preset-item:has-text("drag build")');
  await p.waitForTimeout(400);
  for (let i = 0; i < 3; i++) await p.click('[data-testid="snapshot-btn"]');
  await p.click('[data-testid="tab-calibrate"]');
  await p.selectOption('.cal select', 'ls3_crank_lbft_hp.csv').catch(() => {});
  const overlap = await p.evaluate(() => {
    const kids = [...document.querySelector('.topbar').children].filter((e) => e.getBoundingClientRect().width > 0);
    const rs = kids.map((e) => [e.className || e.tagName, e.getBoundingClientRect()]);
    const bad = [];
    for (let i = 0; i < rs.length - 1; i++) if (rs[i][1].right > rs[i + 1][1].left + 0.5) bad.push(`${rs[i][0]} / ${rs[i + 1][0]}`);
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    if (rs.length && rs[rs.length - 1][1].right > tb.right + 0.5) bad.push('last item past right edge');
    return bad;
  });
  ok(overlap.length === 0, `${width} top bar has no overlap ${overlap.join('; ')}`);
  const diag = await p.evaluate(() => {
    const w = document.querySelector('[data-testid="warnings"]');
    const ul = w.querySelector('ul');
    const items = [...w.querySelectorAll('.warn-item')];
    const wr = w.getBoundingClientRect();
    return { h: Math.round(wr.height), items: items.length, visible: items.filter((e) => e.getBoundingClientRect().bottom <= wr.bottom + 1).length, kpisH: Math.round(document.querySelector('.kpis').getBoundingClientRect().height), kpisScroll: document.querySelector('.kpis').scrollHeight };
  });
  console.log(width, 'diagnostics', JSON.stringify(diag));
  ok(diag.items < 2 || diag.visible >= 2, `${width} at least 2 diagnostics visible (${diag.visible}/${diag.items})`);
  await p.screenshot({ path: `${out}/${width}_10_engine_diagnostics.png` });
}
await browser.close();
process.exit(fails ? 1 : 0);
