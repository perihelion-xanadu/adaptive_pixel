# Adaptive Mind Simulation

A grid-world cellular simulation where simple agents develop adaptive behavior through rule plasticity, goal-priority updates, and indirect competition via shared resources. Think of it as *Game of Life with learning agents* — watch a simple mind learn its world.

Built with React + Vite. The simulation logic lives entirely in `prototype/src/simulation/`; the standalone monolithic version is `adaptive-mind-sim.jsx`.

---

## What It Is

Each agent navigates a 12×12 toroidal grid containing food and hazards. It decides where to move using a set of weighted rules, and those rule weights change based on outcomes — rules that lead to food get stronger, rules that lead to hazards get weaker. Goals (avoid hazards, find food, explore) also shift in priority from experience.

The interesting part: in **dual-agent mode**, two agents compete for the same food supply without being able to perceive each other. This indirect competition turns out to produce *better individual performance* than solo play — each agent's learned regional preferences stay grounded because the other agent's foraging constantly disrupts stale assumptions.

Key emergent behaviors to watch for:
- **Orbital sweeping** — agents develop looping patrol routes over food-rich areas
- **Regional niche differentiation** — in dual mode, agents gradually specialize in different parts of the grid
- **Stagnation recovery** — agents perturb their own rules when stuck, then restabilize

---

## Quick Start

```bash
cd prototype
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Press **Play** to start the simulation.

---

## Project Structure

```
learning_experiment/
├── adaptive-mind-sim.jsx          # Standalone monolithic v5 implementation
├── adaptive-mind-design-reference.md  # Full design doc, architecture, findings
└── prototype/                     # Refactored React + Vite app
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx                # Main app shell
        ├── simulation/
        │   ├── constants.js       # All tunable parameters + metadata
        │   ├── world.js           # Grid creation, food/hazard respawn
        │   ├── agent.js           # Agent construction, decision pipeline
        │   └── batch.js           # Headless batch runner + report generation
        └── components/
            ├── Grid.jsx           # Visual grid renderer
            ├── AgentDetail.jsx    # Per-agent rules, goals, stats
            ├── EfficiencyChart.jsx # Live efficiency time-series chart
            ├── BatchPanel.jsx     # Batch run UI and report modal
            └── ParameterPanel.jsx # Live parameter sliders
