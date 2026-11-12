// Super Pixel Quest — engine
// Pure HTML5 canvas, no dependencies. Renders a 256x240 virtual screen at an integer scale.
// Audio lives in audio.js (window.Sound / window.Music), menus in ui.js. See CONTRACT.md.
'use strict';

// ================================================================ constants
const VW = 256, VH = 240, TILE = 16, ROWS = 15;
const STEP_MS = 1000 / 60;
const GRAVITY = 0.3;
const SOLID = new Set(['#', 'B', '?', 'U', 'X', '[', ']', '{', '}']);
const COMBO = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];

// ================================================================ audio bridge (audio.js is optional)
const sfx = name => { try { window.Sound && Sound.play(name); } catch (e) { /* audio must never break the game */ } };
const music = (fn, arg) => { try { window.Music && Music[fn] && Music[fn](arg); } catch (e) { /* ignore */ } };
const audioInit = () => { try { window.Sound && Sound.init(); } catch (e) { /* ignore */ } };

// ================================================================ canvas
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let SCALE = 3;
const settings = { scale: 'auto', crt: false, showFps: false, aiOverlay: true };

function resize() {
  const fit = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, window.innerHeight / VH)));
  SCALE = settings.scale === 'auto' ? fit : Math.max(1, Math.min(+settings.scale || fit, fit));
  canvas.width = VW * SCALE;
  canvas.height = VH * SCALE;
  canvas.style.width = VW * SCALE + 'px';
  canvas.style.height = VH * SCALE + 'px';
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ================================================================ input
const keys = new Set();
const tapped = new Set();   // keys pressed since the last tick, so taps shorter than a frame still count
const PREVENT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
window.VirtualInput = { left: false, right: false, down: false, jump: false, run: false };
const input = {};

window.addEventListener('keydown', e => {
  keys.add(e.code);
  tapped.add(e.code);
  if (PREVENT.has(e.code) && (game.state !== 'menu' && !game.paused)) e.preventDefault();
  audioInit();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); tapped.clear(); });

const AGENT_STATES = new Set(['play', 'flag', 'dying']);

function pollInput() {
  const k = c => keys.has(c) || tapped.has(c);
  let gp = null;
  if (navigator.getGamepads) {
    for (const p of navigator.getGamepads()) if (p && p.connected) { gp = p; break; }
  }
  const b = i => !!(gp && gp.buttons[i] && gp.buttons[i].pressed);
  const ax = gp ? gp.axes[0] || 0 : 0, ay = gp ? gp.axes[1] || 0 : 0;
  const v = window.VirtualInput || {};
  const now = {
    left: k('ArrowLeft') || k('KeyA') || b(14) || ax < -0.4 || !!v.left,
    right: k('ArrowRight') || k('KeyD') || b(15) || ax > 0.4 || !!v.right,
    down: k('ArrowDown') || k('KeyS') || b(13) || ay > 0.5 || !!v.down,
    jump: k('Space') || k('KeyZ') || k('ArrowUp') || k('KeyW') || k('KeyK') || b(0) || b(1) || !!v.jump,
    run: k('ShiftLeft') || k('ShiftRight') || k('KeyX') || k('KeyJ') || b(2) || b(3) || b(7) || !!v.run,
    pause: k('Escape') || k('KeyP') || k('Enter') || b(9),
    mute: k('KeyM'),
    ai: k('KeyI') || b(8),
    overlay: k('KeyO'),
  };
  tapped.clear();
  // The AI agent (agent.js) drives the hero's controls while it is in charge
  if (window.Agent && Agent.active && AGENT_STATES.has(game.state)) {
    const a = Agent.decide();
    for (const name of ['left', 'right', 'down', 'jump', 'run']) now[name] = !!a[name];
  }
  for (const name in now) {
    input[name + 'Pressed'] = now[name] && !input[name];
    input[name] = now[name];
  }
}

// ================================================================ sprites
const PAL = {
  K: '#000000', W: '#fcfcfc', R: '#d82800', O: '#e45c10', U: '#2038ec', S: '#fcb880',
  D: '#6a3400', Y: '#fcd848', y: '#c88c00', B: '#b04a10', T: '#f8c088', G: '#00a800',
  g: '#005800', L: '#80d010',
};

function makeSprite(rows, pal = PAL) {
  const w = Math.max(...rows.map(r => r.length));
  const c = makeCanvas(w, rows.length), g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  });
  return c;
}
function flipH(src) {
  const c = makeCanvas(src.width, src.height), g = c.getContext('2d');
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}
// A sprite facing right (.r) plus its mirror (.l)
function pair(rows, pal) { const r = makeSprite(rows, pal); return { r, l: flipH(r) }; }

const HERO_SMALL_TOP = [
  '......UUUUU.....',
  '.....UUUUUUUUU..',
  '.....DDDSSKS....',
  '....DSDSSSKSSS..',
  '....DSDDSSSKSSS.',
  '....DDSSSSKKKK..',
  '......SSSSSSS...',
  '.....OOUOOO.....',
  '....OOOUOOUOOO..',
  '...OOOOUUUUOOOO.',
];
const HERO_SMALL_LEGS = {
  stand: [
    '...SSOUYUUYUOSS.',
    '...SSSUUUUUUSSS.',
    '...SSUUUUUUUUSS.',
    '.....UUU..UUU...',
    '....DDD....DDD..',
    '...DDDD....DDDD.',
  ],
  walk1: [
    '....SOUYUUYUOS..',
    '....SUUUUUUUUS..',
    '.....UUUUUUUU...',
    '....UUU...UUUU..',
    '...DDD.....DDD..',
    '..DDDD.....DDDD.',
  ],
  walk2: [
    '...SSOUYUUYUOO..',
    '....SUUUUUUUSS..',
    '.....UUUUUUU....',
    '......UUUUU.....',
    '......DDDD......',
    '.....DDDDD......',
  ],
  jump: [
    '..SSOOUYUUYUUSS.',
    '..SS.UUUUUUUUSS.',
    '.....UUUUUUUU...',
    '...DDUUU..UUU...',
    '..DDDD.....DDD..',
    '............DDD.',
  ],
};
const HERO_DEAD = [
  '................',
  '....UUUUUUUU....',
  '...UUUUUUUUUU...',
  '...DDSSSSSSDD...',
  '..DDSKSSSSKSDD..',
  '..SSSKSSSSKSSS..',
  '...SSSSSSSSSS...',
  '...SSKKKKKKSS...',
  'SS..SSSSSSSS..SS',
  'SSOOOOUOOUOOOOSS',
  '..OOOOUOOUOOOO..',
  '....UUUUUUUU....',
  '...UUYUUUUYUU...',
  '...UUUUUUUUUU...',
  '..DDDD....DDDD..',
  '..DDDD....DDDD..',
];
const HERO_BIG_TOP = [
  '......UUUUU.....',
  '.....UUUUUUUUU..',
  '.....UUUUUUUUU..',
  '.....DDDSSKS....',
  '....DSDSSSKSSS..',
  '....DSDSSSKSSSS.',
  '....DSDDSSSKSSS.',
  '....DDSSSSKKKKK.',
  '....DDSSSSSKKK..',
  '......SSSSSSSS..',
  '......SSSSSS....',
  '.....OOOUOOO....',
  '....OOOOUOOOUO..',
  '...OOOOOUOOOUOO.',
  '...OOOOOUUUUUOO.',
  '..OOOOUUYUUYUOO.',
  '..SSOOUUUUUUOSS.',
  '..SSSUUUUUUUSSS.',
  '..SSUUUUUUUUUSS.',
  '.....UUUUUUUU...',
  '.....UUUUUUUU...',
  '....UUUUUUUUUU..',
];
const HERO_BIG_LEGS = {
  stand: [
    '....UUUUU.UUUU..',
    '....UUUU...UUU..',
    '....UUUU...UUU..',
    '....UUU....UUU..',
    '....UUU....UUU..',
    '....UUU....UUU..',
    '...DDDD....DDDD.',
    '..DDDDD....DDDDD',
    '..DDDDD....DDDDD',
    '..DDDDD....DDDDD',
  ],
  walk1: [
    '...UUUUU..UUUU..',
    '...UUUU....UUUU.',
    '..UUUU......UUU.',
    '..UUU.......UUU.',
    '..UUU.......UUU.',
    '.UUU........UUU.',
    '.UUU.......DDDD.',
    'DDDD.......DDDDD',
    'DDDD.......DDDDD',
    'DDD.............',
  ],
  walk2: [
    '....UUUUUUUU....',
    '.....UUUUUU.....',
    '.....UUUUU......',
    '.....UUUUU......',
    '.....UUUU.......',
    '.....UUUU.......',
    '.....UUUU.......',
    '....DDDDD.......',
    '....DDDDDD......',
    '....DDDDDD......',
  ],
  jump: [
    '...UUUUU..UUUU..',
    '..UUUUU....UUUU.',
    '.UUUU.......UUUD',
    'DUUU........UDDD',
    'DDDD.........DDD',
    'DDD.............',
    'DD..............',
    '................',
    '................',
    '................',
  ],
};

function buildHero(pal) {
  const set = (top, legs) => ({
    stand: pair(top.concat(legs.stand), pal),
    walk: [pair(top.concat(legs.walk1), pal), pair(top.concat(legs.walk2), pal), pair(top.concat(legs.stand), pal)],
    jump: pair(top.concat(legs.jump), pal),
  });
  const small = set(HERO_SMALL_TOP, HERO_SMALL_LEGS);
  small.dead = pair(HERO_DEAD, pal);
  return { small, big: set(HERO_BIG_TOP, HERO_BIG_LEGS) };
}
// Palette 0 = normal, 1..3 = star-power flashing palettes
const HERO = [
  {},
  { U: '#00a800', O: '#fcfcfc', D: '#e45c10' },
  { U: '#d82800', O: '#fcd848', D: '#000000' },
  { U: '#fcfcfc', O: '#2038ec', D: '#d82800' },
].map(over => buildHero(Object.assign({}, PAL, over)));

