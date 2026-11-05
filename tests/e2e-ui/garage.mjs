// Garage: save 3 custom engines, persistence across reload, load back, rename, overwrite confirm, clear, Cmd+S.
import { chromium } from '@playwright/test';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'tests/e2e-ui/screens';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
await p.goto(base);
await p.evaluate(() => localStorage.removeItem('engine-forge:garage:v1'));
await p.reload();
await p.waitForSelector('[data-testid="dyno-chart"] svg');
ok((await p.textContent('[data-testid="garage-btn"]')).includes('0/3'), 'starts empty 0/3');

// slot 1: custom V12
await p.fill('.hud-name', 'My V12 build');
await p.click('[data-testid="layout-seg"] button:has-text("Vee")');
await p.click('[data-testid="cyl-chips"] button:has-text("12")');
await p.click('[data-testid="garage-btn"]');
await p.click('[data-testid="garage-save-0"]');
await p.screenshot({ path: `${out}/garage_one.png` });
// slot 2: a preset, modified
await p.click('[data-testid="preset-button"]');
await p.click('.preset-item:has-text("K20")');
await p.click('[data-testid="garage-btn"]');
await p.click('[data-testid="garage-save-1"]');
ok((await p.textContent('[data-testid="garage-btn"]')).includes('2/3'), 'two saved 2/3');
// slot 3 via Cmd+S on a third engine
await p.click('[data-testid="preset-button"]');
await p.click('.preset-item:has-text("LS3")');
await p.keyboard.press('Meta+s');
await p.waitForTimeout(200);
ok((await p.textContent('[data-testid="garage-btn"]')).includes('3/3'), 'Cmd+S filled slot 3');
// Cmd+S with full garage and a new engine opens the garage with a note
await p.click('[data-testid="preset-button"]');
await p.click('.preset-item:has-text("F136")');
await p.keyboard.press('Meta+s');
await p.waitForTimeout(200);
ok(await p.isVisible('.gar-note'), 'full garage: Cmd+S opens picker with note');
await p.screenshot({ path: `${out}/garage_full.png` });
// overwrite needs two clicks
await p.click('[data-testid="garage-overwrite-2"]');
ok((await p.textContent('[data-testid="garage-overwrite-2"]')).includes('Replace?'), 'overwrite arms first');
await p.click('[data-testid="garage-overwrite-2"]');
ok((await p.textContent('[data-testid="garage-slot-2"]')).includes('F136') || (await p.textContent('[data-testid="garage-slot-2"]')).includes('458'), 'slot 3 overwritten with F136');

// reload → persisted
await p.reload();
await p.waitForSelector('[data-testid="dyno-chart"] svg');
ok((await p.textContent('[data-testid="garage-btn"]')).includes('3/3'), 'persisted across reload');
// load slot 1 back → V12 config returns
await p.click('[data-testid="garage-btn"]');
await p.click('[data-testid="garage-load-0"]');
await p.waitForTimeout(300);
ok((await p.inputValue('.hud-name')) === 'My V12 build', 'load restores name');
ok((await p.locator('[data-testid="cyl-chips"] button.on, [data-testid="cyl-chips"] button[aria-pressed="true"]').first().textContent())?.includes('12'), 'load restores 12 cylinders');
// edit → "edited" badge
await p.click('[data-testid="cyl-chips"] button:has-text("8")');
await p.click('[data-testid="garage-btn"]');
ok((await p.textContent('[data-testid="garage-slot-0"]')).toLowerCase().includes('edited'), 'edited badge after change');
// rename slot 2
await p.click('[data-testid="garage-slot-1"] .gar-name');
await p.fill('[data-testid="garage-slot-1"] .gar-rename', 'Track K20');
await p.keyboard.press('Enter');
ok((await p.textContent('[data-testid="garage-slot-1"]')).includes('Track K20'), 'rename');
await p.screenshot({ path: `${out}/garage_open.png` });
// clear slot 2 (two clicks)
await p.click('[data-testid="garage-clear-1"]');
await p.click('[data-testid="garage-clear-1"]');
ok((await p.textContent('[data-testid="garage-slot-1"]')).includes('Empty slot'), 'clear');
ok(errs.length === 0, 'no page errors ' + errs.join('; '));
await browser.close();
