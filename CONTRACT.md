# Super Pixel Quest — module contract

Files (all in this folder, plain browser JS, no build step, no external assets/CDNs, must work from file://):
- index.html, style.css, ui.js  -> GUI agent
- audio.js                      -> audio agent
- game.js                       -> engine (lead dev)

Script order at end of <body>: audio.js, game.js, ui.js (plain <script>, not modules).

## DOM (index.html)
<div id="app">
  <canvas id="game"></canvas>   <!-- engine renders 256x240 virtual px, sets canvas.width/height itself -->
  <div id="ui"></div>           <!-- GUI overlay, absolutely positioned over the canvas -->
</div>
The engine sizes the canvas (integer scale) and the GUI should center it (flex) on a dark background.

## window.Sound / window.Music (audio.js)
Sound.init()                  // create/resume AudioContext; safe to call repeatedly; called on user gestures
Sound.play(name)              // one-shot SFX; silently ignore unknown names or if not initialised
Sound.setSfxVolume(v)         // 0..1
Sound.setMusicVolume(v)       // 0..1
Music.play(song)              // start/restart a looping song: 'menu' | 'main' | 'cave' | 'star'
Music.stop()
Music.update()                // called by engine every 1/60 s tick; does look-ahead scheduling
Music.setFast(bool)           // "hurry up" tempo (~1.35x)
Music.pause() / Music.resume()
SFX names: jump, jumpBig, coin, stomp, kick, bump, break, sprout, powerup, shrink, oneup, die,
           flag, clear, gameover, tick, hurry, pause, select, move, win

## window.Game (game.js)
Game.levels                   // [{name:'1-1', title:'Sunny Fields'}, {name:'1-2', title:'Crystal Caverns'}]
Game.start(levelIndex = 0)    // new game (score 0, 3 lives) starting at that level
Game.pause() / Game.resume() / Game.togglePause()
Game.isPaused()
Game.quitToMenu()             // back to attract/menu state
Game.getState()               // 'menu' | 'levelstart' | 'play' | 'dying' | 'flag' | 'gameover' | 'win'
Game.getStats()               // {score, coins, lives, hiScore, levelIndex, unlocked}  unlocked = highest level index unlocked
Game.setSettings({musicVolume, sfxVolume, scale /* 'auto'|1..6 */, crt /* bool scanline overlay */, showFps})
Game.on(event, cb)            // events: 'statechange'(state), 'pause'(isPaused), 'gameover'(stats), 'win'(stats), 'levelclear'(stats)

Engine pauses itself on Esc / P / Enter / gamepad Options(9) during play and emits 'pause'(true).
The GUI shows the pause menu on that event; "Resume" calls Game.resume().
In 'menu' state the engine draws an attract-mode scrolling level behind the GUI and ignores gameplay input.

## window.VirtualInput (created by engine, written by GUI touch controls)
{ left, right, down, jump, run }  booleans, OR-ed into keyboard/gamepad input every tick.

## Engine controls
Move: Arrows / WASD / D-pad / left stick. Jump: Space / Z / Up / W / Cross(0) / Circle(1).
Run: Shift / X / Square(2) / Triangle(3) / R2. Pause: Esc / P / Enter / Options(9). Mute: M.

## AI player agent (agent.js, loaded after game.js, before ui.js)
Game.startAI(levelIndex = 0)  // new game with the AI agent in control (score not saved as high score)
Game.setAgent(bool)           // hand control to / take control back from the AI mid-game (play states only)
Game.isAgent()                // AI currently in control?
Game.on('agent', cb)          // cb(isActive) whenever AI control toggles
Game.getStats().ai            // true if the AI played any part of this run (run won't set high score/unlocks)
Game.setSettings({ aiOverlay }) // bool: draw the agent's plan/search overlay (default true)
Keys: I (or gamepad Share/View = button 8) toggles AI control during play; O toggles the overlay.
Script order becomes: audio.js, game.js, agent.js, ui.js