```

---

## The Simulation

### The World

- **12×12 toroidal grid** — edges wrap; there are no walls
- **10 food cells**, **8 hazard cells** at initialization
- Food respawns instantly at a random empty cell when eaten
- Agents are invisible to each other (coupling is only through shared food supply)

### The Agent

Each agent has **16 rules** across four categories:

| Category | Count | Purpose |
|----------|-------|---------|
| Safety | 4 | One per direction: flee hazard → move away |
| Food | 4 | One per direction: seek food → move toward |
| Explore | 4 | One per direction: explore that direction |
| Memory | 4 | One per quadrant (NW/NE/SW/SE): regional bias |

Rules have a `weight` (how strongly they influence decisions) and a `plasticity` (how much they can still change). Rules that fire often harden — they become more stable and harder to overwrite.

**Goals** adjust dynamically too:

| Goal | Initial Priority |
|------|-----------------|
| Avoid Hazards | 0.9 |
| Find Food | 0.6 |
| Explore | 0.3 |

### The Decision Pipeline (each step)

1. Plasticity recovery for rules that haven't fired in a while
2. Explore weight homeostasis (pulls toward baseline to prevent runaway learning)
3. Visit map decay (spatial recency trace for novelty detection)
4. Memory rule firing + drift toward neutral baseline
5. Stagnation check (perturb a rule if stuck in a small area)
6. Sense four adjacent cells (N/S/E/W)
7. Filter rules whose action would move into a hazard
8. Score remaining rules: `weight × goal_priority`, with novelty bonus and momentum
9. Softmax selection (temperature 0.12 — decisive but not fully deterministic)
10. Move; apply outcome feedback to rule weights and goal priorities

### Shared-Budget Memory (the core v5 mechanism)

The four memory rule weights share a fixed total budget of 4.0. When food is eaten, memory rules that fired recently get credited — they grow at the expense of uncredited rules. This forces the weights to encode *relative* regional productivity rather than just absolute visits, which is what produces genuine niche differentiation in dual mode.

---

## Controls

| Control | Description |
|---------|-------------|
| Play / Pause | Start or pause live simulation |
| Step | Advance one tick manually |
| Reset | Reinitialize world and agents (keeps current config) |
| Speed slider | Adjust tick interval (50ms – 1000ms) |
| Dual Mode | Toggle second agent |
| Visit Map overlay | Show recency-weighted spatial footprint on grid |

---

## Parameters

All parameters are live-editable during a run (changes take effect next tick). Parameters marked **[reset]** require restarting the simulation.

### World [reset]
| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| GRID | 12 | 8–32 | Grid dimensions (GRID × GRID) |
| Initial food | 10 | 5–30 | |
| Initial hazards | 8 | 0–20 | |

### Timing
| Parameter | Default | Notes |
|-----------|---------|-------|
| TICK_MS | 300 | Live step interval in milliseconds |

### Selection Dynamics
| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| TEMPERATURE | 0.12 | 0.05–0.5 | Softmax temperature. Below 0.05 → near-deterministic |
| MOMENTUM_MULTIPLIER | 4.0 | 1.0–8.0 | Score boost for continuing current direction |
| NOVELTY_BONUS_STRENGTH | 0.6 | 0.0–1.0 | How strongly to prefer unvisited cells |

### Rule Dynamics
| Parameter | Default | Notes |
|-----------|---------|-------|
| PLASTICITY_RECOVERY | 0.0025 | Rate rules recover plasticity when silent |
| RECOVERY_GRACE_STEPS | 80 | Steps of silence before recovery starts |
| WEIGHT_CEILING | 1.5 | Maximum weight for safety/food/explore rules |
| WEIGHT_FLOOR | 0.05 | Minimum weight |

### Memory Rules
| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| MEMORY_LEARN_RATE | 0.08 | 0.01–0.2 | Speed of regional preference learning |
| MEMORY_WEIGHT_CEILING | 2.0 | 1.2–3.0 | Max memory rule weight |
| MEMORY_DRIFT_RATE | 0.0002 | 0–0.001 | Per-step pull toward neutral (1.0) |
| MEMORY_CREDIT_WINDOW | 8 | 3–20 | Steps back to credit for food eaten |

### Homeostasis
| Parameter | Default | Notes |
|-----------|---------|-------|
| EXPLORE_HOMEOSTASIS_RATE | 0.0005 | Per-step restoring force for explore weights |
| EXPLORE_BASELINE_WEIGHT | 0.2 | Target weight for homeostasis |

### Stagnation Recovery
| Parameter | Default | Notes |
|-----------|---------|-------|
| HISTORY_LEN | 12 | Window of recent positions to track |
| UNIQUE_THRESHOLD | 5 | Fewer unique cells in window → stagnation |
| PERTURB_BOOST | 0.4 | Max magnitude of perturbation nudge |

---

## Batch Runner

The **Batch** panel runs the simulation headlessly for a large number of steps (1k–100k) and reports aggregate statistics. Use this for:

- Comparing parameter configurations systematically
- Checking long-run stability (the v4 → v5 collapse was found at 50k steps)
- Measuring dual vs. single agent performance differences

The report shows: efficiency (food/step) per agent, total food eaten, step count, and a summary of rule weight distributions at end of run.

**Efficiency reference:**
- Theoretical ceiling at default food density: ~30%
- v5 single-agent typical: ~11.5%
- v5 dual-agent typical: ~12.5–12.8% per agent

---

## Usage Tips

**To observe orbital sweeping:** run single-agent mode for 2,000–5,000 steps. At some point the agent develops a looping patrol route. It's more reliable with MOMENTUM_MULTIPLIER ≥ 3.0.

**To observe niche differentiation:** run dual-agent mode for 10,000+ steps. Watch the visit map overlay — the two agents' footprints gradually diverge toward different regions.

**To explore the softmax effect:** try TEMPERATURE at 0.05 (nearly deterministic) versus 0.3 (quite random). The agent's behavior shifts from committed and patterned to erratic and inefficient at both extremes.

**To stress-test stability:** batch run at 50k steps. A stable configuration shows tight efficiency variance across the run. Catastrophic late-run collapse (rapid efficiency drop) indicates runaway perturbation cascades, usually from aggressive memory learning combined with food scarcity.

**To get reproducible runs:** currently the simulation is non-deterministic. For reproducibility, set the same initial conditions and note them — seed-based PRNG is a planned future feature.

---

## Troubleshooting

**The agent stops moving / gets stuck**  
This is stagnation detection working. The agent will perturb a rule and resume movement within a few steps. If it stays stuck longer, increase PERTURB_BOOST or lower UNIQUE_THRESHOLD.

**Efficiency drops sharply mid-run (batch mode)**  
This is the collapse pattern identified in pre-v5 versions. It's caused by perturbation cascades from aggressive memory over-commitment. Try reducing MEMORY_LEARN_RATE to 0.02–0.03 and disabling food respawn delay (set both to 0).

**Dual-agent mode is slower than single-agent**  
This is expected — the world has the same food supply split between two agents. At the *individual* level, each dual-agent is slightly more efficient than a solo agent, but total food extraction is similar. Check the per-agent stats in Agent Detail.

**The grid flickers / UI is laggy**  
Try increasing TICK_MS (slower simulation). For batch runs, the UI freezes briefly for long runs (50k+) since the batch runner is synchronous. Web Worker support is a planned improvement.

**`npm install` fails**  
Make sure you're running Node.js 18+. The project uses Vite 8 which requires a recent Node version.

**Port 5173 already in use**  
Either kill the other process or run `npm run dev -- --port 5174` to use a different port.

---

## Development

```bash
# Run dev server with HMR
npm run dev