const GOOMBA_ROWS = [
  '......BBBB......',
  '.....BBBBBB.....',
  '....BBBBBBBB....',
  '...BBBBBBBBBB...',
  '..BKKBBBBBBKKB..',
  '.BBBWKBBBBKWBBB.',
  '.BBBWKKKKKKWBBB.',
  'BBBBWKWBBWKWBBBB',
  'BBBBWWWBBWWWBBBB',
  'BBBBBBBBBBBBBBBB',
  '.BBBBTTTTTTBBBB.',
  '....TTTTTTTT....',
  '....TTTTTTTT....',
  '..KK.TTTTTT.....',
  '.KKKKK..TTKKKK..',
  '.KKKKKK.KKKKKK..',
];
const KOOPA_TOP = [
  '..........YY....',
  '.........YYYY...',
  '........YYWKY...',
  '........YYWKY...',
  '........YYYYYY..',
  '........YYYYYY..',
  '.........YYYY...',
  '...GGGG..YYY....',
  '..GGWGGG.YYY....',
  '.GGWGGGGGYY.....',
  '.GWGGGGGWYY.....',
  'GGGGGGGWGYY.....',
  'GWGGGGWGGYY.....',
  'GGWWWWGGGY......',
  'GWGGGGWGGW......',
  'WWWWWWWWWW......',
  '.WWWWWWWW.......',
];

const SPR = {
  goomba: pair(GOOMBA_ROWS),
  goombaFlat: makeSprite([
    '....BBBBBBBB....',
    '..BBBKWBBWKBBB..',
    '.BBBBWWBBWWBBBB.',
    'BBBBBBBBBBBBBBBB',
    '.BBTTTTTTTTTTBB.',
    '..KKKK....KKKK..',
  ]),
  koopa: [
    pair(KOOPA_TOP.concat(['..YYY..YYY......', '.YYYY..YYYY.....'])),
    pair(KOOPA_TOP.concat(['...YYY.YYY......', '..YYYY.YYYY.....'])),
  ],
  shell: makeSprite([
    '.....GGGGGG.....',
    '...GGWGGGGWGG...',
    '..GWGGGGGGGGWG..',
    '.GWGGGGGGGGGGWG.',
    '.GGWWWWWWWWWWGG.',
    'GWGGWGGGGGGWGGWG',
    'GWGGWGGGGGGWGGWG',
    '.GGWWWWWWWWWWGG.',
    '.WWWWWWWWWWWWWW.',
    '..WWWWWWWWWWWW..',
    '...WWWWWWWWWW...',
  ]),
  coin: makeSprite([
    '................',
    '......YYYY......',
    '.....YYYYYY.....',
    '....YYWWYYYy....',
    '....YYWYYYYy....',
    '....YWYYYYYy....',
    '....YWYYYYYy....',
    '....YWYYYYYy....',
    '....YWYYYYYy....',
    '....YWYYYYYy....',
    '....YWYYYYYy....',
    '....YYWYYYYy....',
    '....YYYYYYyy....',
    '.....YYYYyy.....',
    '......yyyy......',
    '................',
  ]),
  star: makeSprite([
    '.......YY.......',
    '.......YY.......',
    '......YYYY......',
    '......YYYY......',
    'YYYYYYYYYYYYYYYY',
    '.YYYYYYYYYYYYYY.',
    '..YYYYKYYKYYYY..',
    '...YYYKYYKYYY...',
    '....YYKYYKYY....',
    '....YYYYYYYY....',
    '...YYYYYYYYYY...',
    '...YYYY..YYYY...',
    '..YYYY....YYYY..',
    '..YYY......YYY..',
    '.YY..........YY.',
  ]),
  flag: makeSprite([
    'WWWWWWWWWWWWWWWW',
    '.WWWWWWWWWWWWWWW',
    '..WWWWWWGGWWWWWW',
    '...WWWWGGGGWWWWW',
    '....WWGGGGGGWWWW',
    '.....WWGGGGWWWWW',
    '......WWGGWWWWWW',
    '.......WWWWWWWWW',
    '........WWWWWWWW',
    '.........WWWWWWW',
    '..........WWWWWW',
    '...........WWWWW',
    '............WWWW',
    '.............WWW',
    '..............WW',
    '...............W',
  ]),
  ball: makeSprite([
    '..gggg..',
    '.gLLLLg.',
    'gLWLLLLg',
    'gLLLLLLg',
    'gLLLLLLg',
    'gLLLLLLg',
    '.gLLLLg.',
    '..gggg..',
  ]),
};
const MUSHROOM_ROWS = [
  '......RRRR......',
  '....RRWWWWRR....',
  '...RWWWWWWWWR...',
  '..RRWWRRRRWWRR..',
  '.RRRRRRRRRRRRRR.',
  '.RWWRRRRRRRRWWR.',
  'RWWWWRRRRRRWWWWR',
  'RWWWWRRRRRRWWWWR',
  'RRWWRRRRRRRRWWRR',
  'RRRRRRRRRRRRRRRR',
  '.KKKWWWWWWWWKKK.',
  '...WWWKWWKWWW...',
  '...WWWKWWKWWW...',
  '...WWWWWWWWWW...',
  '....WWWWWWWW....',
  '.....WWWWWW.....',
];
SPR.mush = makeSprite(MUSHROOM_ROWS);
SPR['1up'] = makeSprite(MUSHROOM_ROWS, Object.assign({}, PAL, { R: '#00a800' }));

const BEETLE_PAL = Object.assign({}, PAL, { B: '#2c3c8c', T: '#8ca0fc' });
SPR.beetle = pair(GOOMBA_ROWS, BEETLE_PAL);
SPR.beetleFlat = makeSprite([
  '....BBBBBBBB....',
  '..BBBKWBBWKBBB..',
  '.BBBBWWBBWWBBBB.',
  'BBBBBBBBBBBBBBBB',
  '.BBTTTTTTTTTTBB.',
  '..KKKK....KKKK..',
], BEETLE_PAL);
const RED_PAL = Object.assign({}, PAL, { G: '#d82800' });
SPR.redKoopa = [
  pair(KOOPA_TOP.concat(['..YYY..YYY......', '.YYYY..YYYY.....']), RED_PAL),
  pair(KOOPA_TOP.concat(['...YYY.YYY......', '..YYYY.YYYY.....']), RED_PAL),
];
SPR.redShell = makeSprite([
  '.....GGGGGG.....',
  '...GGWGGGGWGG...',
  '..GWGGGGGGGGWG..',
  '.GWGGGGGGGGGGWG.',
  '.GGWWWWWWWWWWGG.',
  'GWGGWGGGGGGWGGWG',
  'GWGGWGGGGGGWGGWG',
  '.GGWWWWWWWWWWGG.',
  '.WWWWWWWWWWWWWW.',
  '..WWWWWWWWWWWW..',
  '...WWWWWWWWWW...',
], RED_PAL);
const FROG_TOP = [
  '...WWW....WWW...',
  '..WWKW....WKWW..',
  '..WWKW....WKWW..',
  '..GGGGGGGGGGGG..',
  '.GGLLGGGGGGLLGG.',
  '.GGGGGGGGGGGGGG.',
  '.GRRRRRRRRRRRRG.',
  '.GGGGGGGGGGGGGG.',
  '..GGLLLLLLLLGG..',
  '..GLLLLLLLLLLG..',
  '..GLLLLLLLLLLG..',
  '..GGLLLLLLLLGG..',
  '..GGGGGGGGGGGG..',
];
SPR.frog = [
  pair(FROG_TOP.concat(['.GGG.GG..GG.GGG.', 'GGG..........GGG', 'GG............GG'])),
  pair(FROG_TOP.concat(['..GG........GG..', '..GG........GG..', '.GGG........GGG.'])),
];
const PLANT_STEM = [
  '.......GG.......',
  '..GG...GG...GG..',
  '.GGGG..GG..GGGG.',
  'GGGGGG.GG.GGGGGG',
  '.GGGGGGGGGGGGGG.',
  '...GGGGGGGGGG...',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
  '.......GG.......',
];
const PLANT_HEAD = [
  '....RRRRRRRR....',
  '..RRWRRRRRRWRR..',
  '.RRRRRRRRRRRRRR.',
  'RRWRRRRRRRRRRWRR',
  'RRRRRWRRRRWRRRRR',
  'RRRRRRRRRRRRRRRR',
];
SPR.plant = [
  makeSprite(PLANT_HEAD.concat(['.RRRWWWWWWWWRRR.', '..RWKWKWKWKWKR..', '...RRRRRRRRRR...'], PLANT_STEM)),
  makeSprite(PLANT_HEAD.concat(['.RRRKKKKKKKKRRR.', '..RRKKKKKKKKRR..', '...RRRRRRRRRR...'], PLANT_STEM)),
];
SPR.fireball = [
  makeSprite(['..RRRR..', '.RYYYYR.', 'RYYWWYYR', 'RYWWWWYR', 'RYWWWWYR', 'RYYWWYYR', '.RYYYYR.', '..RRRR..']),
  makeSprite(['..OOOO..', '.OYYYYO.', 'OYWWWWYO', 'OYWYYWYO', 'OYWYYWYO', 'OYWWWWYO', '.OYYYYO.', '..OOOO..']),
];

