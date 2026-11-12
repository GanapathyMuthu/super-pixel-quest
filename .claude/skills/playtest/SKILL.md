---
name: playtest
description: Validate Super Pixel Quest after any change. Runs the headless engine smoke test, the AI-agent benchmark and a real-Chrome Playwright playtest that drives the GUI and records video and screenshots, then reviews the screenshots and reports pass/fail. Use after editing game.js, agent.js, audio.js, ui.js, style.css or index.html, or when asked to "playtest", "validate", "check the game still works" or "record a demo".
---

# Playtest & validate Super Pixel Quest

Run every step from the repo root (the folder containing `index.html`). Don't skip steps or stop at the first failure. Collect everything, then report.

## 1. Syntax
```bash
for f in game.js agent.js audio.js ui.js; do node --check "$f" || echo "SYNTAX FAIL: $f"; done
```

## 2. Engine smoke test (headless, ~1 min)
```bash
node tools/smoke-test.js
```
It must end with `ALL SMOKE TESTS PASSED`. It covers the menu, a bot clearing levels, pause and timer freeze, 5 min of random input, each enemy AI behaviour (ledge patrol, chase, frog leap, plant hide and shoot), game over, and quit to menu.

## 3. AI agent benchmark (headless, ~2-4 min)
```bash
node tools/ai-benchmark.js 5
```
Each run starts the AI after a random delay. Expect `flawless clears: N/N`. Flag any run with deaths or `cleared: false`. Also flag `maxPlanMs` > 16 (the agent would drop frames).

## 4. Real-browser playtest (Playwright + installed Chrome, ~2 min)
First run only: `cd tools && npm install && npx playwright-core install ffmpeg`
```bash
node tools/playtest.js
```
It must print `11/11 checks passed`. It writes to `submission/`:
- `01..08-*.png` screenshots: menu, settings, human play, pause, AI takeover, AI level 1, AI cave, victory
- `gameplay-ai-run.webm`: a video of the AI agent beating the game

## 5. Look at the screenshots
Open every `submission/*.png` with the Read tool and check:
- The HUD is readable, the sprites aren't garbled, and there are no blank or black frames (except the level-intro card).
- The AI overlay shows the yellow planned path, red/green enemy boxes and the "AI AGENT IN CONTROL" badge.
- The menus fit inside their panels and the text isn't mojibake (`Â·` means a charset problem).

## 6. Report
Give a short table of each step's result with the key numbers (checks passed, flawless clears, max plan ms, console errors). For each failure, include the exact output and the most likely file/line. Fix only if the user asked for fixes.