# Lint
npm run lint

# Production build
npm run build

# Preview production build
npm run preview
```

The simulation engine (`src/simulation/`) is framework-agnostic JavaScript. It can be used independently of React — just import `makeWorld`, `makeAgent`, `agentStep`, and `runBatch` directly.

---

## Design Commitments

These principles have shaped every version and should guide future work:

- **Substrate-independence is foundational.** Avoid anything that encodes "biological brains work this way." The goal is exploring what structural properties are sufficient for mind-like behavior.
- **Implement as rules first.** Memory, attention, learning rate schedules — express them as rules with appropriate dynamics before reaching for separate data structures.
- **Embrace digital-native unrealism.** Toroidal worlds, cell-sharing, instant respawn are features, not bugs.
- **Empirical iteration over theoretical prediction.** Every important finding has come from running the system and watching what happened. The 50k collapse, the dual-outperforms-single result — both were completely unanticipated.

---

## Key Findings (v5)

- **Dual-agent mode produces better individual performance than single-agent** — each competing agent extracts more food per step than a solo agent in the same world. Competition grounds memory rules against their own historical drift.
- **Memory implemented as rules** (not a separate structure) scales cleanly with the same plasticity/hardening machinery as all other rules.
- **Action filtering** (refusing to move into sensed hazards) drops hazard hits to near zero at negligible cost.
- **Explore weight homeostasis** prevents the runaway perturbation collapse observed at 50k+ steps in v4.
- **Shared-budget memory** produces genuine regional niche differentiation; earlier additive formulations saturated all four weights uniformly.

Full performance history and architectural analysis: [`adaptive-mind-design-reference.md`](adaptive-mind-design-reference.md)

---

## Roadmap

Planned improvements (see Section 10 of the design reference for details):

- Seed-based PRNG for reproducible runs
- Configuration presets ("Aggressive learning", "Orbital sweeps demo", etc.)
- Import/export configuration as JSON or URL
- Web Worker batch runner (non-blocking UI)
- Larger grid support (24×24+)
- Three or more agents
- Direct agent perception (agents sensing each other)
- Clustered food environments
- Save/restore simulation state snapshots