function drawSprite(sp, e, faceRight, camX, upsideDown = false) {
  const img = sp.r ? (faceRight ? sp.r : sp.l) : sp;
  const x = Math.round(e.x + e.w / 2 - img.width / 2 - camX);
  const y = Math.round(e.y + e.h - img.height);
  if (upsideDown) {
    ctx.save(); ctx.translate(x, y + img.height); ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0); ctx.restore();
  } else ctx.drawImage(img, x, y);
}
function drawCoin(x, y, t) {
  const w = Math.max(2, Math.round(Math.abs(Math.cos(t * 0.08)) * 8));
  ctx.drawImage(SPR.coin, 4, 0, 8, 16, Math.round(x + 8 - w / 2), Math.round(y), w, 16);
}

// ================================================================ themes & tiles
const THEMES = {
  day: {
    key: 'day', sky: '#6b8cff', song: 'main', decor: true,
    base: '#c84c0c', light: '#fcbcb0', dark: '#000000',
  },
  cave: {
    key: 'cave', sky: '#000000', song: 'cave', decor: false,
    base: '#00809c', light: '#9cfcf0', dark: '#002838',
  },
};
const Q_COLORS = ['#f8b800', '#e09000', '#b06800'];
const Q_CYCLE = [0, 0, 0, 0, 1, 2, 1];

function tileCanvas(draw) {
  const c = makeCanvas(TILE, TILE), g = c.getContext('2d');
  const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  draw(P);
  return c;
}
function buildTiles(th) {
  const { base, light, dark } = th;
  const T = {};
  T['#'] = tileCanvas(P => {
    P(0, 0, 16, 16, base);
    P(0, 0, 16, 1, light); P(0, 0, 1, 15, light);
    P(15, 0, 1, 16, dark); P(0, 15, 16, 1, dark);
    P(10, 1, 1, 9, dark); P(11, 1, 1, 8, light); P(10, 9, 5, 1, dark);
    P(1, 10, 5, 1, dark); P(5, 10, 1, 5, dark); P(6, 11, 1, 4, light);
  });
  T.B = tileCanvas(P => {
    P(0, 0, 16, 16, base);
    P(0, 0, 16, 1, light);
    for (const y of [3, 7, 11, 15]) P(0, y, 16, 1, dark);
    for (let band = 0; band < 4; band++) {
      const xs = band % 2 ? [3, 11] : [7, 15];
      for (const x of xs) P(x, band * 4, 1, 3, dark);
    }
  });
  T.X = tileCanvas(P => {
    P(0, 0, 16, 16, base);
    P(0, 0, 16, 2, light); P(0, 0, 2, 16, light);
    P(0, 14, 16, 2, dark); P(14, 0, 2, 16, dark);
    P(2, 2, 12, 12, base);
  });
  T.U = tileCanvas(P => {
    P(0, 0, 16, 16, '#000'); P(1, 1, 14, 14, th.key === 'cave' ? base : '#c84c0c');
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, 1, 1, '#000');
  });
  const QMARK = [' XXXX ', 'XX  XX', 'XX  XX', '   XX ', '  XX  ', '  XX  ', '      ', '  XX  '];
  T['?'] = Q_COLORS.map(col => tileCanvas(P => {
    P(0, 0, 16, 16, col);
    P(0, 0, 16, 1, '#c04800'); P(0, 0, 1, 16, '#c04800');
    P(15, 0, 1, 16, '#000'); P(0, 15, 16, 1, '#000');
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) P(x, y, 1, 1, '#000');
    QMARK.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === 'X') {
        P(5 + x, 4 + y, 1, 1, '#000'); P(4 + x, 3 + y, 1, 1, '#a83800');
      }
    });
  }));
  const PIPE = { o: '#000', b: '#00a800', h: '#80d010', s: '#006800' };
  T['['] = tileCanvas(P => {
    P(0, 0, 16, 16, PIPE.b); P(0, 0, 16, 1, PIPE.o); P(0, 15, 16, 1, PIPE.o); P(0, 0, 1, 16, PIPE.o);
    P(2, 1, 2, 14, PIPE.h); P(6, 1, 1, 14, PIPE.h);
  });
  T[']'] = tileCanvas(P => {
    P(0, 0, 16, 16, PIPE.b); P(0, 0, 16, 1, PIPE.o); P(0, 15, 16, 1, PIPE.o); P(15, 0, 1, 16, PIPE.o);
    P(8, 1, 2, 14, PIPE.s); P(11, 1, 3, 14, PIPE.s);
  });
  T['{'] = tileCanvas(P => {
    P(2, 0, 14, 16, PIPE.b); P(2, 0, 1, 16, PIPE.o);
    P(4, 0, 2, 16, PIPE.h); P(8, 0, 1, 16, PIPE.h);
  });
  T['}'] = tileCanvas(P => {
    P(0, 0, 14, 16, PIPE.b); P(13, 0, 1, 16, PIPE.o);
    P(6, 0, 2, 16, PIPE.s); P(9, 0, 3, 16, PIPE.s);
  });
  return T;
}
const tileCache = {};
const getTiles = th => tileCache[th.key] || (tileCache[th.key] = buildTiles(th));

// Background scenery: crisp pixel blobs (no anti-aliasing)
function blob(w, h, inside, fill, outline, closedBottom) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const grid = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = inside(x + 0.5, y + 0.5);
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || (!at(x, y + 1) && (closedBottom || y < h - 1));
    g.fillStyle = edge ? outline : fill;
    g.fillRect(x, y, 1, 1);
  }
  return { c, g };
}
function puffShape(w, cy, r) {
  return (x, y) => {
    for (let px = 16; px <= w - 16; px += 16) if ((x - px) ** 2 + (y - cy) ** 2 <= r * r) return true;
    return (x - 8) ** 2 + (y - cy - 5) ** 2 <= 56 || (x - (w - 8)) ** 2 + (y - cy - 5) ** 2 <= 56 ||
      (x >= 8 && x <= w - 8 && y >= cy);
  };
}
const DECOR = (() => {
  const cloud = [], bush = [];
  for (let n = 1; n <= 3; n++) {
    const w = 16 * n + 16;
    cloud[n] = blob(w, 24, (x, y) => y <= 22 && puffShape(w, 10, 9)(x, y), '#fcfcfc', '#2850a0', true).c;
    bush[n] = blob(w, 16, puffShape(w, 8, 8), '#80d010', '#005800', false).c;
  }
  const hill = (w, h, spots) => {
    const b = blob(w, h, (x, y) => ((x - w / 2) / (w / 2)) ** 2 + ((y - h) / h) ** 2 <= 1, '#00a800', '#000', false);
    b.g.fillStyle = '#005800';
    for (const [x, y] of spots) { b.g.fillRect(x, y, 2, 5); b.g.fillRect(x - 1, y + 1, 4, 3); }
    return b.c;
  };
  return {
    cloud, bush,
    hillBig: hill(80, 35, [[30, 12], [44, 20], [24, 24]]),
    hillSmall: hill(48, 19, [[22, 8]]),
  };
})();

// ================================================================ levels
class Level {
  constructor(w, theme, time) {
    this.w = w; this.h = ROWS; this.theme = theme; this.time = time;
    this.t = Array.from({ length: ROWS }, () => new Array(w).fill('.'));
    this.content = new Map();   // "x,y" -> 'coin' | 'mush' | '1up' | 'star' | 'multi'
    this.multi = new Map();     // coins left in multi-coin bricks
    this.spawns = []; this.decor = [];
    this.flagX = null; this.castleX = null; this.checkpoint = Infinity;
  }
  get(x, y) {
    if (y < 0 || y >= this.h) return '.';
    if (x < 0 || x >= this.w) return '#';
    return this.t[y][x];
  }
  set(x, y, c) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.t[y][x] = c; }
  fill(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  ground(x0, x1) { this.fill(x0, 13, x1, 14, '#'); }
  row(x, y, str) {
    const MAP = {
      B: ['B'], '?': ['?', 'coin'], M: ['?', 'mush'], L: ['?', '1up'],
      '*': ['B', 'star'], $: ['B', 'multi'], G: ['B', '1up'], X: ['X'], c: ['c'],
    };
    [...str].forEach((ch, i) => {
      const m = MAP[ch];
      if (!m) return;
      this.set(x + i, y, m[0]);
      if (m[1]) this.content.set(x + i + ',' + y, m[1]);
    });
  }
  coins(x, y, n) { this.row(x, y, 'c'.repeat(n)); }
  column(x, h) { this.fill(x, 13 - h, x, 12, 'X'); }
  stairsUp(x, n) { for (let i = 0; i < n; i++) this.column(x + i, i + 1); }
  stairsDown(x, n) { for (let i = 0; i < n; i++) this.column(x + i, n - i); }
  pipe(x, h) {
    const top = 13 - h;
    this.set(x, top, '['); this.set(x + 1, top, ']');
    for (let y = top + 1; y <= 12; y++) { this.set(x, y, '{'); this.set(x + 1, y, '}'); }
  }
  enemy(type, x, y = 12) { this.spawns.push({ type, x, y }); }
  flag(x) { this.flagX = x; this.set(x, 12, 'X'); }
  castle(x) { this.castleX = x; }
  finish() {
    this.spawns.sort((a, b) => a.x - b.x);
    if (this.theme.decor) this.decorate();
    return this;
  }
  decorate() {
    const onGround = (x, n) => { for (let i = 0; i < n; i++) if (this.get(x + i, 13) !== '#' || x + i >= this.w) return false; return true; };
    const add = (img, tx, y, par) => this.decor.push({ img, x: tx * TILE, y, par });
    for (let b = 0; b < this.w; b += 48) {
      add(DECOR.cloud[1], b + 8, 32, 0.5); add(DECOR.cloud[1], b + 19, 16, 0.5);
      add(DECOR.cloud[3], b + 27, 32, 0.5); add(DECOR.cloud[2], b + 36, 16, 0.5);
    }
    for (let b = 0; b < this.w; b += 48) {
      if (onGround(b, 5)) add(DECOR.hillBig, b, 208 - 35, 1);
      if (onGround(b + 16, 3)) add(DECOR.hillSmall, b + 16, 208 - 19, 1);
    }
    for (let b = 0; b < this.w; b += 48) {
      if (onGround(b + 11, 5)) add(DECOR.bush[3], b + 11, 192, 1);
      if (onGround(b + 23, 2)) add(DECOR.bush[1], b + 23, 192, 1);
      if (onGround(b + 41, 3)) add(DECOR.bush[2], b + 41, 192, 1);
    }
  }
}

