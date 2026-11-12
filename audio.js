// Super Pixel Quest - audio.js
// NES-style synthesis with the Web Audio API: pulse (square) waves, triangle and noise.
// Exposes window.Sound and window.Music (see CONTRACT.md). All music is original.
(function () {
  'use strict';

  let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
  let sfxVol = 0.8, musicVol = 0.5;
  const pulseCache = {};

  // ---------- helpers ----------
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freq(name) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    const midi = 12 * (+m[3] + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));

  // Band-limited pulse wave with given duty cycle (0.125, 0.25, 0.5 like the NES).
  function pulse(duty) {
    if (pulseCache[duty]) return pulseCache[duty];
    const N = 32, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) re[n] = (2 * Math.sin(n * Math.PI * duty)) / (n * Math.PI);
    return (pulseCache[duty] = ctx.createPeriodicWave(re, im));
  }

  // Schedule one oscillator note. o: {wave:'triangle'|duty number, f, f2, t, dur, vol, dest, track}
  function tone(o) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    if (typeof o.wave === 'number') osc.setPeriodicWave(pulse(o.wave));
    else osc.type = o.wave || 'square';
    const t = o.t, end = t + o.dur, vol = Math.max(o.vol, 0.0002);
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, end);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    if (o.dur > 0.05) g.gain.setValueAtTime(vol, end - Math.min(0.06, o.dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(o.dest || sfxBus);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => { try { g.disconnect(); } catch (e) { /* ignore */ } };
    if (o.track) o.track.push({ src: osc, g: g, end: end });
  }

  // Filtered noise burst. o: {t, dur, vol, type, fq, dest, track}
  function noise(o) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = o.type || 'highpass';
    f.frequency.value = o.fq || 1000;
    const t = o.t, end = t + o.dur;
    g.gain.setValueAtTime(Math.max(o.vol, 0.0002), t);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    src.connect(f).connect(g).connect(o.dest || sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(end + 0.02);
    src.onended = () => { try { g.disconnect(); f.disconnect(); } catch (e) { /* ignore */ } };
    if (o.track) o.track.push({ src: src, g: g, end: end });
  }

  // Play a list of notes in sequence: notes = [[name, lengthInSteps], ...] or names (1 step each).
  function seq(t, notes, step, wave, vol, gap) {
    for (const n of notes) {
      const name = Array.isArray(n) ? n[0] : n, len = Array.isArray(n) ? n[1] : 1;
      if (name !== '-') tone({ wave: wave, f: freq(name), t: t, dur: step * len * (gap || 0.9), vol: vol });
      t += step * len;
    }
    return t;
  }

  // ---------- sound effects (each receives start time t) ----------
  const SFX = {
    jump: (t) => tone({ wave: 0.25, f: 330, f2: 880, t, dur: 0.15, vol: 0.22 }),
    jumpBig: (t) => tone({ wave: 0.25, f: 220, f2: 660, t, dur: 0.19, vol: 0.24 }),
    coin: (t) => { tone({ wave: 0.5, f: freq('B5'), t, dur: 0.07, vol: 0.2 });
      tone({ wave: 0.5, f: freq('E6'), t: t + 0.07, dur: 0.4, vol: 0.2 }); },
    stomp: (t) => { tone({ wave: 0.5, f: 700, f2: 140, t, dur: 0.1, vol: 0.28 });
      noise({ t, dur: 0.06, vol: 0.2, type: 'lowpass', fq: 2500 }); },
    kick: (t) => { tone({ wave: 0.125, f: 1000, f2: 300, t, dur: 0.07, vol: 0.25 });
      noise({ t, dur: 0.04, vol: 0.15, fq: 3000 }); },
    bump: (t) => tone({ wave: 'triangle', f: 150, f2: 55, t, dur: 0.13, vol: 0.6 }),
    break: (t) => { noise({ t, dur: 0.3, vol: 0.45, type: 'lowpass', fq: 3500 });
      tone({ wave: 'triangle', f: 220, f2: 50, t, dur: 0.2, vol: 0.5 }); },
    sprout: (t) => { seq(t, ['C4', 'G4', 'C5', 'E4', 'B4', 'E5', 'G4', 'D5', 'G5', 'C5', 'G5', 'C6'], 0.045, 0.5, 0.16); },
    powerup: (t) => { seq(t, ['C5', 'E5', 'G5', 'C6', 'D5', 'F#5', 'A5', 'D6', 'E5', 'G#5', 'B5', 'E6', 'G5', 'B5', 'D6', 'G6'], 0.04, 0.25, 0.17); },
    shrink: (t) => { seq(t, ['G6', 'D6', 'B5', 'G5', 'E6', 'B5', 'G5', 'E5', 'C6', 'G5', 'E5', 'C5'], 0.05, 0.25, 0.17); },
    oneup: (t) => { seq(t, ['G5', 'B5', 'D6', 'G6', 'D6', ['G6', 2]], 0.075, 0.5, 0.17); },
    die: (t) => {
      tone({ wave: 0.5, f: 1000, f2: 400, t, dur: 0.12, vol: 0.2 });
      seq(t + 0.25, [['E5', 2], ['D#5', 2], ['D5', 2], ['C#5', 6]], 0.08, 0.5, 0.2);
      seq(t + 0.25, [['A3', 2], ['G#3', 2], ['G3', 2], ['F#3', 6]], 0.08, 'triangle', 0.4);
    },
    flag: (t) => { tone({ wave: 0.25, f: 200, f2: 1600, t, dur: 1.0, vol: 0.18 });
      tone({ wave: 'triangle', f: 100, f2: 800, t, dur: 1.0, vol: 0.3 }); },
    clear: (t) => {
      seq(t, ['C5', 'E5', 'G5', ['C6', 2], 'G5', ['C6', 2], '-', 'D5', 'F5', 'A5', ['D6', 2], 'B5', ['C6', 4]], 0.11, 0.5, 0.18);
      seq(t, [['C3', 3], ['G3', 2], ['C4', 3], ['D3', 3], ['G3', 2], ['C3', 4]], 0.11, 'triangle', 0.4);
    },
    gameover: (t) => {
      seq(t, [['A4', 3], ['E4', 3], ['C4', 3], ['D4', 2], ['E4', 2], ['C4', 4], ['A3', 8]], 0.1, 0.5, 0.18);
      seq(t, [['A2', 9], ['F2', 4], ['G2', 4], ['A2', 8]], 0.1, 'triangle', 0.4);
    },
    tick: (t) => tone({ wave: 0.125, f: 1760, t, dur: 0.025, vol: 0.06 }),
    hurry: (t) => { seq(t, ['A5', 'E6', 'A5', 'E6', 'B5', 'F#6', 'B5', 'F#6', 'C6', 'G6', 'C6', ['G6', 3]], 0.06, 0.5, 0.15); },
    pause: (t) => { seq(t, ['B5', 'E6', 'B5', ['E6', 2]], 0.08, 0.5, 0.17); },
    select: (t) => { seq(t, ['A5', ['E6', 2]], 0.045, 0.25, 0.15); },
    move: (t) => tone({ wave: 0.25, f: 660, t, dur: 0.03, vol: 0.1 }),
    win: (t) => {
      const mel = ['G4', 'C5', 'E5', ['G5', 2], 'E5', ['G5', 2], '-', 'A4', 'D5', 'F5', ['A5', 2], 'F5', ['A5', 2], '-',
        'B4', 'E5', 'G5', ['B5', 2], 'C6', ['D6', 2], 'B5', ['C6', 2], 'E6', ['G6', 2], ['C7', 6]];
      seq(t, mel, 0.11, 0.5, 0.17);
      seq(t, [['C3', 4], ['G3', 4], ['F3', 4], ['A3', 4], ['G3', 4], ['G2', 4], ['C3', 4], ['G3', 2], ['C4', 6]], 0.11, 'triangle', 0.4);
      for (let i = 0; i < 32; i += 2) noise({ t: t + i * 0.11, dur: 0.04, vol: 0.06, fq: 7000 });
    }
  };

  // ---------- songs (original) ----------
  // Tokens are one step each: note name = attack, '.' = hold previous, '-' = rest.
  // Drum tokens: k = kick, s = snare, h = hi-hat.
  const SONG_DEFS = {
    menu: { step: 0.24, tracks: {
      sq1: { wave: 0.5, vol: 0.11, n: 'A4 . . C5 F5 . E5 . D5 . . . A4 . . . Bb4 . D5 . F5 . D5 C5 C5 . . . . . - - ' +
        'A4 . . C5 F5 . A5 . G5 . . F5 E5 . D5 . Bb4 . . D5 C5 . G4 . F4 . . . . . - -' },
      sq2: { wave: 0.125, vol: 0.05, n: 'F4 A4 C5 A4 F4 A4 C5 A4 D4 F4 A4 F4 D4 F4 A4 F4 D4 F4 Bb4 F4 D4 F4 Bb4 F4 E4 G4 C5 G4 E4 G4 C5 G4' },
      tri: { wave: 'triangle', vol: 0.32, n: 'F2 . . . C3 . . . D3 . . . A2 . . . Bb2 . . . F3 . . . C3 . . . G2 . E2 .' },
      noi: { vol: 0.04, n: 'h - - - h - - -' } } },
    main: { step: 0.14, tracks: {
      sq1: { wave: 0.5, vol: 0.12, n: 'E5 . G5 . C6 . G5 E5 A5 . . G5 E5 . C5 . F5 . A5 . C6 . A5 F5 G5 . . . D5 . G5 . ' +
        'E5 G5 C6 . B5 . G5 . A5 . E5 . A5 . C6 . D6 . C6 A5 F5 . D5 . G5 . B5 . D6 . - -' },
      sq2: { wave: 0.25, vol: 0.05, n: 'C5 - E5 - C5 - E5 - C5 - E5 - C5 - E5 - A4 - C5 - A4 - C5 - B4 - D5 - B4 - D5 - ' +
        'C5 - E5 - C5 - E5 - C5 - E5 - C5 - E5 - A4 - D5 - A4 - D5 - B4 - D5 - F5 - D5 -' },
      tri: { wave: 'triangle', vol: 0.35, n: 'C3 - G3 - C4 - G3 - A2 - E3 - A3 - E3 - F2 - C3 - F3 - C3 - G2 - D3 - G3 - D3 - ' +
        'C3 - G3 - C4 - G3 - A2 - E3 - A3 - E3 - D3 - A3 - D4 - A3 - G2 - D3 - G3 - B2 -' },
      noi: { vol: 0.07, n: 'k - h - s - h h' } } },
    cave: { step: 0.22, tracks: {
      sq1: { wave: 0.25, vol: 0.1, n: 'A4 . . . - - C5 . B4 . . . E4 . . . - - A4 . G4 . E4 . F4 . . . . . - - ' +
        'A4 . . . - - E5 . D5 . C5 . B4 . . . - - C5 . B4 . G#4 . A4 . . . . . - -' },
      tri: { wave: 'triangle', vol: 0.34, n: 'A2 . . . . . E2 . G2 . . . . . D2 . F2 . . . . . C2 . E2 . . . B1 . G#1 .' },
      noi: { vol: 0.05, n: 'k - - - - - h - - - h - - - - -' } } },
    star: { step: 0.1, tracks: {
      sq1: { wave: 0.25, vol: 0.11, n: 'C5 E5 G5 C6 - G5 C6 - D5 F5 A5 D6 - A5 D6 - Bb4 D5 F5 Bb5 - F5 Bb5 - C5 E5 G5 C6 D6 E6 - -' },
      sq2: { wave: 0.125, vol: 0.05, n: 'G4 - G4 - E5 - E5 - A4 - A4 - F5 - F5 - F4 - F4 - D5 - D5 - G4 - G4 - B4 - G5 -' },
      tri: { wave: 'triangle', vol: 0.34, n: 'C3 C4 C3 C4 C3 C4 C3 C4 D3 D4 D3 D4 D3 D4 D3 D4 Bb2 Bb3 Bb2 Bb3 Bb2 Bb3 Bb2 Bb3 C3 C4 C3 C4 G2 G3 G2 G3' },
      noi: { vol: 0.07, n: 'k h s h k h s h' } } }
  };

  // Pre-parse tracks into per-step events: {f, len} for notes, a drum letter, or null.
  const SONGS = {};
  for (const id in SONG_DEFS) {
    const def = SONG_DEFS[id], song = { step: def.step, tracks: [], len: 0 };
    for (const ch in def.tracks) {
      const tr = def.tracks[ch], toks = tr.n.trim().split(/\s+/), ev = [];
      toks.forEach((tk, i) => {
        if (ch === 'noi') { ev.push(tk === '-' ? null : tk); return; }
        if (tk === '.' || tk === '-') { ev.push(null); return; }
        let len = 1;
        while (toks[(i + len) % toks.length] === '.' && len < toks.length) len++;
        ev.push({ f: freq(tk), len: len });
      });
      song.tracks.push({ ch: ch, wave: tr.wave, vol: tr.vol, ev: ev });
      song.len = Math.max(song.len, ev.length);
    }
    SONGS[id] = song;
  }

  // ---------- music scheduler ----------
  const LOOKAHEAD = 0.15;
  const mus = { song: null, pos: 0, next: null, paused: false, fast: false, voices: [] };
  const stepDur = () => mus.song.step / (mus.fast ? 1.35 : 1);

  function drum(kind, t, vol) {
    const v = { dest: musicBus, track: mus.voices };
    if (kind === 'k') tone(Object.assign({ wave: 'triangle', f: 160, f2: 40, t: t, dur: 0.1, vol: vol * 6 }, v));
    else if (kind === 's') noise(Object.assign({ t: t, dur: 0.12, vol: vol * 1.6, type: 'bandpass', fq: 1800 }, v));
    else noise(Object.assign({ t: t, dur: 0.04, vol: vol, fq: 7000 }, v));
  }

  function scheduleStep(t) {
    const s = mus.song, sd = stepDur();
    for (const tr of s.tracks) {
      const e = tr.ev[mus.pos % tr.ev.length];
      if (!e) continue;
      if (tr.ch === 'noi') { drum(e, t, tr.vol); continue; }
      const gap = tr.wave === 'triangle' ? 0.97 : 0.88;
      tone({ wave: tr.wave, f: e.f, t: t, dur: e.len * sd * gap, vol: tr.vol, dest: musicBus, track: mus.voices });
    }
  }

  // Quickly fade and stop every sounding/queued music voice.
  function silenceMusic() {
    if (!ctx) { mus.voices.length = 0; return; }
    const now = ctx.currentTime;
    for (const v of mus.voices) {
      try {
        v.g.gain.cancelScheduledValues(now);
        v.g.gain.setValueAtTime(Math.max(v.g.gain.value, 0.0001), now);
        v.g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        v.src.stop(now + 0.05);
      } catch (e) { /* already stopped */ }
    }
    mus.voices.length = 0;
  }

  const Music = {
    play(id) {
      if (!SONGS[id]) return;
      silenceMusic();
      mus.song = SONGS[id]; mus.pos = 0; mus.next = null; mus.paused = false;
      Music.update();
    },
    stop() { silenceMusic(); mus.song = null; mus.next = null; mus.paused = false; },
    pause() {
      if (!mus.song || mus.paused) return;
      mus.paused = true;
      if (ctx && mus.next !== null) {
        // Rewind over steps queued in the future so nothing is skipped on resume.
        const now = ctx.currentTime, sd = stepDur();
        while (mus.next - sd >= now) { mus.next -= sd; mus.pos = (mus.pos - 1 + mus.song.len) % mus.song.len; }
      }
      silenceMusic();
      mus.next = null;
    },
    resume() { if (mus.paused) { mus.paused = false; mus.next = null; Music.update(); } },
    setFast(on) { mus.fast = !!on; },
    update() {
      if (!ctx || !mus.song || mus.paused) return;
      const now = ctx.currentTime;
      if (mus.voices.length > 64) mus.voices = mus.voices.filter((v) => v.end > now);
      // First run, or fell far behind (hidden tab): resync instead of bursting missed notes.
      if (mus.next === null || mus.next < now - 0.25) mus.next = now + 0.05;
      let guard = 0;
      while (mus.next < now + LOOKAHEAD && guard++ < 32) {
        scheduleStep(mus.next);
        mus.next += stepDur();
        mus.pos = (mus.pos + 1) % mus.song.len;
      }
    }
  };

  // ---------- Sound ----------
  const Sound = {
    init() {
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
          master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
          sfxBus = ctx.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(master);
          musicBus = ctx.createGain(); musicBus.gain.value = musicVol; musicBus.connect(master);
          noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noiseBuf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended' && ctx.resume) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* audio unavailable: stay silent */ }
    },
    play(name) {
      if (!ctx || !SFX.hasOwnProperty(name)) return;
      try { SFX[name](ctx.currentTime + 0.005); } catch (e) { /* ignore */ }
    },
    setSfxVolume(v) {
      sfxVol = clamp01(v);
      if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.02);
    },
    setMusicVolume(v) {
      musicVol = clamp01(v);
      if (musicBus) musicBus.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.02);
    }
  };

  window.Sound = Sound;
  window.Music = Music;
})();
