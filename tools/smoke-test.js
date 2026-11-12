// Headless smoke test: runs game.js (+ audio.js) in Node with a stubbed DOM/canvas
// and simulates play. Usage: node tools/smoke-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const noop = () => {};
const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'measureText') return () => ({ width: 0 });
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; },
});
const makeEl = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d, addEventListener: noop });
const listeners = {};
let rafCb = null;
const sandbox = {
  console, Math, Date, JSON, Map, Set, Array, Object, String, Number, Proxy, Error,
  performance: { now: () => 0 },
  innerWidth: 1280, innerHeight: 960,
  document: { getElementById: makeEl, createElement: makeEl },
  navigator: { getGamepads: () => [] },
  localStorage: { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); } },
  addEventListener: (ev, cb) => (listeners[ev] = listeners[ev] || []).push(cb),
  requestAnimationFrame: cb => { rafCb = cb; },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['audio.js', 'game.js', 'agent.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });

const G = sandbox.Game, g = sandbox.__game;
let t = 0;
const tick = n => { for (let i = 0; i < n; i++) { t += 1000 / 60; const cb = rafCb; rafCb = null; cb(t); } };
const key = (code, down) => (listeners[down ? 'keydown' : 'keyup'] || []).forEach(cb => cb({ code, preventDefault: noop }));
const events = [];
['statechange', 'pause', 'gameover', 'win', 'levelclear'].forEach(ev => G.on(ev, d => events.push(ev + ':' + (typeof d === 'object' ? JSON.stringify(d) : d))));
const assert = (c, msg) => { if (!c) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); };

// 1. Menu attract mode
tick(120);
assert(g.state === 'menu' && g.camX > 0, 'menu attract mode scrolls');

// 2. Start and play with a simple bot (run right, jump on a rhythm and at walls/gaps)
G.start(0);
tick(160);
assert(g.state === 'play', 'level 1-1 starts after level intro');
key('ArrowRight', true); key('ShiftLeft', true);
let maxX = 0, jumpHeld = 0;
for (let i = 0; i < 60 * 120 && g.state !== 'win' && g.state !== 'gameover'; i++) {
  const p = g.player;
  if (g.state === 'play' && p) {
    maxX = Math.max(maxX, p.x);
    p.star = Math.max(p.star, 2);  // keep the bot invincible to enemies; pits still kill
    const ahead = Math.floor((p.x + p.w + 20) / 16);
    const wall = g.level.get(ahead, Math.floor((p.y + p.h - 1) / 16));
    const gap = g.level.get(ahead, 13) === '.';
    if (!jumpHeld && p.onGround && (wall !== '.' && wall !== 'c' || gap || i % 90 === 0)) { key('Space', true); jumpHeld = 22; }
  }
  if (jumpHeld && --jumpHeld === 0) key('Space', false);
  tick(1);
}
console.log('  bot reached x =', Math.round(maxX), 'state =', g.state, 'score =', g.score, 'lives =', g.lives);
assert(events.some(e => e.startsWith('levelclear')), 'bot cleared at least one level');

// 3. Pause / resume via API
G.start(1); tick(160);
key('ArrowRight', false); key('ShiftLeft', false);
key('Escape', true); tick(2); key('Escape', false);
assert(G.isPaused(), 'Esc pauses during play');
const tBefore = g.time; tick(120);
assert(g.time === tBefore, 'timer frozen while paused');
G.resume(); tick(2);
assert(!G.isPaused(), 'resume works');

// 4. Stress: random input for a long time, catching any exception
for (let i = 0; i < 60 * 300; i++) {
  if (i % 7 === 0) key(['ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'KeyX'][i % 5], Math.random() < 0.6);
  if (g.state === 'gameover' || g.state === 'win') G.start(Math.floor(Math.random() * 2));
  if (g.state === 'play' && g.player && i % 900 === 0) g.player.setBig(!g.player.big);
  tick(1);
}
assert(true, '5 minutes of random play without exceptions');

// 5. Enemy AI behaviour (spawned directly into level 1-2 / 1-1)
G.start(1); tick(160);
key('ArrowRight', false); key('ShiftLeft', false); key('Space', false); key('KeyX', false); key('ArrowLeft', false);
{
  const ctor = name => vm.runInContext(name, sandbox);
  const p = g.player; p.invuln = 99999;
  // red shellback on the brick ledge (row 5, x 38..43) must never fall off
  g.camX = 30 * 16; p.x = 30 * 16; g.enemies = [];
  const red = new (ctor('Koopa'))(40 * 16 + 2, 5 * 16, true); g.enemies.push(red);
  let minX = 1e9, maxX2 = 0;
  for (let i = 0; i < 900; i++) { tick(1); minX = Math.min(minX, red.x); maxX2 = Math.max(maxX2, red.x); }
  assert(red.y + red.h === 80 && minX >= 38 * 16 - 1 && maxX2 <= 44 * 16, 'red shellback patrols ledge without falling (x ' + Math.round(minX) + '..' + Math.round(maxX2) + ')');
  // chaser beetle turns toward the hero
  g.enemies = []; p.x = 100 * 16; p.y = 13 * 16 - p.h; g.camX = 95 * 16;
  const bt = new (ctor('Beetle'))(106 * 16, 13 * 16); bt.vx = 0.4; g.enemies.push(bt);
  tick(40);
  assert(bt.vx < 0 && bt.chasing, 'beetle locks on and chases the hero');
  // frog leaps toward the hero
  g.enemies = [];
  const fr = new (ctor('Frog'))(108 * 16, 13 * 16); g.enemies.push(fr);
  const fx0 = fr.x; let wentUp = false;
  for (let i = 0; i < 150; i++) { tick(1); if (fr.vy < -2) wentUp = true; }
  assert(wentUp && fr.x < fx0, 'frog hops toward the hero');
  // plant hides while the hero is next to its pipe, shoots when hero is away
  g.enemies = []; g.camX = 20 * 16; p.x = 28 * 16 + 10; p.y = (13 - 3) * 16 - p.h;  // standing on pipe 28
  const pl = new (ctor('Plant'))(28, true); g.enemies.push(pl);
  tick(300);
  assert(pl.emerged === 0, 'plant stays hidden while hero is on its pipe');
  p.x = 22 * 16; p.y = 13 * 16 - p.h;
  let shot = false;
  for (let i = 0; i < 400; i++) { tick(1); if (g.enemies.some(e => e.constructor.name === 'Fireball')) shot = true; }
  assert(shot, 'plant rises and spits a fireball at the hero');
}

// 6. Death -> game over flow
G.start(0); tick(160);
g.lives = 1; g.player.y = 400; tick(260);
assert(g.state === 'gameover' && events.some(e => e.startsWith('gameover')), 'falling with 1 life -> game over event');
G.quitToMenu(); tick(2);
assert(g.state === 'menu', 'quit to menu');
console.log('\nevents seen:', [...new Set(events.map(e => e.split(':')[0] + ':' + e.split(':')[1].slice(0, 12)))].join(', '));
console.log('ALL SMOKE TESTS PASSED');