function buildLevel1() {
  const L = new Level(212, THEMES.day, 300);
  L.ground(0, 68); L.ground(71, 85); L.ground(89, 152); L.ground(155, 211);
  L.row(16, 9, '?'); L.row(20, 9, 'BMB?B'); L.row(22, 5, '?');
  L.pipe(28, 2); L.pipe(38, 3); L.pipe(46, 4); L.pipe(57, 4);
  L.enemy('g', 22); L.enemy('g', 40); L.enemy('g', 51); L.enemy('g', 53);
  L.row(64, 8, 'L');
  L.coins(68, 9, 4);
  L.row(77, 9, 'BMB'); L.row(80, 5, 'BBBBBBBB');
  L.enemy('g', 81, 4); L.enemy('g', 83, 4);
  L.row(91, 5, 'BBB?'); L.row(94, 9, '$');
  L.enemy('g', 97); L.enemy('g', 99);
  L.row(100, 9, 'B*');
  L.row(106, 9, '?'); L.row(109, 9, '?'); L.row(109, 5, 'M'); L.row(112, 9, '?');
  L.enemy('k', 107); L.enemy('g', 114); L.enemy('g', 116);
  L.row(118, 9, 'B'); L.row(121, 5, 'BBB'); L.enemy('g', 124); L.enemy('g', 126);
  L.row(128, 5, 'B??B'); L.row(129, 9, 'BB');
  L.stairsUp(134, 4); L.stairsDown(140, 4);
  L.enemy('p', 46); L.enemy('p', 57);             // pipe plants
  L.enemy('b', 145);                              // chaser beetle between the stair pyramids
  L.enemy('f', 171);                              // hopper frog
  L.stairsUp(148, 4); L.column(152, 4); L.stairsDown(155, 4);
  L.pipe(163, 2); L.row(168, 9, 'BB?B'); L.enemy('g', 172); L.enemy('g', 174); L.pipe(179, 2);
  L.stairsUp(181, 8); L.column(189, 8);
  L.flag(198); L.castle(202);
  L.checkpoint = 82;
  return L.finish();
}

function buildLevel2() {
  const L = new Level(196, THEMES.cave, 300);
  L.ground(0, 45); L.ground(49, 90); L.ground(94, 96); L.ground(100, 140); L.ground(144, 195);
  L.fill(0, 2, 170, 2, 'B');                       // cave ceiling
  L.row(10, 9, 'M????');
  L.enemy('g', 16); L.enemy('g', 18); L.enemy('k', 24);
  L.enemy('P', 28); L.enemy('P', 72);             // fireball-spitting plants
  L.enemy('r', 40, 4);                            // red shellback patrols the brick ledge
  L.pipe(28, 3); L.pipe(34, 2);
  L.row(38, 5, 'BBBBBB'); L.coins(39, 4, 4);
  L.coins(46, 9, 3);
  L.stairsUp(52, 3); L.stairsDown(55, 3);
  L.enemy('b', 59); L.enemy('g', 61); L.enemy('k', 64);
  L.row(62, 9, 'B$B'); L.row(66, 9, 'BBBB'); L.row(66, 5, 'BB*B');
  L.pipe(72, 4); L.enemy('g', 75); L.pipe(78, 3);
  L.coins(91, 9, 3); L.row(95, 9, 'M'); L.coins(97, 9, 3);
  L.row(104, 9, 'B?B?B');
  L.enemy('k', 108); L.enemy('b', 112);
  L.enemy('f', 86); L.enemy('f', 136); L.enemy('g', 114);
  L.fill(118, 10, 119, 12, 'B');                   // brick wall: break it when big, or hop over
  L.row(124, 9, '????'); L.row(129, 6, 'BBBGBB');
  L.enemy('g', 130, 5); L.enemy('g', 133, 5);
  L.coins(141, 8, 3);
  L.stairsUp(150, 5); L.stairsDown(155, 5);
  L.pipe(165, 2); L.enemy('g', 168); L.enemy('k', 172);
  L.stairsUp(174, 6); L.column(180, 6);
  L.flag(184); L.castle(188);
  L.checkpoint = 100;
  return L.finish();
}

const LEVELS = [
  { name: '1-1', title: 'Sunny Fields', build: buildLevel1 },
  { name: '1-2', title: 'Crystal Caverns', build: buildLevel2 },
];

// ================================================================ physics helpers
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const isSolid = (tx, ty) => SOLID.has(game.level.get(tx, ty));

// Moves e by its velocity, resolving tile collisions axis by axis.
// Sets e.onGround / e.hitWall; returns {ty, hits} when the head hit tiles.
function moveAndCollide(e) {
  e.hitWall = false;
  e.x += e.vx;
  const top = Math.floor(e.y / TILE), bot = Math.floor((e.y + e.h - 0.01) / TILE);
  if (e.vx > 0) {
    const tx = Math.floor((e.x + e.w - 0.01) / TILE);
    for (let ty = top; ty <= bot; ty++) if (isSolid(tx, ty)) { e.x = tx * TILE - e.w; e.hitWall = true; break; }
  } else if (e.vx < 0) {
    const tx = Math.floor(e.x / TILE);
    for (let ty = top; ty <= bot; ty++) if (isSolid(tx, ty)) { e.x = (tx + 1) * TILE; e.hitWall = true; break; }
  }

  e.y += e.vy;
  e.onGround = false;
  const l = Math.floor(e.x / TILE), r = Math.floor((e.x + e.w - 0.01) / TILE);
  if (e.vy > 0) {
    const ty = Math.floor((e.y + e.h - 0.01) / TILE);
    for (let tx = l; tx <= r; tx++) {
      if (isSolid(tx, ty)) { e.y = ty * TILE - e.h; e.vy = 0; e.onGround = true; break; }
    }
  } else if (e.vy < 0) {
    const ty = Math.floor(e.y / TILE);
    const hits = [];
    for (let tx = l; tx <= r; tx++) if (isSolid(tx, ty)) hits.push(tx);
    if (hits.length) {
      // Corner correction: barely clipping a block edge nudges you past it instead of stopping the jump
      if (e.cornerCorrect && hits.length === 1 && l !== r) {
        const tx = hits[0];
        if (tx === r && e.x + e.w - tx * TILE <= 5 && !isSolid(l, ty)) { e.x = tx * TILE - e.w; return null; }
        if (tx === l && (tx + 1) * TILE - e.x <= 5 && !isSolid(r, ty)) { e.x = (tx + 1) * TILE; return null; }
      }
      e.y = (ty + 1) * TILE; e.vy = 0;
      return { ty, hits };
    }
  }
  return null;
}

// True if the tile just past e's leading foot is empty (walking on would fall off)
function ledgeAhead(e) {
  if (!e.onGround || e.vx === 0) return false;
  const fx = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
  return !isSolid(Math.floor(fx / TILE), Math.floor((e.y + e.h + 1) / TILE));
}

function walkerPhysics(e, grav = GRAVITY) {
  e.vy = Math.min(e.vy + grav, 4);
  const vx = e.vx;
  moveAndCollide(e);
  if (e.hitWall) e.vx = -vx;
  if (e.y > VH + 32) e.dead = true;
}

// Hero movement for one frame. Shared by the real player and the AI agent's simulator
// (agent.js), so the agent's predicted trajectories match the game exactly.
// b needs x, y, w, h, vx, vy, onGround, facing, coyote, jumpBuf, cornerCorrect.
function playerPhysics(b, inp) {
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const maxV = inp.run ? 2.5 : 1.5;
  let skid = false, jumped = false;
  if (dir !== 0) {
    if (b.onGround) b.facing = dir;
    if (b.vx * dir < 0 && b.onGround) { b.vx += dir * 0.18; skid = true; }
    else if (Math.abs(b.vx) < maxV) b.vx += dir * (b.onGround ? 0.08 : 0.06);
    if (b.vx * dir > maxV) b.vx = approach(b.vx, dir * maxV, 0.04);   // let go of run: ease down
  } else if (b.onGround) b.vx = approach(b.vx, 0, 0.09);

  // Coyote time + jump buffering make jumps feel fair
  b.coyote = b.onGround ? 6 : Math.max(0, b.coyote - 1);
  b.jumpBuf = inp.jumpPressed ? 7 : Math.max(0, b.jumpBuf - 1);
  if (b.jumpBuf > 0 && b.coyote > 0) {
    b.vy = -(5.4 + Math.abs(b.vx) * 0.3);
    b.coyote = 0; b.jumpBuf = 0; jumped = true;
  }
  // Holding jump = floatier rise (variable jump height)
  b.vy = Math.min(b.vy + (b.vy < 0 && inp.jump ? 0.2 : 0.55), 5.5);

  const head = moveAndCollide(b);
  if (b.hitWall) b.vx = 0;
  if (b.x < game.camX) { b.x = game.camX; if (b.vx < 0) b.vx = 0; }
  const maxX = game.level.w * TILE - b.w;
  if (b.x > maxX) { b.x = maxX; b.vx = 0; }
  return { head, skid, jumped };
}

// ================================================================ entities
class Entity {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0; this.onGround = false; this.hitWall = false; this.dead = false;
  }
  get cx() { return this.x + this.w / 2; }
}

