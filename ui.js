/* Super Pixel Quest - GUI overlay (menus, settings, pause, results, touch controls).
 * Talks to the engine only through window.Game, window.Sound and window.VirtualInput
 * as defined in CONTRACT.md. Must never throw if those are missing. */
(function () {
  'use strict';

  var doc = document;
  var SETTINGS_KEY = 'spq-settings';
  var PROGRESS_KEYS = ['spq-hi', 'spq-unlocked'];
  var GAMEPLAY_STATES = { levelstart: 1, play: 1, dying: 1, flag: 1 };
  var DEFAULTS = { musicVolume: 0.6, sfxVolume: 0.8, scale: 'auto', crt: false, showFps: false, aiOverlay: true };
  var SCALES = ['auto', 1, 2, 3, 4, 5, 6];

  var root = doc.getElementById('ui');
  if (!root) {
    root = doc.createElement('div');
    root.id = 'ui';
    (doc.getElementById('app') || doc.body).appendChild(root);
  }

  /* ---------------------------------------------------------------- helpers */

  function hasGame() {
    var G = window.Game;
    return !!(G && typeof G.on === 'function' && typeof G.start === 'function');
  }

  // Safe call into window.Game; returns undefined on any failure.
  function game(method) {
    var G = window.Game;
    if (!G || typeof G[method] !== 'function') return undefined;
    try {
      return G[method].apply(G, Array.prototype.slice.call(arguments, 1));
    } catch (err) {
      console.error('[ui] Game.' + method + ' failed:', err);
      return undefined;
    }
  }

  function sfx(name) {
    try {
      if (window.Sound && typeof window.Sound.play === 'function') window.Sound.play(name);
    } catch (err) { /* audio is optional */ }
  }

  function soundInit() {
    try {
      if (window.Sound && typeof window.Sound.init === 'function') window.Sound.init();
    } catch (err) { /* audio is optional */ }
  }

  function stats() {
    var s = game('getStats') || {};
    return {
      score: s.score | 0, coins: s.coins | 0, lives: s.lives | 0, hiScore: s.hiScore | 0,
      levelIndex: s.levelIndex | 0, unlocked: s.unlocked | 0, ai: !!s.ai, agent: !!s.agent
    };
  }

  function levels() {
    var L = window.Game && window.Game.levels;
    return Array.isArray(L) ? L : [];
  }

  // AI agent API (agent.js) may be missing or older: feature-detect every call.
  function hasAI() {
    var G = window.Game;
    // window.Agent is what game.js drives; without agent.js the Game.* AI calls are no-ops.
    return !!(G && window.Agent && typeof G.startAI === 'function' && typeof G.setAgent === 'function' && typeof G.isAgent === 'function');
  }
  function isAgent() { return hasAI() && !!game('isAgent'); }
  function toggleAgent() { if (hasAI()) game('setAgent', !isAgent()); }
  function startAI(i) {
    if (!hasAI()) return;
    hideAll();
    game('startAI', i | 0);
    if (game('isPaused')) game('resume');
  }

  function pad6(n) { return String(Math.max(0, n | 0)).padStart(6, '0'); }

  // Tiny element builder: h('div', {class: 'x', onclick: fn}, [children...])
  function h(tag, attrs, children) {
    var el = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c != null) el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return el;
  }

  // Menu button: plays 'select' and runs fn on click (mouse, Enter/Space, gamepad all end in click()).
  function btn(label, fn, cls) {
    var b = h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : '') }, [label]);
    b.addEventListener('click', function () {
      if (b.disabled) return;
      sfx('select');
      fn(b);
    });
    return b;
  }

  /* --------------------------------------------------------------- settings */

  function loadSettings() {
    var s = Object.assign({}, DEFAULTS);
    try {
      var raw = window.localStorage.getItem(SETTINGS_KEY);
      var p = raw ? JSON.parse(raw) : null;
      if (p && typeof p === 'object') {
        if (isFinite(p.musicVolume)) s.musicVolume = Math.min(1, Math.max(0, +p.musicVolume));
        if (isFinite(p.sfxVolume)) s.sfxVolume = Math.min(1, Math.max(0, +p.sfxVolume));
        if (SCALES.indexOf(p.scale) >= 0) s.scale = p.scale;
        s.crt = !!p.crt;
        s.showFps = !!p.showFps;
        if (typeof p.aiOverlay === 'boolean') s.aiOverlay = p.aiOverlay;
      }
    } catch (err) { /* private mode / corrupt data: use defaults */ }
    return s;
  }

  function saveSettings() {
    try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (err) { /* ignore */ }
  }

  function applySettings() {
    game('setSettings', Object.assign({}, settings));
  }

  function resetProgress() {
    try { PROGRESS_KEYS.forEach(function (k) { window.localStorage.removeItem(k); }); } catch (err) { /* ignore */ }
    window.location.reload();
  }

  var settings = loadSettings();

  /* ---------------------------------------------------------- screen system */

  var screens = {};     // name -> { el, back(), onShow(), dim }
  var current = null;   // name of visible screen, or null during gameplay
  var backTo = {};      // sub-screen name -> screen it was opened from
  var lastFocus = {};   // screen name -> element to restore focus to
  var state = 'menu';   // last known engine state
  var syncers = [];     // callbacks that refresh AI-dependent labels
  var shownAt = 0;      // time the current screen opened (ignore keys that predate it)

  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }

  function panel(opts, body, foot) {
    var head = [h('h2', { class: 'title' + (opts.titleClass ? ' ' + opts.titleClass : ''), text: opts.title })];
    if (opts.subtitle) head.push(opts.subtitle);
    return h('div', { class: 'panel' + (opts.size ? ' ' + opts.size : ''), role: 'dialog', 'aria-label': opts.title }, [
      opts.title ? h('div', { class: 'panel-head' }, head) : null,
      h('div', { class: 'panel-body' }, body),
      foot && foot.length ? h('div', { class: 'panel-foot' }, foot) : null
    ]);
  }

  function defineScreen(name, def) {
    screens[name] = def; // register first: builders attach onShow/update hooks to it
    def.el = h('section', { class: 'screen' + (def.dim ? ' dim' : ''), 'data-screen': name, hidden: true }, [def.build()]);
    root.appendChild(def.el);
  }

  function focusables() {
    if (!current) return [];
    var list = screens[current].el.querySelectorAll('button:not([disabled]), input:not([disabled])');
    return Array.prototype.filter.call(list, function (el) { return el.offsetParent !== null || el.getClientRects().length; });
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  // Show a screen. `from` records where Back should return; `fresh` drops remembered focus.
  function show(name, from, fresh) {
    if (!screens[name]) return;
    if (current && current !== name) {
      var active = doc.activeElement;
      if (active && screens[current].el.contains(active)) lastFocus[current] = active;
      screens[current].el.hidden = true;
    }
    if (from !== undefined) backTo[name] = from;
    if (fresh) delete lastFocus[name];
    var already = current === name;
    current = name;
    shownAt = now();
    var s = screens[name];
    syncAI();
    if (s.onShow) s.onShow();
    s.el.hidden = false;
    if (!already) {
      var list = focusables();
      var target = lastFocus[name];
      focusEl(target && list.indexOf(target) >= 0 ? target : list[0]);
    }
    releaseTouch();
    updateTouchUI();
    startPadLoop();
  }

  function hideAll() {
    if (current) screens[current].el.hidden = true;
    current = null;
    if (doc.activeElement && root.contains(doc.activeElement)) doc.activeElement.blur();
    updateTouchUI();
  }

  function back() {
    if (current && screens[current].back) screens[current].back();
  }

  function goBack() { show(backTo[current] || 'menu'); }

  // Walk the "opened from" chain to see whether a screen belongs to the pause menu.
  function rootOf(name) {
    var guard = 0;
    while (name && backTo[name] && name !== 'pause' && name !== 'menu' && guard++ < 8) name = backTo[name];
    return name;
  }

  function navigate(dir) {
    var list = focusables();
    if (!list.length) return;
    var idx = list.indexOf(doc.activeElement);
    var next = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
    if (list[next] !== doc.activeElement) {
      focusEl(list[next]);
      sfx('move');
    }
  }

  // Up/down: scroll a long panel body first (How to Play), otherwise move focus.
  function vertical(dir) {
    var body = current && screens[current].scrollFirst && screens[current].el.querySelector('.panel-body');
    if (body && body.scrollHeight > body.clientHeight + 2) {
      var before = body.scrollTop;
      body.scrollTop += dir * Math.max(24, body.clientHeight * 0.25);
      if (body.scrollTop !== before) return;
    }
    navigate(dir);
  }

  function horizontal(dir) {
    var el = doc.activeElement;
    if (el && el._adjust && root.contains(el)) el._adjust(dir);
    else navigate(dir);
  }

  function activate() {
    var el = doc.activeElement;
    if (!el || !current || !screens[current].el.contains(el)) { navigate(1); return; }
    if (el.tagName === 'BUTTON') el.click();
  }

  /* ---------------------------------------------------------------- screens */

  function buildMenu() {
    var hi = h('span', { text: '000000' });
    screens.menu.onShow = function () { hi.textContent = pad6(stats().hiScore); };
    return panel({ size: 'menu-panel' }, [
      h('h1', { class: 'logo' }, [
        h('span', { class: 'logo-top', text: 'SUPER' }),
        h('span', { class: 'logo-main', text: 'PIXEL QUEST' })
      ]),
      h('p', { class: 'press-start', text: 'PRESS START' }),
      h('nav', { class: 'menu-list', 'aria-label': 'Main menu' }, [
        btn('Play', function () { startLevel(0); }),
        btn('Watch AI Play', function () { startAI(0); }, 'ai-only'),
        btn('Level Select', function () { show('levels', 'menu', true); }),
        btn('Settings', function () { show('settings', 'menu', true); }),
        btn('How to Play', function () { show('help', 'menu', true); })
      ]),
      h('p', { class: 'hiscore' }, ['HI-SCORE ', hi]),
      h('p', { class: 'hint', text: 'Arrows / D-pad move · Enter / ✕ select · Esc / ○ back' })
    ]);
  }

  function buildLevels() {
    var grid = h('div', { class: 'level-grid', role: 'list' });
    screens.levels.onShow = function () {
      var unlocked = stats().unlocked;
      grid.textContent = '';
      levels().forEach(function (lv, i) {
        var locked = i > unlocked;
        var card = btn('', function () { startLevel(i); }, 'card' + (locked ? ' locked' : ''));
        card.setAttribute('role', 'listitem');
        card.appendChild(h('span', { class: 'card-name', text: (lv && lv.name) || String(i + 1) }));
        card.appendChild(h('span', { class: 'card-title', text: (lv && lv.title) || '' }));
        if (locked) {
          card.disabled = true;
          card.setAttribute('aria-label', 'Level ' + ((lv && lv.name) || i + 1) + ' locked');
          card.appendChild(h('span', { class: 'lock', 'aria-hidden': 'true' }));
        } else {
          card.appendChild(h('span', { class: 'card-tag', text: i === unlocked ? 'NEW' : 'CLEAR' }));
        }
        grid.appendChild(card);
      });
      if (!grid.children.length) grid.appendChild(h('p', { class: 'message', text: 'No levels available.' }));
    };
    return panel({ title: 'LEVEL SELECT', size: 'wide' }, [grid], [btn('Back', goBack, 'alt')]);
  }

  function volumeRow(label, key) {
    var id = 'set-' + key;
    var value = h('span', { class: 'value' });
    var input = h('input', { id: id, type: 'range', min: '0', max: '100', step: '5' });
    function set(v, preview) {
      v = Math.min(100, Math.max(0, Math.round(v)));
      input.value = String(v);
      value.textContent = v + '%';
      settings[key] = v / 100;
      applySettings();
      saveSettings();
      if (preview) sfx(key === 'sfxVolume' ? 'coin' : 'move');
    }
    input.addEventListener('input', function () { set(+input.value, false); });
    input.addEventListener('change', function () { set(+input.value, true); });
    input._adjust = function (dir) { set(+input.value + dir * 10, true); };
    input._sync = function () { input.value = String(Math.round(settings[key] * 100)); value.textContent = input.value + '%'; };
    return [h('label', { for: id, text: label }), h('div', { class: 'control' }, [input, value])];
  }

  function choiceRow(label, getText, change) {
    var b = btn('', function () { change(1); sync(); }, 'stepper');
    function sync() { b.textContent = getText(); }
    b._adjust = function (dir) { change(dir); sync(); sfx('move'); };
    b._sync = sync;
    return [h('span', { class: 'label', text: label }), h('div', { class: 'control' }, [b])];
  }

  function toggleRow(label, key, cls) {
    var b = btn('', function () { flip(); }, 'toggle' + (cls ? ' ' + cls : ''));
    function sync() {
      b.textContent = settings[key] ? 'ON' : 'OFF';
      b.setAttribute('aria-pressed', settings[key] ? 'true' : 'false');
    }
    function flip() { settings[key] = !settings[key]; applySettings(); saveSettings(); sync(); }
    b._adjust = function () { flip(); sfx('move'); };
    b._sync = sync;
    b.setAttribute('aria-label', label);
    return [h('span', { class: 'label' + (cls ? ' ' + cls : ''), text: label }),
            h('div', { class: 'control' + (cls ? ' ' + cls : '') }, [b])];
  }

  function buildSettings() {
    var rows = [].concat(
      volumeRow('Music', 'musicVolume'),
      volumeRow('Sound FX', 'sfxVolume'),
      choiceRow('Display', function () {
        return '◀ ' + (settings.scale === 'auto' ? 'AUTO' : settings.scale + 'X') + ' ▶';
      }, function (dir) {
        var i = SCALES.indexOf(settings.scale);
        settings.scale = SCALES[(Math.max(0, i) + dir + SCALES.length) % SCALES.length];
        applySettings();
        saveSettings();
      }),
      toggleRow('CRT Scanlines', 'crt'),
      toggleRow('Show FPS', 'showFps'),
      toggleRow('AI Plan Overlay', 'aiOverlay', 'ai-only'),
      [h('div', { class: 'settings-sep' }),
       h('div', { class: 'reset-row' }, [btn('Reset Progress', function () { show('confirm', 'settings', true); }, 'alt')])]
    );
    var grid = h('div', { class: 'settings-grid' }, rows);
    screens.settings.onShow = function () {
      Array.prototype.forEach.call(grid.querySelectorAll('button, input'), function (el) { if (el._sync) el._sync(); });
    };
    return panel({ title: 'SETTINGS' }, [grid], [btn('Back', goBack, 'alt')]);
  }

  function buildConfirm() {
    return panel({ title: 'RESET PROGRESS?', size: 'narrow danger', titleClass: 'error-title' }, [
      h('p', { class: 'message', text: 'This erases your high score and unlocked levels. Settings are kept.' })
    ], [
      btn('No, keep it', function () { show('settings'); }, 'alt'),
      btn('Yes, reset', resetProgress)
    ]);
  }

  function controlTable(rows) {
    return h('table', { class: 'ctl-table' }, [h('tbody', null, rows.map(function (r) {
      return h('tr', null, [h('th', { scope: 'row', text: r[0] }), h('td', null, r[1].map(function (k) {
        return k === '/' ? ' / ' : h('kbd', { text: k });
      }))]);
    }))]);
  }

  function buildHelp() {
    var tips = [
      'Stomp enemies by landing on top of them.',
      'Hit ? blocks from below for coins and power-ups.',
      'Mushrooms make you grow - you can take an extra hit.',
      'A star makes you invincible for a short time.',
      'Stomp a shelled enemy, then kick the shell into others.',
      'Hold Run to dash and jump farther.',
      'Reach the flag before the timer runs out!',
      'Collect 100 coins for an extra life (1UP).'
    ];
    return panel({ title: 'HOW TO PLAY', size: 'wide' }, [
      h('div', { class: 'help-cols' }, [
        h('div', null, [h('h3', { text: 'Keyboard' }), controlTable([
          ['Move', ['←', '→', '/', 'A', 'D']],
          ['Jump', ['Space', 'Z', '↑', 'W']],
          ['Run', ['Shift', 'X']],
          ['Pause', ['Esc', 'P', 'Enter']],
          ['Mute', ['M']]
        ])]),
        h('div', null, [h('h3', { text: 'Gamepad (PS5 / Xbox)' }), controlTable([
          ['Move', ['D-pad', '/', 'L-stick']],
          ['Jump', ['✕ A', '○ B']],
          ['Run', ['□ X', '△ Y', 'R2 RT']],
          ['Pause', ['Options', '/', 'Menu']],
          ['Menu OK', ['✕ A']],
          ['Menu Back', ['○ B']]
        ])]),
        h('div', { class: 'touch-help' }, [h('h3', { text: 'Touch' }), controlTable([
          ['Move', ['◀', '▶']],
          ['Jump / Run', ['A', 'B']],
          ['Pause', ['II']],
          ['AI on / off', ['AI']]
        ])]),
        h('div', { class: 'ai-only' }, [h('h3', { text: 'AI Agent' }), controlTable([
          ['AI control', ['I', '/', 'Share', '/', 'View']],
          ['Plan overlay', ['O']]
        ]), h('p', { class: 'ai-note', text:
          'The AI plans its route with an A* search over simulated physics, predicts enemy movement ' +
          'and replans every few frames. Runs the AI plays do not count for the high score.' })])
      ]),
      h('div', { class: 'tips' }, [h('h3', { text: 'Tips' }), h('ul', null, tips.map(function (t) { return h('li', { text: t }); }))])
    ], [btn('Back', goBack, 'alt')]);
  }

  function buildPause() {
    var sub = h('p', { class: 'subtitle' });
    var aiBtn = btn('Let AI Play', function () { toggleAgent(); resume(); }, 'ai-only ai-toggle');
    syncers.push(function () {
      var on = isAgent();
      aiBtn.textContent = on ? 'Take Control' : 'Let AI Play';
      aiBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    screens.pause.onShow = function () {
      var s = stats();
      var lv = levels()[s.levelIndex];
      sub.textContent = (lv ? 'WORLD ' + lv.name + ' · ' : '') + 'SCORE ' + pad6(s.score);
    };
    return panel({ title: 'PAUSED', size: 'narrow', subtitle: sub }, [
      h('nav', { class: 'menu-list', 'aria-label': 'Pause menu' }, [
        btn('Resume', resume),
        aiBtn,
        btn('Restart Level', function () { startLevel(stats().levelIndex); }),
        btn('Settings', function () { show('settings', 'pause', true); }),
        btn('How to Play', function () { show('help', 'pause', true); }),
        btn('Quit to Menu', quitToMenu)
      ])
    ]);
  }

  function buildResult(name) {
    var isWin = name === 'win';
    var score = h('span', { text: '000000' });
    var sub = h('p', { class: 'result-sub' });
    var newHi = h('p', { class: 'new-hi', text: 'NEW HIGH SCORE!', hidden: true });
    var aiNote = h('p', { class: 'ai-run', text: 'AI-assisted run: score not recorded', hidden: true });
    screens[name].update = function (st) {
      var s = Object.assign(stats(), st || {});
      score.textContent = pad6(s.score);
      var lv = levels()[s.levelIndex | 0];
      sub.textContent = isWin ? 'HI-SCORE ' + pad6(s.ai ? s.hiScore : Math.max(s.hiScore | 0, s.score | 0))
                              : (lv ? 'WORLD ' + lv.name + ' · ' : '') + 'COINS ' + (s.coins | 0);
      aiNote.hidden = !s.ai;
      newHi.hidden = !(isWin && !s.ai && (s.score | 0) > 0 && (s.score | 0) >= (s.hiScore | 0));
    };
    return panel({ title: isWin ? 'VICTORY!' : 'GAME OVER', size: 'narrow' }, [
      isWin ? h('p', { class: 'message', text: 'You conquered every world!' }) : null,
      h('p', { class: 'big-score' }, [isWin ? 'FINAL SCORE ' : 'SCORE ', score]),
      sub,
      newHi,
      aiNote
    ], isWin ? [
      btn('Play Again', function () { restart(0); }),
      btn('Main Menu', quitToMenu, 'alt')
    ] : [
      btn('Retry', function () { restart(stats().levelIndex); }),
      btn('Main Menu', quitToMenu, 'alt')
    ]);
  }

  function showError(detail) {
    root.textContent = '';
    screens = {};
    current = null;
    defineScreen('error', {
      dim: true,
      build: function () {
        return panel({ title: 'OOPS!', size: 'narrow danger', titleClass: 'error-title' }, [
          h('p', { class: 'message', text: 'game.js failed to load.' }),
          h('p', { class: 'message hint', text: detail || 'Make sure game.js is in the same folder as index.html, then reload.' })
        ], [btn('Reload', function () { window.location.reload(); })]);
      }
    });
    show('error', null, true);
  }

  /* ---------------------------------------------------------------- actions */

  function startLevel(i) {
    hideAll();
    game('start', i | 0);
    if (game('isPaused')) game('resume');
  }

  // Retry/Play Again keep the AI in charge if it was playing when the run ended
  function restart(i) { if (stats().agent && hasAI()) startAI(i); else startLevel(i); }

  function resume() { game('resume'); }

  function quitToMenu() {
    game('quitToMenu');
    if (game('isPaused')) game('resume');
    state = game('getState') || 'menu';
    show('menu', null, true);
  }

  /* ---------------------------------------------------------- engine events */

  function onStateChange(s) {
    state = s;
    if (s === 'menu') {
      if (!current || rootOf(current) !== 'menu') show('menu', null, true);
    } else if (GAMEPLAY_STATES[s]) {
      if (current && !game('isPaused')) hideAll();
    } else if ((s === 'gameover' || s === 'win') && current !== s) {
      showResult(s); // fallback in case the dedicated event was not emitted
    }
    updateTouchUI();
  }

  function showResult(name, st) {
    if (!screens[name]) return;
    screens[name].update(st);
    show(name, null, current !== name);
  }

  function onPause(paused) {
    if (paused) {
      show('pause', null, true);
    } else if (current && rootOf(current) === 'pause') {
      hideAll();
    }
  }

  /* --------------------------------------------------------------- keyboard */

  function onKeyDown(e) {
    soundInit();
    // No overlay visible = gameplay: never touch the event, every key goes to the engine.
    if (!current || e.ctrlKey || e.metaKey || e.altKey) return;
    // A key event created before the menu opened (e.g. the Esc that just paused the game,
    // if the engine's listener ran first) must not act on the new menu.
    if (e.timeStamp && e.timeStamp < shownAt) return;
    var k = e.key;
    var once = !e.repeat;
    // Decide before acting: activating a button (e.g. Resume) may close the overlay mid-handler.
    var inLevel = !!GAMEPLAY_STATES[state] || !!game('isPaused');
    var handled = true;
    switch (k) {
      case 'ArrowUp': vertical(-1); break;
      case 'ArrowDown': vertical(1); break;
      case 'ArrowLeft': horizontal(-1); break;
      case 'ArrowRight': horizontal(1); break;
      case 'Tab': navigate(e.shiftKey ? -1 : 1); break;
      case 'Enter': case ' ': case 'Spacebar': if (once) activate(); break;
      case 'Escape': case 'Backspace': if (once) back(); break;
      case 'p': case 'P': if (current === 'pause') { if (once) back(); } else handled = false; break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      // Capture phase on window runs before the engine's window listeners. While a level is
      // running (pause menu and its sub-screens) the key must not reach the engine, otherwise
      // e.g. Esc/Enter used to resume would immediately be read as a fresh pause press.
      // In menu/gameover/win the engine ignores gameplay keys, and letting keydown through
      // lets it start menu music on the first key press.
      if (inLevel) e.stopImmediatePropagation();
    }
  }

  // Block native button activation from keyup/keypress (we activate on keydown ourselves).
  // This also stops a key that was held when a menu opened (e.g. Space at game over) from clicking.
  // Keyups still propagate so the engine never sees a key as stuck down.
  function swallowActivation(e) {
    if (!current) return; // gameplay: leave the event alone
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (e.type === 'keypress') e.stopImmediatePropagation();
    }
  }

  /* ---------------------------------------------------------------- gamepad */

  var padRAF = 0;
  var padPrev = null;
  var padHold = { dir: '', next: 0 };
  var PAD_DELAY = 380, PAD_REPEAT = 120;

  function startPadLoop() {
    if (padRAF || typeof navigator.getGamepads !== 'function' || !window.requestAnimationFrame) return;
    padPrev = null;
    padRAF = requestAnimationFrame(padLoop);
  }

  function readPads() {
    var out = { b0: false, b1: false, b9: false, dir: '' };
    var pads;
    try { pads = navigator.getGamepads() || []; } catch (err) { return out; }
    function on(b) { return !!b && (b.pressed || b.value > 0.5); }
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i];
      if (!p || !p.buttons) continue;
      var b = p.buttons, ax = p.axes || [];
      out.b0 = out.b0 || on(b[0]);
      out.b1 = out.b1 || on(b[1]);
      out.b9 = out.b9 || on(b[9]);
      if (!out.dir) {
        if (on(b[12]) || ax[1] < -0.5) out.dir = 'up';
        else if (on(b[13]) || ax[1] > 0.5) out.dir = 'down';
        else if (on(b[14]) || ax[0] < -0.5) out.dir = 'left';
        else if (on(b[15]) || ax[0] > 0.5) out.dir = 'right';
      }
    }
    return out;
  }

  function padLoop(t) {
    padRAF = 0;
    if (!current) return; // loop only runs while a menu is visible
    var now = readPads();
    if (!padPrev) {
      // First frame: seed with held buttons so a press that opened the menu doesn't act on it.
      padPrev = now;
      padHold.dir = now.dir;
      padHold.next = t + PAD_DELAY;
    } else {
      if (now.dir !== padHold.dir) {
        padHold.dir = now.dir;
        padHold.next = t + PAD_DELAY;
        if (now.dir) padDir(now.dir);
      } else if (now.dir && t >= padHold.next) {
        padHold.next = t + PAD_REPEAT;
        padDir(now.dir);
      }
      if (now.b0 && !padPrev.b0) { soundInit(); activate(); }
      else if (now.b1 && !padPrev.b1) back();
      else if (now.b9 && !padPrev.b9 && current === 'pause') back();
      padPrev = now;
    }
    if (current) padRAF = requestAnimationFrame(padLoop);
  }

  function padDir(dir) {
    if (dir === 'up') vertical(-1);
    else if (dir === 'down') vertical(1);
    else horizontal(dir === 'left' ? -1 : 1);
  }

  /* ---------------------------------------------------------- touch controls */

  var isTouch = false;
  var touchPointers = {}; // pointerId -> control name ('left'|'right'|'jump'|'run') or null
  var touchBox, touchPause, touchAI;

  function vi() {
    if (!window.VirtualInput || typeof window.VirtualInput !== 'object') {
      window.VirtualInput = { left: false, right: false, down: false, jump: false, run: false };
    }
    return window.VirtualInput;
  }

  function syncTouch() {
    var on = { left: false, right: false, jump: false, run: false };
    Object.keys(touchPointers).forEach(function (id) { if (touchPointers[id]) on[touchPointers[id]] = true; });
    var v = vi();
    Object.keys(on).forEach(function (k) { v[k] = on[k]; });
    if (touchBox) {
      Array.prototype.forEach.call(touchBox.querySelectorAll('[data-ctl]'), function (el) {
        el.classList.toggle('pressed', on[el.getAttribute('data-ctl')]);
      });
    }
  }

  function releaseTouch() {
    touchPointers = {};
    syncTouch();
  }

  function controlAt(x, y) {
    var el = doc.elementFromPoint(x, y);
    var c = el && el.closest ? el.closest('[data-ctl]') : null;
    return c && touchBox.contains(c) ? c.getAttribute('data-ctl') : null;
  }

  function buildTouch() {
    function pad(ctl, label, round) {
      return h('div', { class: 'tc-btn' + (round ? ' round' : ''), 'data-ctl': ctl, role: 'button', 'aria-label': ctl }, [label]);
    }
    touchBox = h('div', { class: 'touch-controls', hidden: true, 'aria-hidden': 'true' }, [
      h('div', { class: 'tc-group tc-dpad' }, [pad('left', '◀'), pad('right', '▶')]),
      h('div', { class: 'tc-group tc-actions' }, [pad('run', 'B', true), pad('jump', 'A', true)])
    ]);
    touchPause = h('div', { class: 'tc-btn touch-pause', role: 'button', 'aria-label': 'Pause', hidden: true }, ['II']);
    touchAI = h('div', { class: 'tc-btn touch-pause touch-ai', role: 'button', 'aria-label': 'Toggle AI control', hidden: true }, ['AI']);

    touchBox.addEventListener('pointerdown', function (e) {
      var c = e.target.closest && e.target.closest('[data-ctl]');
      if (!c) return;
      e.preventDefault();
      // Explicit capture keeps move/up events coming even if the finger leaves the button.
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      touchPointers[e.pointerId] = c.getAttribute('data-ctl');
      syncTouch();
    });
    touchBox.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in touchPointers)) return;
      var c = controlAt(e.clientX, e.clientY); // sliding between buttons or off them
      if (c !== touchPointers[e.pointerId]) { touchPointers[e.pointerId] = c; syncTouch(); }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
      touchBox.addEventListener(type, function (e) {
        if (e.pointerId in touchPointers) { delete touchPointers[e.pointerId]; syncTouch(); }
      });
    });
    touchBox.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    touchPause.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      soundInit();
      releaseTouch();
      game('pause');
    });
    touchAI.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      soundInit();
      releaseTouch();
      toggleAgent();
      syncAI();
    });
    root.appendChild(touchBox);
    root.appendChild(touchPause);
    root.appendChild(touchAI);
  }

  function enableTouch() {
    if (isTouch) return;
    isTouch = true;
    doc.body.classList.add('touch');
    updateTouchUI();
  }

  function updateTouchUI() {
    if (!touchBox) return;
    var visible = isTouch && !current && !!GAMEPLAY_STATES[state];
    touchBox.hidden = !visible;
    touchPause.hidden = !(visible && state === 'play');
    touchAI.hidden = touchPause.hidden || !hasAI();
    if (!visible) releaseTouch();
  }

  // Refresh everything that depends on the (optional) AI agent.
  function syncAI() {
    doc.body.classList.toggle('no-ai', !hasAI());
    syncers.forEach(function (fn) { fn(); });
    if (touchAI) {
      var on = isAgent();
      touchAI.classList.toggle('active', on);
      touchAI.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /* ------------------------------------------------------------------- init */

  function init() {
    defineScreen('menu', { build: buildMenu });
    defineScreen('levels', { build: buildLevels, back: goBack });
    defineScreen('settings', { build: buildSettings, back: goBack });
    defineScreen('confirm', { build: buildConfirm, dim: true, back: function () { show('settings'); } });
    defineScreen('help', { build: buildHelp, back: goBack, scrollFirst: true });
    defineScreen('pause', { build: buildPause, dim: true, back: resume });
    defineScreen('gameover', { build: function () { return buildResult('gameover'); }, dim: true });
    defineScreen('win', { build: function () { return buildResult('win'); }, dim: true });
    buildTouch();

    window.Game.on('statechange', onStateChange);
    window.Game.on('pause', onPause);
    window.Game.on('gameover', function (st) { showResult('gameover', st); });
    window.Game.on('win', function (st) { showResult('win', st); });
    window.Game.on('agent', function () { syncAI(); }); // older engines simply never emit it
    // The O key toggles the overlay inside the engine; mirror it into saved settings
    window.Game.on('settings', function (o) {
      if (o && typeof o.aiOverlay === 'boolean') { settings.aiOverlay = o.aiOverlay; saveSettings(); }
    });
    syncAI();

    applySettings();

    state = game('getState') || 'menu';
    if (state === 'menu') show('menu', null, true);
    else if (game('isPaused')) show('pause', null, true);
    else onStateChange(state);
  }

  // Global listeners (capture phase so menus see keys before the engine's window listeners).
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', swallowActivation, true);
  window.addEventListener('keypress', swallowActivation, true);
  window.addEventListener('pointerdown', function (e) {
    soundInit();
    if (e.pointerType === 'touch') enableTouch();
  }, true);
  window.addEventListener('touchstart', enableTouch, { capture: true, passive: true });
  window.addEventListener('blur', releaseTouch);
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) releaseTouch(); });
  // Mouse hover moves keyboard focus too, so there is only ever one highlighted item.
  root.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse' || !current) return;
    var el = e.target.closest && e.target.closest('button:not([disabled]), input:not([disabled])');
    if (el && el !== doc.activeElement && screens[current].el.contains(el)) focusEl(el);
  });

  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      isTouch = true;
      doc.body.classList.add('touch');
    }
  } catch (err) { /* ignore */ }

  if (!hasGame()) {
    showError();
    return;
  }
  try {
    init();
  } catch (err) {
    console.error('[ui] init failed:', err);
    showError('UI error: ' + (err && err.message ? err.message : err));
  }
})();
