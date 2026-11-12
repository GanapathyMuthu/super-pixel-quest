// Runs the AI agent (no cheats) through every level several times and reports results.
// Usage: node tools/ai-benchmark.js [runs]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 0 }) : noop), set: (t, k, v) => ((t[k] = v), true) });
const makeEl = () => ({ width: 0, height: 0, style: {}, getContext: () => ctx2d, addEventListener: noop });
let rafCb = null;
const { performance } = require('perf_hooks');
const sb = {
  console, Math, Date, JSON, Map, Set, Array, Object, String, Number, Proxy, Error,
  performance, innerWidth: 1280, innerHeight: 960,
  document: { getElementById: makeEl, createElement: makeEl }, navigator: { getGamepads: () => [] },
  localStorage: { getItem: () => null, setItem: noop },
  addEventListener: noop, requestAnimationFrame: cb => { rafCb = cb; },
};
sb.window = sb;
vm.createContext(sb);
for (const f of ['audio.js', 'game.js', 'agent.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
const G = sb.Game, g = sb.__game, A = sb.Agent;
let t = 0;
const tick = () => { t += 1000 / 60; const cb = rafCb; rafCb = null; cb(t); };

const runs = +process.argv[2] || 3;
const results = [];
for (let lvl = 0; lvl < G.levels.length; lvl++) {
  for (let r = 0; r < runs; r++) {
    G.startAI(lvl);
    // vary timing between runs: random delay before the agent starts acting
    const delay = Math.floor(Math.random() * 90);
    for (let i = 0; i < 150; i++) tick();
    A.setActive(false); for (let i = 0; i < delay; i++) tick(); A.setActive(true);
    // stop after this level: watch for levelclear or a death
    let deaths = 0, cleared = false, frames = 0, maxPlan = 0, prevState = g.state;
    const startPlans = A.totals.plans, startMs = A.totals.ms;
    while (frames < 60 * 400) {
      tick(); frames++;
      if (A.result) maxPlan = Math.max(maxPlan, A.result.ms);
      if (g.state !== prevState) {
        if (g.state === 'dying') deaths++;
        if (prevState === 'flag') { cleared = true; break; }
        if (g.state === 'gameover') break;
        prevState = g.state;
      }
    }
    const plans = A.totals.plans - startPlans;
    results.push({ level: G.levels[lvl].name, run: r + 1, cleared, deaths, seconds: +(frames / 60).toFixed(1),
      avgPlanMs: +((A.totals.ms - startMs) / Math.max(1, plans)).toFixed(2), maxPlanMs: +maxPlan.toFixed(1) });
  }
}
console.table(results);
const ok = results.filter(r => r.cleared && r.deaths === 0).length;
console.log(`flawless clears: ${ok}/${results.length}`);