class Player extends Entity {
  constructor(x, bottom, big) {
    super(x, 0, 12, big ? 28 : 14);
    this.big = big; this.y = bottom - this.h; this.prevBottom = bottom;
    this.facing = 1; this.coyote = 0; this.jumpBuf = 0; this.walkAnim = 0;
    this.invuln = 0; this.star = 0; this.combo = 0; this.starCombo = 0;
    this.cornerCorrect = true; this.hidden = false; this.dying = false;
  }
  setBig(b) {
    if (b === this.big) return;
    const bottom = this.y + this.h;
    this.big = b; this.h = b ? 28 : 14; this.y = bottom - this.h;
  }
  update() {
    this.prevBottom = this.y + this.h;
    const wasAir = !this.onGround, fallSpeed = this.vy;
    const r = playerPhysics(this, input);
    if (r.jumped) sfx(this.big ? 'jumpBig' : 'jump');
    if (r.skid && (game.frame & 3) === 0) game.fx.push(new Dust(this.cx + Math.sign(this.vx) * 4, this.y + this.h - 3));
    if (wasAir && this.onGround && fallSpeed > 3.5) {
      game.fx.push(new Dust(this.x, this.y + this.h - 3), new Dust(this.x + this.w - 3, this.y + this.h - 3));
    }
    if (r.head) {
      const mid = Math.floor(this.cx / TILE);
      bumpTile(r.head.hits.includes(mid) ? mid : r.head.hits[0], r.head.ty, this);
    }
    if (this.onGround) this.combo = 0;

    collectTileCoins(this);
    if (this.invuln > 0) this.invuln--;
    if (this.star > 0 && --this.star === 0) music('play', game.level.theme.song);
    if (this.onGround) this.walkAnim += Math.abs(this.vx) * 0.09;
    if (this.y > VH + 8) killPlayer();
  }
  hurt() {
    if (this.invuln > 0 || this.star > 0 || game.state !== 'play') return;
    if (this.big) {
      this.setBig(false);
      this.invuln = 120;
      shake(8);
      freeze('shrink');
      sfx('shrink');
    } else killPlayer();
  }
  draw(camX) {
    if (this.hidden) return;
    if (this.invuln > 0 && (game.frame & 2) && game.freeze === 0) return;
    if (this.dying) { drawSprite(HERO[0].small.dead, this, true, camX); return; }
    let big = this.big;
    if (game.freeze > 0) big = (game.freeze >> 2) & 1 ? !this.big : this.big;  // grow/shrink flicker
    const pal = this.star > 0 ? 1 + ((game.frame >> 2) % 3) : 0;
    const set = HERO[pal][big ? 'big' : 'small'];
    let sp;
    if (!this.onGround) sp = set.jump;
    else if (Math.abs(this.vx) > 0.15) sp = set.walk[Math.floor(this.walkAnim) % 3];
    else sp = set.stand;
    const fake = { x: this.x, y: this.y + this.h - (big ? 28 : 14), w: this.w, h: big ? 28 : 14 };
    drawSprite(sp, fake, this.facing > 0, camX);
  }
}

class Enemy extends Entity {
  constructor(x, y, w, h) { super(x, y, w, h); this.alive = true; this.flipping = false; this.anim = 0; }
  flip(dir) {
    this.alive = false; this.flipping = true;
    this.vy = -3.5; this.vx = (dir || 1) * 0.7;
  }
  updateFlip() {
    if (!this.flipping) return false;
    this.vy += GRAVITY; this.x += this.vx; this.y += this.vy;
    if (this.y > VH + 32) this.dead = true;
    return true;
  }
}

class Goomba extends Enemy {
  constructor(x, bottom) { super(x, bottom - 14, 12, 14); this.vx = -0.5; this.flat = 0; }
  update() {
    if (this.updateFlip()) return;
    if (this.flat) { if (--this.flat <= 0) this.dead = true; return; }
    walkerPhysics(this);
    this.anim++;
  }
  stomp() { this.alive = false; this.flat = 30; }
  draw(camX) {
    if (this.flat) drawSprite(SPR.goombaFlat, this, true, camX);
    else drawSprite(SPR.goomba, this, (this.anim >> 3) & 1, camX, this.flipping);
  }
}

// Green koopas walk off ledges; red ones (red = true) patrol and turn around at edges
class Koopa extends Enemy {
  constructor(x, bottom, red = false) { super(x, bottom - 22, 12, 22); this.vx = -0.5; this.red = red; }
  update() {
    if (this.updateFlip()) return;
    if (this.red && ledgeAhead(this)) this.vx = -this.vx;
    walkerPhysics(this);
    this.anim++;
  }
  stomp() {
    this.dead = true; this.alive = false;
    game.enemies.push(new Shell(this.x - 1, this.y + this.h, this.red));
  }
  draw(camX) {
    const frames = this.red ? SPR.redKoopa : SPR.koopa;
    drawSprite(frames[(this.anim >> 3) & 1], this, this.vx > 0, camX, this.flipping);
  }
}

// Chaser beetle: patrols without falling off ledges, locks on when the hero is close,
// and hops over low obstacles while chasing.
class Beetle extends Enemy {
  constructor(x, bottom) { super(x, bottom - 14, 12, 14); this.vx = -0.4; this.flat = 0; this.think = 0; this.chasing = false; }
  update() {
    if (this.updateFlip()) return;
    if (this.flat) { if (--this.flat <= 0) this.dead = true; return; }
    const p = game.player;
    if (--this.think <= 0 && this.onGround) {
      this.think = 20;
      const dx = p.cx - this.cx, dy = p.y + p.h - (this.y + this.h);
      this.chasing = !p.dying && Math.abs(dx) < 112 && Math.abs(dy) < 56;
      if (this.chasing && Math.abs(dx) > 6) this.vx = Math.sign(dx) * 0.95;
      else if (!this.chasing) this.vx = Math.sign(this.vx || -1) * 0.4;
    }
    if (ledgeAhead(this)) this.vx = -this.vx;
    const vx = this.vx;
    walkerPhysics(this);
    if (this.hitWall && this.chasing && this.onGround) { this.vx = vx; this.vy = -4.6; }
    this.anim += this.chasing ? 2 : 1;
  }
  stomp() { this.alive = false; this.flat = 30; }
  draw(camX) {
    if (this.flat) drawSprite(SPR.beetleFlat, this, true, camX);
    else drawSprite(SPR.beetle, this, (this.anim >> 3) & 1, camX, this.flipping);
  }
}

// Hopper frog: crouches, then leaps toward the hero
class Frog extends Enemy {
  constructor(x, bottom) { super(x, bottom - 15, 14, 15); this.timer = 60; this.flat = 0; this.facing = -1; }
  update() {
    if (this.updateFlip()) return;
    if (this.flat) { if (--this.flat <= 0) this.dead = true; return; }
    const p = game.player;
    const dx = p.cx - this.cx;
    if (this.onGround) {
      this.vx = 0;
      this.facing = Math.sign(dx) || this.facing;
      if (--this.timer <= 0 && Math.abs(dx) < 170 && !p.dying) {
        this.vy = p.y + p.h < this.y ? -6.2 : -5;
        this.vx = Math.sign(dx) * Math.min(1.6, Math.abs(dx) / 40 + 0.6);
        this.timer = 55 + Math.floor(Math.random() * 45);
        this.onGround = false;
      }
    }
    walkerPhysics(this, 0.25);
  }
  stomp() { this.alive = false; this.flat = 30; }
  draw(camX) {
    if (this.flat) {
      const img = this.facing > 0 ? SPR.frog[0].r : SPR.frog[0].l;
      ctx.drawImage(img, Math.round(this.x - 1 - camX), Math.round(this.y + this.h - 8), 16, 8);
    } else drawSprite(SPR.frog[this.onGround ? 0 : 1], this, this.facing > 0, camX, this.flipping);
  }
}

// Pipe plant: rises and sinks on a cycle, stays hidden while the hero stands near the pipe,
// and (in shooter mode) spits a fireball aimed at the hero.
class Plant extends Enemy {
  constructor(tx, shooter) {
    super(tx * TILE + 10, 0, 12, 0);
    let top = 0;
    while (top < ROWS && game.level.get(tx, top) !== '[') top++;
    this.top = top * TILE;
    this.y = this.top;
    this.emerged = 0; this.phase = 'hidden'; this.timer = 60;
    this.shooter = shooter; this.static = true; this.noStomp = true; this.behindTiles = true;
  }
  update() {
    if (this.updateFlip()) return;
    const p = game.player;
    this.timer--;
    if (this.phase === 'hidden' && this.timer <= 0) {
      if (Math.abs(p.cx - this.cx) > 30) this.phase = 'rising'; else this.timer = 30;
    } else if (this.phase === 'rising') {
      this.emerged = Math.min(24, this.emerged + 0.5);
      if (this.emerged >= 24) { this.phase = 'up'; this.timer = 90; }
    } else if (this.phase === 'up') {
      if (this.shooter && this.timer === 50 && onScreen(this)) this.shoot(p);
      if (this.timer <= 0) this.phase = 'sinking';
    } else if (this.phase === 'sinking') {
      this.emerged = Math.max(0, this.emerged - 0.5);
      if (this.emerged <= 0) { this.phase = 'hidden'; this.timer = 90; }
    }
    this.y = this.top - this.emerged;
    this.h = this.emerged;
  }
  shoot(p) {
    const sx = this.cx, sy = this.y + 6;
    const dx = p.cx - sx, dy = p.y + p.h / 2 - sy, d = Math.hypot(dx, dy) || 1;
    game.enemies.push(new Fireball(sx - 3, sy - 3, (dx / d) * 1.3, (dy / d) * 1.3));
  }
  stomp() { /* can't be stomped */ }
  draw(camX) {
    const img = SPR.plant[this.phase === 'up' && (game.frame >> 3) & 1 ? 1 : 0];
    if (this.flipping) { drawSprite(img, { x: this.x, y: this.y, w: this.w, h: 24 }, true, camX, true); return; }
    if (this.emerged > 0) ctx.drawImage(img, Math.round(this.x - 2 - camX), Math.round(this.top - this.emerged));
  }
}

