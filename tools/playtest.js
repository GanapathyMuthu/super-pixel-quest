// End-to-end playtest in real Chrome via Playwright: drives the actual GUI like a player,
// checks the main flows, watches the AI agent play the whole game, and records video + screenshots.
// Usage: node tools/playtest.js            (outputs to submission/)
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const out = path.join(root, 'submission');
const url = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');
const results = [];
const check = (ok, name, detail = '') => { results.push({ ok, name, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    recordVideo: { dir: path.join(out, 'raw-video'), size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = name => page.screenshot({ path: path.join(out, name) });
  const state = () => page.evaluate(() => Game.getState());
  const waitState = async (s, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await state()) === s) return true; await sleep(100); }
    return false;
  };
  const btn = name => page.getByRole('button', { name, exact: true });

  await page.goto(url);
  await sleep(1500);
  check(await state() === 'menu', 'boots into main menu');
  await shot('01-main-menu.png');

  // Settings screen
  await btn('Settings').click();
  await sleep(400);
  await shot('02-settings.png');
  await page.keyboard.press('Escape');
  await sleep(300);

  // Human play: real keyboard input must reach the engine
  await btn('Play').click();
  check(await waitState('play', 5000), 'Play starts level 1-1');
  const x0 = await page.evaluate(() => __game.player.x);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ShiftLeft');
  await sleep(900);
  await page.keyboard.press('Space');
  await sleep(250);
  const p1 = await page.evaluate(() => ({ x: __game.player.x, ground: __game.player.onGround }));
  await shot('03-gameplay-human.png');
  await sleep(500);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ShiftLeft');
  check(p1.x > x0 + 40, 'keyboard moves the hero', `x ${Math.round(x0)} -> ${Math.round(p1.x)}`);
  check(!p1.ground, 'Space makes the hero jump');

  // Pause menu, then hand control to the AI from it
  await page.keyboard.press('Escape');
  await sleep(400);
  check(await page.evaluate(() => Game.isPaused()), 'Esc opens the pause menu');
  await shot('04-pause-menu.png');
  await btn('Let AI Play').click();
  await sleep(500);
  check(await page.evaluate(() => Game.isAgent() && !Game.isPaused()), 'pause menu hands control to the AI');
  await sleep(4000);
  await shot('05-ai-takeover-overlay.png');

  // Full AI run from the main menu: watch it play the whole game
  await page.evaluate(() => Game.quitToMenu());
  await sleep(800);
  await page.evaluate(() => {
    window.__deaths = 0; window.__clears = 0;
    Game.on('statechange', s => { if (s === 'dying') window.__deaths++; });
    Game.on('levelclear', () => { window.__clears++; });
  });
  await btn('Watch AI Play').click();
  check(await waitState('play', 5000), 'Watch AI Play starts an AI run');
  await sleep(9000);
  await shot('06-ai-agent-level1.png');
  const t0 = Date.now();
  let caveShot = false;
  while (Date.now() - t0 < 180000) {
    const s = await page.evaluate(() => ({ st: Game.getState(), lvl: Game.getStats().levelIndex }));
    if (!caveShot && s.lvl === 1 && s.st === 'play') { await sleep(9000); await shot('07-ai-agent-cave.png'); caveShot = true; }
    if (s.st === 'win' || s.st === 'gameover') break;
    await sleep(250);
  }
  const fin = await page.evaluate(() => ({ st: Game.getState(), deaths: window.__deaths, clears: window.__clears, stats: Game.getStats() }));
  await sleep(1200);
  await shot('08-victory.png');
  check(fin.st === 'win', 'AI agent beats the whole game', `score ${fin.stats.score}`);
  check(fin.deaths === 0, 'AI agent never dies', `${fin.deaths} deaths`);
  check(fin.stats.ai === true, 'AI run is flagged (no high score)');
  check(errors.length === 0, 'no JS errors in the console', errors.slice(0, 3).join(' | '));

  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const raw = await video.path();
    fs.copyFileSync(raw, path.join(out, 'gameplay-ai-run.webm'));
    fs.rmSync(path.join(out, 'raw-video'), { recursive: true, force: true });
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Output: ${out}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
