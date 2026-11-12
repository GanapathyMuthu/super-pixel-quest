// Super Pixel Quest — AI player agent
// A perceive -> plan -> act agent that plays the game through the same controls a human uses.
//   Perceive: snapshot the hero's physics state and the enemies around the screen.
//   Plan:     A* search over sequences of button presses. Every candidate is played forward with the
//             engine's own playerPhysics() and collision code, against predicted enemy positions,
//             so the plan respects the real jump arcs, momentum, corner correction, etc.
//   Act:      hold the first planned action for a few frames, then replan from the new real state.
// Loaded after game.js; uses its globals (game, input, playerPhysics, ctx, text, enemy classes).
'use strict';

const Agent = (() => {
  const MACRO = 4;              // frames each planned action is held
  const MAX_NODES = 2500;       // search expansions per plan
  const BUDGET_MS = 10;         // wall-clock cap per plan
  const LOOKAHEAD = 176;        // plan this many px ahead of the hero
  const H_WEIGHT = 1.4;         // weighted A*: trades optimality for speed
  const ACTIONS = [
    { right: 1, run: 1 },
    { right: 1, run: 1, jump: 1 },
    { left: 1, run: 1 },
    { left: 1, run: 1, jump: 1 },
    { jump: 1 },
    {},
  ];
  const NAMES = { Goomba: 'WALKER', Koopa: 'SHELLBACK', Shell: 'SHELL', Beetle: 'BEETLE', Frog: 'FROG', Plant: 'PLANT', Fireball: 'FIREBALL' };

  // ---------------------------------------------------------------- min-heap for the open list
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) {
      const a = this.a; a.push(n);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l].f < a[m].f) m = l;
          if (r < a.length && a[r].f < a[m].f) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  // ---------------------------------------------------------------- perception
  function cloneBody(p) {
    return {
      x: p.x, y: p.y, w: p.w, h: p.h, vx: p.vx, vy: p.vy, onGround: p.onGround, hitWall: false,
      facing: p.facing, coyote: p.coyote, jumpBuf: p.jumpBuf, cornerCorrect: true,
    };
  }

  function snapshotEnemies(hero) {
    const out = [];
    const lo = game.camX - 32, hi = game.camX + VW + LOOKAHEAD;
    for (const e of game.enemies) {
      if (!e.alive || e.x + e.w < lo || e.x > hi) continue;
      if (out.length >= 30) break;   // fits the 'killed' bitmask
      const s = {
        x: e.x, y: e.y, w: e.w, h: e.h, vx: e.vx, vy: 0, kind: 'walk',
        name: NAMES[e.constructor.name] || 'ENEMY', stompable: true, kickable: false, ref: e,
      };
      if (e instanceof Plant) {
        Object.assign(s, { kind: 'plant', stompable: false, top: e.top, phase: e.phase, timer: e.timer, emerged: e.emerged });
      } else if (e instanceof Fireball) {
        Object.assign(s, { kind: 'fly', stompable: false, vy: e.vy });
      } else if (e instanceof Frog) {
        Object.assign(s, { kind: 'frog', grounded: e.onGround, timer: e.timer });
      } else if (e instanceof Shell && !e.moving) {
        Object.assign(s, { kickable: true, vx: 0 });
      }
      s.reactive = e instanceof Frog || e instanceof Beetle;
      if (s.kind === 'walk' || s.kind === 'frog') buildTrack(s, e, hero);
      out.push(s);
    }
    return out;
  }

  // Roll each enemy's own movement rules forward (walls, gravity, ledge turning, chasing, frog leaps)
  // against the current level, assuming the hero stays roughly where it is.
  const HORIZON = 200;
  function buildTrack(s, e, hero) {
    const sim = { x: e.x, y: e.y, w: e.w, h: e.h, vx: e.vx, vy: e.vy, onGround: e.onGround, hitWall: false, dead: false };
    const xs = new Float32Array(HORIZON + 1), ys = new Float32Array(HORIZON + 1);
    let timer = e.timer || 0, think = e.think || 0;
    const hx = hero.x + hero.w / 2;
    for (let t = 0; t <= HORIZON; t++) {
      xs[t] = sim.x; ys[t] = sim.y;
      if (sim.dead) continue;
      if (e instanceof Frog) {
        if (sim.onGround) {
          sim.vx = 0;
          const dx = hx - (sim.x + sim.w / 2);
          if (--timer <= 0 && Math.abs(dx) < 170) {
            sim.vy = hero.y + hero.h < sim.y ? -6.2 : -5;
            sim.vx = Math.sign(dx) * Math.min(1.6, Math.abs(dx) / 40 + 0.6);
            timer = 55; sim.onGround = false;
          }
        }
        walkerPhysics(sim, 0.25);
        continue;
      }
      if (e instanceof Beetle && --think <= 0 && sim.onGround) {
        think = 20;
        const dx = hx - (sim.x + sim.w / 2);
        if (Math.abs(dx) < 112 && Math.abs(dx) > 6) sim.vx = Math.sign(dx) * 0.95;
      }
      if ((e instanceof Beetle || (e instanceof Koopa && e.red)) && ledgeAhead(sim)) sim.vx = -sim.vx;
      walkerPhysics(sim);
    }
    s.xs = xs; s.ys = ys;
  }

  // Predicted hitbox of enemy s, t frames from now (null = harmless at that time)
  const box = { x: 0, y: 0, w: 0, h: 0 };
  function predict(s, t, heroCx, ignorePlants, exact = false) {
    if (s.kind === 'plant') {
      if (ignorePlants) return null;
      let em;
      if (s.phase === 'up') em = t < s.timer ? 24 : 24 - (t - s.timer) * 0.5;
      else if (s.phase === 'rising') em = s.emerged + t * 0.5;
      else if (s.phase === 'sinking') em = s.emerged - t * 0.5;
      else em = t > s.timer + 6 && Math.abs(heroCx - (s.x + s.w / 2)) > 30 ? (t - s.timer) * 0.5 : 0;
      em = Math.min(24, em);
      if (em <= 1) return null;
      box.x = s.x; box.w = s.w; box.y = s.top - em; box.h = em;
      return box;
    }
    if (s.xs) {
      const i = Math.min(t, HORIZON);
      // Uncertainty grows with time; enemies that react to the hero (frogs, chasing beetles) get more
      const m = exact ? 0 : s.reactive ? Math.min(10, t * 0.2) : Math.min(4, t * 0.05);
      box.x = s.xs[i] - m; box.w = s.w + 2 * m;
      box.y = s.ys[i] - m * 0.5; box.h = s.h + m * 0.5;
      return box;
    }
    box.x = s.x + s.vx * t - 1; box.w = s.w + 2;
    box.y = s.y + s.vy * t - 1; box.h = s.h + 2;
    return box;
  }
  const hits = overlap;   // the engine's own AABB test, so simulated contacts match real ones

  // ---------------------------------------------------------------- planning
  function simulate(n, ai, env) {
    const act = ACTIONS[ai];
    const b = Object.assign({}, n.b);
    let prevJump = n.prevJump, t = n.t, killed = n.killed, stomp = n.stomp, penalty = n.penalty || 0;
    const pts = [];
    for (let f = 0; f < MACRO; f++) {
      const jump = !!act.jump;
      const prevBottom = b.y + b.h;
      playerPhysics(b, { left: !!act.left, right: !!act.right, run: !!act.run, jump, jumpPressed: jump && !prevJump });
      prevJump = jump; t++;
      if (b.y > VH) return null;                                      // fell into a pit
      pts.push(b.x + b.w / 2, b.y + b.h);
      if (t < env.safeFor) continue;                                  // star / invulnerability
      const cx = b.x + b.w / 2;
      for (let i = 0; i < env.enemies.length; i++) {
        if (killed & (1 << i)) continue;
        const s = env.enemies[i];
        const o = predict(s, t, cx, env.ignorePlants);
        if (!o || !hits(b, o)) continue;
        if (s.kickable) {                                             // touching an idle shell kicks it...
          if (!(killed & (1 << i))) penalty += 90;                    // ...but it will ricochet back: avoid if possible
          killed |= 1 << i;
          continue;
        }
        if (s.stompable && b.vy > 0) {
          const oy = o.y, ex = predict(s, t, cx, false, true);        // stomps only count on the exact box
          if (hits(b, ex) && prevBottom <= ex.y + 6) {                // stomp!
            killed |= 1 << i;
            b.y = ex.y - b.h; b.vy = jump ? -5.5 : -3.5;
            if (!stomp) stomp = s;
            continue;
          }
          if (prevBottom <= oy + 6) continue;                         // still above it: not a hit yet
        }
        return null;                                                  // would get hurt
      }
    }
    return { b, prevJump, t, killed, stomp, penalty, parent: n, action: ai, pts, f: 0 };
  }

  function plan(p, env, budgetMs = BUDGET_MS) {
    const t0 = performance.now();
    const L = game.level;
    const flagTrigger = L.flagX !== null ? L.flagX * TILE + 7 - p.w + 1 : Infinity;
    const goalX = Math.min(p.x + LOOKAHEAD, flagTrigger, L.w * TILE - p.w);
    const h = n => Math.max(0, goalX - n.b.x) / 2.5;
    const start = { b: cloneBody(p), prevJump: !!input.jump, t: 0, killed: 0, stomp: null, parent: null, action: -1, pts: [], f: 0 };
    start.f = h(start) * H_WEIGHT;

    const open = new Heap();
    open.push(start);
    const seen = new Set();
    const explored = [];
    let best = start, found = null, expanded = 0;
    while (open.size && expanded < MAX_NODES) {
      if ((expanded & 31) === 0 && performance.now() - t0 > budgetMs) break;
      const n = open.pop();
      if (n.b.x >= goalX) { found = n; break; }
      expanded++;
      if (explored.length < 1200) explored.push(n.b.x + n.b.w / 2, n.b.y + n.b.h);
      let survivors = 0;
      for (let a = 0; a < ACTIONS.length; a++) {
        const c = simulate(n, a, env);
        if (!c) continue;
        const key = ((c.b.x / 2) | 0) + ',' + ((c.b.y / 2) | 0) + ',' + Math.round(c.b.vx * 2) + ',' +
          Math.round(c.b.vy) + ',' + (c.prevJump ? 1 : 0) + ',' + c.killed;
        if (seen.has(key)) continue;
        seen.add(key);
        // Prefer safe footing: tiny cost for ending a step mid-air, lets ties favour landed states
        c.f = c.t + h(c) * H_WEIGHT + (c.b.onGround ? 0 : 0.5) + c.penalty;
        open.push(c);
        survivors++;
      }
      // Fallback target if the goal isn't reached: the most advanced node proven to have a way on
      // (at least one surviving child), so we never commit to a doomed mid-air state
      if (survivors && n !== start) {
        const hn = h(n), hb = best === start ? Infinity : h(best);
        if (hn < hb || (hn === hb && n.t < best.t)) best = n;
      }
    }
    const end = found || best;
    const actions = [], path = [];
    for (let n = end; n && n.parent; n = n.parent) { actions.unshift(n.action); path.unshift(n.pts); }
    return {
      actions, path: [].concat(...path), explored, goalX, reached: !!found, stomp: end.stomp,
      expanded, ms: performance.now() - t0,
    };
  }

  // When every plan gets hurt, pick the action that stays safe the longest when held
  function survivalFallback(p, env) {
    let bestA = 5, bestT = -1;
    const root = { b: cloneBody(p), prevJump: !!input.jump, t: 0, killed: 0, stomp: null, parent: null, action: -1, pts: [] };
    for (let a = 0; a < ACTIONS.length; a++) {
      let n = root, steps = 0;
      while (n && steps < 15) { n = simulate(n, a, env); if (n) steps++; }
      if (steps > bestT) { bestT = steps; bestA = a; }
    }
    return bestA;
  }

  // ---------------------------------------------------------------- reasoning label (for the overlay)
  function describe(p, result, env) {
    if (result.fallback) return 'CORNERED - BUYING TIME';
    if (env.safeFor > 60) return 'INVINCIBLE - CHARGING THROUGH';
    if (result.stomp && Math.abs(result.stomp.x - p.x) < 96) return 'STOMPING ' + result.stomp.name;
    let near = null, nd = 1e9;
    for (const s of env.enemies) {
      const d = s.x - p.x;
      if (d > -24 && d < 88 && Math.abs(d) < nd && !s.kickable) { near = s; nd = Math.abs(d); }
    }
    if (near) return 'DODGING ' + near.name;
    const L = game.level, tx = Math.floor((p.x + p.w / 2) / TILE);
    for (let i = 1; i <= 4; i++) if (L.get(tx + i, 13) === '.' && L.get(tx + i, 14) === '.') return 'LEAPING A GAP';
    const ty = Math.floor((p.y + p.h - 1) / TILE);
    for (let i = 1; i <= 3; i++) if (SOLID.has(L.get(tx + i, ty))) return 'CLIMBING OBSTACLE';
    if (L.flagX !== null && L.flagX * TILE - p.x < 200) return 'GOING FOR THE FLAG';
    return result.reached ? 'RUNNING - PATH CLEAR' : 'EXPLORING';
  }

  // ---------------------------------------------------------------- agent loop
  const A = {
    active: false,
    current: {}, frame: 0, result: null, thought: '', bestX: 0, stuck: 0, ignorePlants: 0,
    totals: { plans: 0, ms: 0 },
    setActive(on) {
      this.active = !!on;
      this.current = {}; this.frame = 0; this.result = null; this.stuck = 0; this.bestX = 0; this.ignorePlants = 0;
    },
    // Called by the engine once per tick while the agent is in control; returns the buttons to hold
    // Fresh level or respawn: forget progress tracking and the old plan
    onLevelStart() {
      this.current = {}; this.frame = 0; this.result = null; this.stuck = 0; this.ignorePlants = 0;
      this.bestX = game.player ? game.player.x : 0;
    },
    decide() {
      if (game.state !== 'play' || game.paused || game.freeze > 0 || !game.player) {
        this.frame = 0; this.current = {};      // replan immediately when control resumes
        return {};
      }
      const p = game.player;
      // Stuck detection: if no forward progress for 3 s, stop fearing hidden plants for a while
      if (p.x > this.bestX + 4) { this.bestX = p.x; this.stuck = 0; } else if (++this.stuck > 180) {
        this.stuck = 0; this.ignorePlants = 90;
      }
      if (this.ignorePlants > 0) this.ignorePlants--;
      if (this.frame % MACRO === 0) {
        const env = {
          enemies: snapshotEnemies(p),
          safeFor: Math.max(p.star, p.invuln),
          ignorePlants: this.ignorePlants > 0,
        };
        const r = plan(p, env);
        if (!r.actions.length) { r.actions.push(survivalFallback(p, env)); r.fallback = true; }
        this.result = r;
        this.env = env;
        this.thought = describe(p, r, env);
        this.current = r.actions.length ? ACTIONS[r.actions[0]] : {};
        this.totals.plans++; this.totals.ms += r.ms;
      }
      this.frame++;
      return this.current;
    },
    drawOverlay(camX) {
      const r = this.result;
      if (!r || game.state !== 'play') return;
      // explored search nodes
      ctx.fillStyle = 'rgba(80, 220, 255, 0.45)';
      for (let i = 0; i < r.explored.length; i += 2) ctx.fillRect(Math.round(r.explored[i] - camX), Math.round(r.explored[i + 1]) - 1, 1, 1);
      // enemies the agent is reasoning about (red = threat, green = stomp target)
      for (const s of this.env.enemies) {
        const e = s.ref;
        const target = r.stomp && r.stomp.ref === e;
        ctx.strokeStyle = target ? '#40ff60' : s.kickable ? '#fcd848' : '#ff4040';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(e.x - camX) + 0.5, Math.round(e.y) + 0.5, e.w, Math.max(1, e.h));
      }
      // chosen trajectory
      ctx.fillStyle = r.reached ? '#fcd848' : '#ff9040';
      for (let i = 0; i < r.path.length; i += 2) ctx.fillRect(Math.round(r.path[i] - camX) - 1, Math.round(r.path[i + 1]) - 2, 2, 2);
      // goal marker
      const gx = Math.round(r.goalX + game.player.w / 2 - camX);
      ctx.fillStyle = 'rgba(255, 80, 255, 0.7)';
      for (let y = 40; y < 208; y += 6) ctx.fillRect(gx, y, 1, 3);
    },
    drawBadge() {
      const r = this.result;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(4, 28, 150, r ? 27 : 12);
      ctx.fillStyle = (game.frame >> 4) & 1 ? '#ff4040' : '#801010';
      ctx.fillRect(8, 31, 4, 4);
      text('AI AGENT IN CONTROL', 15, 29, '#80d0ff', 'left', 7);
      if (!r) return;
      text(this.thought, 8, 37, '#fcd848', 'left', 7);
      text(`A* ${r.expanded} nodes ${r.ms.toFixed(1)}ms ${r.reached ? 'GOAL OK' : 'BEST EFFORT'}`, 8, 45, '#a0a0a0', 'left', 6);
    },
  };
  return A;
})();
window.Agent = Agent;