class Fireball extends Enemy {
  constructor(x, y, vx, vy) {
    super(x, y, 6, 6);
    this.vx = vx; this.vy = vy; this.static = true; this.noStomp = true; this.life = 300;
  }
  update() {
    if (this.updateFlip()) return;
    this.x += this.vx; this.y += this.vy;
    if (--this.life <= 0 || this.y > VH || this.y < -16) this.dead = true;
  }
  stomp() { /* hazard */ }
  draw(camX) { ctx.drawImage(SPR.fireball[(game.frame >> 2) & 1], Math.round(this.x - 1 - camX), Math.round(this.y - 1)); }
}

class Shell extends Enemy {
  constructor(x, bottom, red = false) {
    super(x, bottom - 14, 14, 14);
    this.red = red;
    this.moving = false; this.idle = 0; this.grace = 10; this.combo = 0;
  }
  update() {
    if (this.updateFlip()) return;
    if (this.grace > 0) this.grace--;
    walkerPhysics(this);
    if (this.hitWall && this.moving && onScreen(this)) { sfx('bump'); shake(3); }
    if (!this.moving) {
      if (++this.idle > 480) {   // the koopa climbs back out
        this.dead = true; this.alive = false;
        game.enemies.push(new Koopa(this.x + 1, this.y + this.h, this.red));
      }
      return;
    }
    for (const e of game.enemies) {
      if (e !== this && e.alive && overlap(this, e)) {
        e.flip(Math.sign(this.vx));
        sfx('kick');
        comboScore(this.combo++, e.x, e.y);
      }
    }
  }
  kick(dir) {
    this.moving = true; this.vx = dir * 3.5;
    this.grace = 12; this.combo = 0; this.idle = 0;
    sfx('kick');
  }
  stop() { this.moving = false; this.vx = 0; this.idle = 0; this.grace = 10; }
  draw(camX) {
    const shake = !this.moving && this.idle > 400 ? ((game.frame & 4) ? 1 : -1) : 0;
    drawSprite(this.red ? SPR.redShell : SPR.shell, this, true, camX - shake, this.flipping);
  }
}

class Item extends Entity {
  constructor(tx, ty, kind) {
    super(tx * TILE + 1, ty * TILE, 14, 16);
    this.kind = kind; this.rise = 32;
  }
  update() {
    if (this.rise > 0) {
      this.y -= 0.5;
      if (--this.rise === 0) this.vx = this.kind === 'star' ? 1.3 : 1;
      return;
    }
    walkerPhysics(this, this.kind === 'star' ? 0.22 : GRAVITY);
    if (this.kind === 'star' && this.onGround) this.vy = -4.5;
  }
  collect(p) {
    this.dead = true;
    if (this.kind === 'mush') {
      if (!p.big) { p.setBig(true); freeze('grow'); }
      sfx('powerup');
      addScore(1000, this.x, this.y);
    } else if (this.kind === '1up') {
      oneUp(this.x, this.y);
    } else if (this.kind === 'star') {
      p.star = 600; p.starCombo = 0;
      music('play', 'star');
      sfx('powerup');
      addScore(1000, this.x, this.y);
    }
  }
  draw(camX) { drawSprite(SPR[this.kind], this, true, camX); }
}

class CoinPop {
  constructor(tx, ty) { this.x = tx * TILE; this.y = ty * TILE - 16; this.vy = -5; this.t = 0; this.dead = false; }
  update() {
    this.y += this.vy; this.vy += 0.3; this.t++;
    if (this.vy > 2.5) { this.dead = true; popup('200', this.x + 4, this.y); }
  }
  draw(camX) { drawCoin(this.x - camX, this.y, this.t * 3); }
}

class BrickBit {
  constructor(x, y, vx, vy, color) { Object.assign(this, { x, y, vx, vy, color, t: 0, dead: false }); }
  update() {
    this.x += this.vx; this.y += this.vy; this.vy += 0.35; this.t++;
    if (this.y > VH) this.dead = true;
  }
  draw(camX) {
    const x = Math.round(this.x - camX), y = Math.round(this.y);
    ctx.fillStyle = this.color; ctx.fillRect(x, y, 7, 7);
    ctx.fillStyle = '#000';
    if ((this.t >> 2) & 1) ctx.fillRect(x, y + 3, 7, 1); else ctx.fillRect(x + 3, y, 1, 7);
  }
}

class Dust {
  constructor(x, y) { Object.assign(this, { x, y, t: 0, dead: false }); }
  update() { this.t++; this.y -= 0.25; if (this.t > 14) this.dead = true; }
  draw(camX) {
    const s = 2 + (this.t >> 2);
    ctx.globalAlpha = 1 - this.t / 15;
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(Math.round(this.x - camX - s / 2), Math.round(this.y - s / 2), s, s);
    ctx.globalAlpha = 1;
  }
}

class Popup {
  constructor(text, x, y) { Object.assign(this, { text, x, y, t: 45, dead: false }); }
  update() { this.y -= 0.6; if (--this.t <= 0) this.dead = true; }
  draw(camX) { text(this.text, Math.round(this.x - camX), Math.round(this.y), '#fcfcfc', 'left', 7); }
}

// ================================================================ game state
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : +v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } },
};

const game = {
  state: 'menu', paused: false, levelIndex: 0,
  score: 0, coins: 0, lives: 3, carryBig: false,
  hiScore: store.get('spq-hi', 0), unlocked: store.get('spq-unlocked', 0),
  level: null, player: null, enemies: [], items: [], fx: [], bumps: [],
  camX: 0, timer: 0, freeze: 0, time: 0, timeTick: 0, frame: 0,
  spawnIdx: 0, checkpoint: false, flag: null, hurried: false, menuMusic: false,
};

const listeners = {};
function emit(ev, data) { (listeners[ev] || []).forEach(cb => { try { cb(data); } catch (e) { console.error(e); } }); }
function setState(s) {
  if (game.state === s) return;
  game.state = s;
  emit('statechange', s);
}
const stats = () => ({
  score: game.score, coins: game.coins, lives: game.lives, hiScore: game.hiScore,
  levelIndex: game.levelIndex, unlocked: game.unlocked,
  ai: !!game.aiUsed, agent: !!(window.Agent && Agent.active),
});
function saveHi() {
  if (!game.aiUsed && game.score > game.hiScore) { game.hiScore = game.score; store.set('spq-hi', game.score); }
}

function addScore(pts, x, y) { game.score += pts; if (x !== undefined) popup(String(pts), x, y); }
function popup(t, x, y) { game.fx.push(new Popup(t, x, y)); }
function oneUp(x, y) { game.lives++; sfx('oneup'); popup('1UP', x, y); }
function comboScore(n, x, y) { if (n >= COMBO.length) oneUp(x, y); else addScore(COMBO[n], x, y); }
function addCoin() {
  game.coins++; game.score += 200; sfx('coin');
  if (game.coins >= 100) { game.coins -= 100; game.lives++; sfx('oneup'); }
}
function shake(n) { game.shake = Math.max(game.shake || 0, n); }
function freeze(kind) { game.freeze = 40; game.freezeKind = kind; }
const onScreen = e => e.x + e.w > game.camX && e.x < game.camX + VW;

function collectTileCoins(e) {
  const L = game.level;
  for (let ty = Math.floor(e.y / TILE); ty <= Math.floor((e.y + e.h - 1) / TILE); ty++) {
    for (let tx = Math.floor(e.x / TILE); tx <= Math.floor((e.x + e.w - 1) / TILE); tx++) {
      if (L.get(tx, ty) === 'c') { L.set(tx, ty, '.'); addCoin(); }
    }
  }
}

function coinFromBlock(tx, ty) { game.fx.push(new CoinPop(tx, ty)); addCoin(); }

function bumpTile(tx, ty, p) {
  const L = game.level, c = L.get(tx, ty), key = tx + ',' + ty, content = L.content.get(key);
  if (c === '?' || (c === 'B' && content)) {
    let used = true;
    if (!content || content === 'coin') coinFromBlock(tx, ty);
    else if (content === 'multi') {
      coinFromBlock(tx, ty);
      const left = (L.multi.has(key) ? L.multi.get(key) : 10) - 1;
      L.multi.set(key, left);
      used = left <= 0;
    } else {
      game.items.push(new Item(tx, ty, content));
      sfx('sprout');
    }
    if (used) { L.set(tx, ty, 'U'); L.content.delete(key); }
    game.bumps.push({ tx, ty, t: 0 });
    hitAbove(tx, ty);
  } else if (c === 'B') {
    if (p.big) {
      L.set(tx, ty, '.');
      const x = tx * TILE, y = ty * TILE, col = L.theme.base;
      game.fx.push(new BrickBit(x, y, -1, -6, col), new BrickBit(x + 8, y, 1, -6, col),
        new BrickBit(x, y + 8, -1, -4, col), new BrickBit(x + 8, y + 8, 1, -4, col));
      addScore(50);
      sfx('break');
      shake(5);
    } else {
      game.bumps.push({ tx, ty, t: 0 });
      sfx('bump');
    }
    hitAbove(tx, ty);
  } else sfx('bump');
}

// Anything standing on a block that gets hit from below gets knocked
function hitAbove(tx, ty) {
  const top = ty * TILE, l = tx * TILE, r = l + TILE;
  for (const e of game.enemies) {
    if (e.alive && e.x < r && e.x + e.w > l && Math.abs(e.y + e.h - top) < 4) {
      e.flip(e.cx < l + 8 ? -1 : 1);
      addScore(100, e.x, e.y - 8);
      sfx('kick');
    }
  }
  for (const it of game.items) {
    if (it.rise === 0 && it.x < r && it.x + it.w > l && Math.abs(it.y + it.h - top) < 4) {
      it.vy = -4;
      it.vx = (it.cx < l + 8 ? -1 : 1) * Math.max(1, Math.abs(it.vx));
    }
  }
  if (game.level.get(tx, ty - 1) === 'c') { game.level.set(tx, ty - 1, '.'); coinFromBlock(tx, ty - 1); }
}

