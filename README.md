# Super Pixel Quest

An original NES-style side-scrolling platformer. Pure HTML5 canvas + Web Audio, with no installs, no build step and no external assets.

**Play:** double-click `index.html` (Chrome, Edge or Firefox).

## Controls
| Action | Keyboard | PS5 / Xbox pad |
|---|---|---|
| Move | Arrows / WASD | D-pad / left stick |
| Jump (hold = higher) | Space / Z / Up | Cross / A |
| Run | Shift / X | Square / X, R2 |
| Pause | Esc / P / Enter | Options / Menu |
| Mute | M | |

Touch devices get on-screen buttons automatically.

## Features
- 2 levels: 1-1 Sunny Fields and 1-2 Crystal Caverns, each with checkpoints, a flagpole finish and a time bonus
- Power-ups: mushroom (grow), star (invincibility), 1UP; ? blocks, breakable bricks, multi-coin bricks
- Enemy AI: walkers, shell-kicking koopas, ledge-aware red shellbacks, chaser beetles that track you and hop walls,
  frogs that leap at you, and pipe plants that hide when you're near (in the cave they also aim fireballs)
- Game feel: coyote time, jump buffering, corner correction, variable jump, skid, screen shake and dust
- Original chiptune music and SFX, all synthesized at runtime
- Menus, level select (unlock progress), settings (volume, scale, CRT scanlines, FPS), pause, game over and victory screens
- Saved high score

## Files
`game.js` engine · `audio.js` sound · `ui.js` + `style.css` + `index.html` GUI · `CONTRACT.md` module API ·
`tools/smoke-test.js` headless test (`node tools/smoke-test.js`)
