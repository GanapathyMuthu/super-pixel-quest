# The OG Super Mario: *Super Pixel Quest*

**Team:** Anbu Raja, Nageswara Rao, Ganapathy Muthu · **Onsite** · **Track 1: Build a game**

A retro, NES-style side-scrolling platformer in the spirit of the Super Mario games we grew up with. It includes an **AI agent that plays the game live and shows its reasoning on screen**. It runs in any browser from one `index.html`, with no install, no build step and no external assets. Art, music and sound effects are all original and generated in code.

## Screenshots & recording
| | |
|---|---|
| `01-main-menu.png`: main menu over the scrolling level | `06-ai-agent-level1.png`: AI agent jumping a gap, with its planned arc drawn |
| `03-gameplay-human.png`: human play, 1-1 Sunny Fields | `07-ai-agent-cave.png`: AI dodging fireball-spitting plants in 1-2 |
| `04-pause-menu.png`: pause, with "Let AI Play" handover | `08-victory.png`: AI beats the game; its score isn't recorded |

🎬 **`gameplay-ai-run.webm`**: the full run recorded in real Chrome by our Playwright playtest: menu → human play → hand control to the AI → the AI clears both levels with 0 deaths.

## What it does
- **Classic platforming:** run and jump with momentum, variable jump height, ? blocks, breakable bricks, mushroom, star invincibility and 1UPs, kickable shells, a flagpole finish, time bonus, checkpoints and a saved high score.
- **Two worlds:** 1-1 *Sunny Fields* and 1-2 *Crystal Caverns*.
- **Smarter enemy AI:** beetles that chase you and hop walls, frogs that leap at you, ledge-aware red shellbacks, and pipe plants that hide when you're close and aim fireballs at you.
- **Plays everywhere:** keyboard, **PS5 DualSense / Xbox controller**, or on-screen touch buttons. The menus are fully navigable with mouse, keyboard or gamepad.

## Creative use of AI
### 1. In the game: an agentic AI player (`agent.js`)
A **perceive → plan → act** agent that plays through the same controls a human uses:
- **Perceive:** takes a snapshot of the hero's physics state, then predicts each enemy's future path by **running that enemy's own AI rules forward**: frog leaps, beetle chasing, shellbacks turning at ledges, and plants' hide/emerge timers.
- **Plan:** runs an **A\* search over button sequences**. Every candidate is simulated with the game's real physics engine, so the planned jump arcs exactly match what will happen. It rejects routes that fall into pits or touch enemies, and it uses stomps as a deliberate tactic.
- **Act:** holds the first planned action, then **replans every 4 frames** (15× a second), averaging about 3 ms per plan.
- **Explainable:** the overlay shows the explored search nodes, the chosen path, the goal and the enemies it considered (red = threat, green = stomp target), plus a live "thought" such as *LEAPING A GAP*, *STOMPING BEETLE* or *DODGING PLANT*.
- **Handover:** press **I** at any time to give the AI control, and again to take it back. Runs where the AI played don't count toward the high score.
- **Benchmark:** 16/16 flawless clears in the latest randomized headless benchmark (about 3 ms per plan on average, 13 ms worst case), and 0 deaths in the real-Chrome run.

### 2. To build it: a team of AI agents
Built with Claude Code as the lead developer working with parallel sub-agents, coordinated through a written module contract (`CONTRACT.md`):
- **Lead (engine):** physics, levels, enemies and rendering; then the AI player agent.
- **Audio agent:** an original chiptune soundtrack and 21 sound effects, synthesized with Web Audio.
- **GUI agent:** menus, settings, pause, game over and victory screens, touch controls and gamepad navigation, tested in headless Chrome.

We followed the track's process: **Plan** (planning Q&A) → **small → bigger steps** (engine → audio and GUI agents → enemy AI → AI player) → **Playtest** (agents fixed what broke) → **Review**.

## Playtest & review (reusable)
- `/playtest`: a **reusable Claude Code skill** (`.claude/skills/playtest/SKILL.md`) that runs every check below and reviews the screenshots.
- `tools/smoke-test.js`: a headless engine test. A bot clears the levels; it also checks 5 minutes of random input, pause, game over, and each enemy's AI behaviour.
- `tools/ai-benchmark.js`: AI reliability over randomized runs (deaths and plan time).
- `tools/playtest.js`: a **Playwright** end-to-end test in real Chrome. It clicks through the GUI, checks that keyboard input reaches the game, watches the AI beat the game, and **records the video and screenshots above**. It passes 11/11 checks.
- Bugs these tests found and that we fixed:
  - Key taps shorter than one frame were ignored.
  - Enter used to resume immediately re-paused the game.
  - The AI's stomp prediction was off at the edge of a box.
  - The AI's score showed as the high score.
- Claude Code's `/code-review` skill found 10 issues, and all 10 are fixed. Examples: the AI's stuck-detector carried over between levels; the agent could commit to a jump that couldn't land; mute was lost when changing volume. The full suite was then re-run: smoke test passed, AI benchmark 16/16, Playwright 11/11.

## Run it
Double-click `index.html`. Controls: **arrows/WASD** to move, **Space/Z** to jump, **Shift/X** to run, **Esc** to pause, **I** to hand control to the AI, **O** to toggle the AI overlay, **M** to mute.