// ---------------------------------------------------------------- flow
function newGame(levelIndex, ai = false) {
  game.aiUsed = ai;
  if (window.Agent && Agent.active !== ai) { Agent.setActive(ai); emit('agent', ai); }
  game.score = 0; game.coins = 0; game.lives = 3; game.carryBig = false;
  game.levelIndex = Math.max(0, Math.min(levelIndex | 0, LEVELS.length - 1));
  game.checkpoint = false;
  showLevelStart();
}

function showLevelStart() {
  game.paused = false;
  music('stop');
  game.timer = 150;
  setState('levelstart');
}

function startLevel() {
  const def = LEVELS[game.levelIndex];
  const L = game.level = def.build();
  game.enemies = []; game.items = []; game.fx = []; game.bumps = [];
  game.flag = null; game.freeze = 0; game.hurried = false;
  const startX = game.checkpoint ? L.checkpoint * TILE : 3 * TILE;
  game.player = new Player(startX, 13 * TILE, game.carryBig);
  game.camX = Math.max(0, Math.min(startX - 64, L.w * TILE - VW));
  game.spawnIdx = 0;
  while (game.spawnIdx < L.spawns.length && L.spawns[game.spawnIdx].x * TILE < startX + 80) game.spawnIdx++;
  game.time = L.time; game.timeTick = 0;
  music('setFast', false);
  music('play', L.theme.song);
  if (window.Agent) Agent.onLevelStart();
  setState('play');
}

function killPlayer() {
  const p = game.player;
  if (game.state !== 'play') return;
  p.dying = true; p.setBig(false); p.star = 0;
  game.carryBig = false;
  game.timer = 0;
  music('stop');
  sfx('die');
  setState('dying');
}

function startFlag() {
  const L = game.level, p = game.player;
  const poleX = L.flagX * TILE + 7;
  p.x = poleX - p.w; p.vx = 0; p.vy = 0; p.star = 0; p.facing = 1;
  const h = 192 - (p.y + p.h);
  addScore(h >= 128 ? 5000 : h >= 96 ? 2000 : h >= 64 ? 800 : h >= 32 ? 400 : 100, poleX + 6, p.y);
  game.flag = { phase: 0, timer: 0, flagY: 48 };
  game.carryBig = p.big;
  music('stop');
  sfx('flag');
  setState('flag');
}

function updateCamera() {
  const L = game.level, p = game.player;
  const target = p.cx - 112;
  if (target > game.camX) game.camX = Math.min(target, L.w * TILE - VW);
}

function spawnEntities() {
  const L = game.level;
  while (game.spawnIdx < L.spawns.length && L.spawns[game.spawnIdx].x * TILE < game.camX + VW + 32) {
    const s = L.spawns[game.spawnIdx++];
    const x = s.x * TILE + 2, bottom = (s.y + 1) * TILE;
    const make = {
      g: () => new Goomba(x, bottom),
      k: () => new Koopa(x, bottom),
      r: () => new Koopa(x, bottom, true),
      b: () => new Beetle(x, bottom),
      f: () => new Frog(x, bottom),
      p: () => new Plant(s.x, false),
      P: () => new Plant(s.x, true),
    }[s.type];
    if (make) game.enemies.push(make());
  }
}

function updateList(list) {
  for (let i = 0; i < list.length; i++) list[i].update();
}
function prune() {
  const left = game.camX - 64;
  const keep = e => !e.dead && e.x + (e.w || 16) > left;
  game.enemies = game.enemies.filter(keep);
  game.items = game.items.filter(keep);
  game.fx = game.fx.filter(e => !e.dead);
  game.bumps = game.bumps.filter(b => ++b.t < 10);
}

function enemyCollisions() {
  const es = game.enemies;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j];
      if (!a.alive || !b.alive || a.moving || b.moving || a.static || b.static || !overlap(a, b)) continue;
      if (a.x < b.x) { a.vx = -Math.abs(a.vx); b.vx = Math.abs(b.vx); }
      else { a.vx = Math.abs(a.vx); b.vx = -Math.abs(b.vx); }
    }
  }
}

function playerCollisions() {
  const p = game.player;
  for (const e of game.enemies) {
    if (!e.alive || !overlap(p, e) || game.state !== 'play') continue;
    if (p.star > 0) {
      e.flip(p.facing); sfx('kick');
      comboScore(p.starCombo++, e.x, e.y);
      continue;
    }
    if (e.noStomp) { p.hurt(); continue; }
    const fromAbove = p.vy > 0 && p.prevBottom <= e.y + 6;
    const bounce = () => { p.y = e.y - p.h; p.vy = input.jump ? -5.5 : -3.5; };
    if (e instanceof Shell) {
      if (e.grace > 0) continue;
      if (!e.moving) {
        e.kick(p.cx < e.cx ? 1 : -1);
        addScore(400, e.x, e.y - 8);
        if (fromAbove) bounce();
      } else if (fromAbove) {
        e.stop(); bounce(); sfx('stomp');
        comboScore(p.combo++, e.x, e.y - 8);
      } else p.hurt();
      continue;
    }
    if (fromAbove) {
      e.stomp(); bounce(); sfx('stomp');
      comboScore(p.combo++, e.x, e.y - 8);
    } else p.hurt();
  }
  for (const it of game.items) if (!it.dead && overlap(p, it)) it.collect(p);
}

// ---------------------------------------------------------------- per-state updates
function updatePlay() {
  if (input.pausePressed) { pauseGame(); return; }
  if (game.freeze > 0) { game.freeze--; return; }
  const L = game.level, p = game.player;

  if (++game.timeTick >= 24) {
    game.timeTick = 0;
    game.time--;
    if (game.time === 100 && !game.hurried) { game.hurried = true; sfx('hurry'); music('setFast', true); }
    if (game.time <= 0) { game.time = 0; killPlayer(); return; }
  }

  spawnEntities();
  p.update();
  if (game.state !== 'play') return;
  updateCamera();
  updateList(game.enemies);
  updateList(game.items);
  updateList(game.fx);
  enemyCollisions();
  playerCollisions();
  prune();

  if (p.x > L.checkpoint * TILE) game.checkpoint = true;
  if (game.state === 'play' && L.flagX !== null && p.x + p.w >= L.flagX * TILE + 7) startFlag();
}

function updateDying() {
  const p = game.player;
  game.timer++;
  updateList(game.fx); prune();
  if (game.timer === 30) p.vy = -6;
  if (game.timer > 30) { p.vy += 0.25; p.y += p.vy; }
  if (game.timer > 200) {
    game.lives--;
    if (game.lives <= 0) {
      saveHi();
      sfx('gameover');
      setState('gameover');
      emit('gameover', stats());
    } else showLevelStart();
  }
}

function updateFlag() {
  const f = game.flag, p = game.player, L = game.level;
  const poleX = L.flagX * TILE + 7;
  f.timer++;
  updateList(game.fx); updateList(game.enemies); prune();
  updateCamera();
  switch (f.phase) {
    case 0: // slide down the pole
      p.y = Math.min(p.y + 2, 192 - p.h);
      f.flagY = Math.min(f.flagY + 2, 176);
      if (p.y + p.h >= 192 && f.flagY >= 176) { f.phase = 1; f.timer = 0; }
      break;
    case 1: // hop around the pole
      if (f.timer === 16) { p.x = poleX + 2; p.facing = -1; }
      if (f.timer === 36) { f.phase = 2; sfx('clear'); }
      break;
    case 2: { // walk into the castle
      p.facing = 1; p.vx = 1.2; p.vy = Math.min(p.vy + 0.4, 5);
      moveAndCollide(p);
      p.walkAnim += 0.1;
      const door = (L.castleX + 2) * TILE + 8;
      if (p.cx >= door) { p.hidden = true; f.phase = 3; f.timer = 0; }
      break;
    }
    case 3: // time bonus
      if (f.timer > 30) {
        if (game.time > 0) {
          const d = Math.min(game.time, 2);
          game.time -= d; game.score += 50 * d;
          if (f.timer % 3 === 0) sfx('tick');
        } else { f.phase = 4; f.timer = 0; }
      }
      break;
    case 4:
      if (f.timer > 90) finishLevel();
      break;
  }
}

function finishLevel() {
  game.checkpoint = false;
  saveHi();
  const next = game.levelIndex + 1;
  if (!game.aiUsed && next > game.unlocked && next < LEVELS.length) { game.unlocked = next; store.set('spq-unlocked', next); }
  emit('levelclear', stats());
  if (next >= LEVELS.length) {
    sfx('win');
    setState('win');
    emit('win', stats());
  } else {
    game.levelIndex = next;
    showLevelStart();
  }
}

function setAgent(on) {
  if (!window.Agent) return;
  on = !!on;
  if (on === Agent.active) return;
  if (on && !AGENT_STATES.has(game.state)) return;   // only hand over control during a run
  Agent.setActive(on);
  if (on) game.aiUsed = true;
  sfx('select');
  emit('agent', on);
}

function pauseGame() {
  if (game.state !== 'play' || game.paused) return;
  game.paused = true;
  music('pause'); sfx('pause');
  emit('pause', true);
}
function resumeGame() {
  if (!game.paused) return;
  game.paused = false;
  music('resume');
  emit('pause', false);
}

function enterMenu() {
  game.paused = false;
  if (window.Agent && Agent.active) { Agent.setActive(false); emit('agent', false); }
  game.level = LEVELS[0].build();
  game.enemies = []; game.items = []; game.fx = []; game.bumps = [];
  game.player = null; game.flag = null;
  game.camX = 0;
  music('setFast', false);
  music('play', 'menu');
  setState('menu');
}

function update() {
  game.frame++;
  if (game.shake > 0 && !game.paused) game.shake--;
  if (input.mutePressed) {
    game.muted = !game.muted;
    try { window.Sound && Sound.setSfxVolume(game.muted ? 0 : game.sfxVol); Sound.setMusicVolume(game.muted ? 0 : game.musicVol); } catch (e) { /* ignore */ }
  }
  if (input.overlayPressed) { settings.aiOverlay = !settings.aiOverlay; emit('settings', { aiOverlay: settings.aiOverlay }); }
  if (input.aiPressed && game.state === 'play' && !game.paused) setAgent(!(window.Agent && Agent.active));
  if (game.paused) return;
  switch (game.state) {
    case 'menu': {
      // attract mode: slowly scroll the first level, looping
      const maxX = game.level.w * TILE - VW;
      game.camX += 0.5;
      if (game.camX > maxX) game.camX = 0;
      break;
    }
    case 'levelstart': if (--game.timer <= 0) startLevel(); break;
    case 'play': updatePlay(); break;
    case 'dying': updateDying(); break;
    case 'flag': updateFlag(); break;
  }
}

// ================================================================ rendering
function text(s, x, y, color = '#fcfcfc', align = 'left', size = 8) {
  ctx.font = `bold ${size}px "Courier New", Courier, monospace`;
  ctx.textAlign = align; ctx.textBaseline = 'top';
  ctx.fillStyle = '#000'; ctx.fillText(s, x + 1, y + 1);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
const pad = (n, w) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

function drawCastle(L, camX) {
  const T = getTiles(L.theme), x0 = L.castleX * TILE - camX;
  if (x0 > VW || x0 + 80 < 0) return;
  const crenels = (x, w, y) => {
    for (let i = 0; i < w; i++) ctx.drawImage(T.B, 0, 0, 16, 8, x + i * 16, y, 16, 8);
    ctx.fillStyle = L.theme.sky;
    for (let i = 0; i < w; i++) ctx.fillRect(x + i * 16 + 6, y, 4, 4);
  };
  for (let i = 0; i < 5; i++) for (let r = 11; r <= 12; r++) ctx.drawImage(T.B, x0 + i * 16, r * 16);
  crenels(x0, 5, 168);
  for (let i = 1; i <= 3; i++) for (let r = 8; r <= 9; r++) ctx.drawImage(T.B, x0 + i * 16, r * 16);
  crenels(x0 + 16, 3, 120);
  ctx.fillStyle = '#000';
  ctx.fillRect(x0 + 35, 182, 10, 26); ctx.fillRect(x0 + 37, 179, 6, 3);   // door
  ctx.fillRect(x0 + 22, 132, 4, 10); ctx.fillRect(x0 + 54, 132, 4, 10);   // windows
}

function drawFlag(L, camX) {
  const px = L.flagX * TILE + 7 - camX;
  if (px < -24 || px > VW + 8) return;
  ctx.fillStyle = '#80d010'; ctx.fillRect(px, 40, 2, 152);
  ctx.fillStyle = '#005800'; ctx.fillRect(px + 1, 40, 1, 152);
  ctx.drawImage(SPR.ball, px - 3, 32);
  ctx.drawImage(SPR.flag, px - 16, game.flag ? game.flag.flagY : 48);
}

function drawWorld() {
  const L = game.level, th = L.theme, T = getTiles(th), camX = Math.round(game.camX);
  const sh = game.shake > 0 ? ((game.frame & 2) ? 1 : -1) * Math.ceil(game.shake / 4) : 0;
  ctx.save();
  ctx.translate(0, sh);
  ctx.fillStyle = th.sky; ctx.fillRect(0, 0, VW, VH);
  for (const d of L.decor) {
    const x = Math.round(d.x - camX * d.par);
    if (x < VW && x + d.img.width > 0) ctx.drawImage(d.img, x, d.y);
  }
  for (const it of game.items) if (it.rise > 0) it.draw(camX);   // sprouting items appear behind the block
  for (const e of game.enemies) if (e.behindTiles && !e.flipping) e.draw(camX);

  const bumpOff = new Map();
  for (const b of game.bumps) bumpOff.set(b.tx + ',' + b.ty, -Math.round(Math.sin(b.t / 10 * Math.PI) * 5));
  const qImg = T['?'][Q_CYCLE[Math.floor(game.frame / 8) % Q_CYCLE.length]];
  const tx0 = Math.floor(camX / TILE), tx1 = Math.min(L.w - 1, tx0 + VW / TILE);
  for (let ty = 0; ty < ROWS; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = L.t[ty][tx];
      if (c === '.') continue;
      const x = tx * TILE - camX;
      if (c === 'c') { drawCoin(x, ty * TILE, game.frame + tx * 6); continue; }
      const img = c === '?' ? qImg : T[c];
      if (img) ctx.drawImage(img, x, ty * TILE + (bumpOff.size ? bumpOff.get(tx + ',' + ty) || 0 : 0));
    }
  }
  if (L.flagX !== null) drawFlag(L, camX);
  if (L.castleX !== null) drawCastle(L, camX);
  for (const it of game.items) if (it.rise === 0) it.draw(camX);
  for (const e of game.enemies) if (!e.behindTiles || e.flipping) e.draw(camX);
  if (game.player) game.player.draw(camX);
  for (const f of game.fx) f.draw(camX);
  ctx.restore();
}

function drawHUD() {
  const name = LEVELS[game.levelIndex].name;
  text('HERO x' + game.lives, 16, 8);
  text(pad(game.score, 6), 16, 17);
  ctx.drawImage(SPR.coin, 4, 0, 8, 16, 92, 15, 4, 8);
  text('x' + pad(game.coins, 2), 98, 17);
  text('WORLD', 144, 8); text(name, 150, 17);
  text('TIME', 202, 8);
  if (game.state !== 'levelstart') text(pad(game.time, 3), 206, 17, game.time <= 100 && game.time > 0 && (game.frame & 16) ? '#fcd848' : '#fcfcfc');
}

let fps = 60, fpsFrames = 0, fpsTime = 0;
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const s = game.state;
  if (s === 'levelstart') {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
    drawHUD();
    const def = LEVELS[game.levelIndex];
    text('WORLD ' + def.name, VW / 2, 84, '#fcfcfc', 'center', 10);
    text(def.title.toUpperCase(), VW / 2, 100, '#fcd848', 'center');
    ctx.drawImage(HERO[0].small.stand.r, 104, 120);
    text('x  ' + game.lives, 128, 125);
  } else if (game.level) {
    drawWorld();
    if (window.Agent && Agent.active && s !== 'menu') {
      if (settings.aiOverlay) Agent.drawOverlay(Math.round(game.camX));
      Agent.drawBadge();
    }
    if (s !== 'menu') drawHUD();
    if (s === 'gameover' || s === 'win' || game.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, VW, VH);
    }
  }
  if (settings.crt && SCALE >= 2) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const h = Math.max(1, Math.floor(SCALE / 3));
    for (let y = 0; y < VH; y++) ctx.fillRect(0, y * SCALE + SCALE - h, canvas.width, h);
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  }
  if (settings.showFps) text(fps + ' FPS', VW - 4, VH - 12, '#80d010', 'right');
}

// ================================================================ main loop
let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= STEP_MS) {
    pollInput();
    if (!game.paused) music('update');
    update();
    acc -= STEP_MS;
  }
  fpsFrames++;
  if (now - fpsTime >= 1000) { fps = fpsFrames; fpsFrames = 0; fpsTime = now; }
  render();
  requestAnimationFrame(frame);
}

// ================================================================ public API (used by ui.js)
game.sfxVol = 0.8; game.musicVol = 0.5; game.muted = false;
window.Game = {
  levels: LEVELS.map(l => ({ name: l.name, title: l.title })),
  start(levelIndex = 0) { audioInit(); newGame(levelIndex); },
  startAI(levelIndex = 0) { audioInit(); newGame(levelIndex, true); },
  setAgent,
  isAgent: () => !!(window.Agent && Agent.active),
  pause: pauseGame,
  resume: resumeGame,
  togglePause() { game.paused ? resumeGame() : pauseGame(); },
  isPaused: () => game.paused,
  quitToMenu() { saveHi(); enterMenu(); },
  getState: () => game.state,
  getStats: stats,
  setSettings(o = {}) {
    if (o.scale !== undefined) settings.scale = o.scale;
    if (o.crt !== undefined) settings.crt = !!o.crt;
    if (o.showFps !== undefined) settings.showFps = !!o.showFps;
    if (o.aiOverlay !== undefined) settings.aiOverlay = !!o.aiOverlay;
    try {
      // while muted (M key) remember the new volumes but keep the audio silent
      if (o.musicVolume !== undefined) { game.musicVol = +o.musicVolume; window.Sound && Sound.setMusicVolume(game.muted ? 0 : game.musicVol); }
      if (o.sfxVolume !== undefined) { game.sfxVol = +o.sfxVolume; window.Sound && Sound.setSfxVolume(game.muted ? 0 : game.sfxVol); }
    } catch (e) { /* ignore */ }
    resize();
  },
  on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); },
};
window.__game = game;   // debugging hook

// Start menu music once the browser allows audio (first user gesture)
const kickMenuMusic = () => {
  audioInit();
  if (game.state === 'menu' && !game.menuMusic) { game.menuMusic = true; music('play', 'menu'); }
};
window.addEventListener('pointerdown', kickMenuMusic);
window.addEventListener('keydown', kickMenuMusic);

enterMenu();
requestAnimationFrame(frame);
