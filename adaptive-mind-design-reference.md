# Adaptive Mind Simulation — Design Reference

**Version:** v5 (stable)
**Last updated:** 2026-05-21
**Code:** `adaptive-mind-sim.jsx` (~1450 lines, single React component)
**Status:** Functional in both single-agent and dual-agent modes. Dual mode now outperforms single mode at the individual level — see Section 8.

---

## 1. Project Overview

The Adaptive Mind Simulation is a small grid-world cellular system in which one or two simple agents develop adaptive behavior through rule plasticity, goal-priority updates, and (in dual mode) indirect coupling via a shared food supply. The system is intended to explore whether mind-like behavior — adaptive, goal-directed, self-modifying, integrating information over time — can emerge from purely structural properties without dependence on biological substrate.

The visual experience is similar in spirit to Conway's Game of Life: a small grid with simple local rules producing complex emergent patterns. The key difference is that Adaptive Mind's "cells" (agents) have internal state that updates from experience. Where Game of Life produces patterns from fixed rules, Adaptive Mind produces patterns from *evolving* rules.

## 2. Origin and Core Idea

The project began from an intuition: sentience or adaptive intelligence might emerge from a system of updatable rules — decision-tree-like nodes, each modifiable by experience — combined with a prioritized goal structure that itself updates from feedback. The goal is not to model biology; it is to explore what structural properties are sufficient to produce mind-like behavior, on whatever substrate.

Two commitments follow from this:

- **Implement-as-rules.** When something seems to call for a separate data structure (memory, attention, learning rate schedule), first see if it can be expressed as more rules with appropriate dynamics. The architecture stays clean because of this discipline.
- **Embrace digital-native unrealism.** Toroidal worlds, agents that can briefly share cells, instant respawn — these are not bugs to apologize for. They are features that would characterize a digital mind's experienced reality.

## 3. Position Relative to Game of Life

The similarities are substantial enough that "Game of Life with learning agents" is a reasonable elevator pitch. Both projects:

- Use small grid worlds with simple local rules
- Produce surprising emergent patterns from minimal architecture
- Reward long observation; interesting behavior emerges over time
- Are educational and visually engaging

The differences:

- Game of Life has fixed rules; Adaptive Mind's rules change with experience
- Game of Life has no agents or goals; Adaptive Mind has both
- Game of Life is deterministic; Adaptive Mind uses stochastic decision-making
- Game of Life patterns are static descriptions; Adaptive Mind's "patterns" are *behaviors* that develop and adapt

For an open-source release or mobile app positioning, leaning into this comparison makes the project legible to a broader audience without overpromising. "Watch a simple mind learn its world" captures the experience accurately.

## 4. The World

- **Grid:** 12×12 toroidal (wraps at edges, no boundaries)
- **Cell types:** empty, food, hazard
- **Initial population:** 10 food, 8 hazards
- **Food respawn:** immediately at a random empty cell not currently under any agent
- **Sensing:** each agent senses only its four adjacent cells (N/S/E/W)
- **Agents:** invisible to each other through perception; can briefly occupy the same cell

## 5. The Agent

### Rules (16 per agent)

| Category | Count | Initial Weight | Hardening | Purpose |
|----------|-------|----------------|-----------|---------|
| Safety   | 4     | 0.8 + jitter   | 0.035/fire | One per cardinal: flee hazard X → opposite direction |
| Food     | 4     | 0.5 + jitter   | 0.040/fire | One per cardinal: seek food X → toward X |
| Explore  | 4     | 0.2 + jitter   | 0          | One per cardinal: explore in direction X |
| Memory   | 4     | 1.0 (neutral)  | 0          | One per quadrant (NW/NE/SW/SE) |

Each rule has fields: `weight`, `plasticity` (0.05–1.0), `activations` counter, `lastFiredStep`.

### Goals (3 per agent)

| Goal | Initial Priority | Initial Plasticity | Drift Target |
|------|------------------|--------------------|--------------|
| Avoid Hazards | 0.9 | 1.0 | 0.7 |
| Find Food     | 0.6 | 1.0 | 0.5 |
| Explore       | 0.3 | 1.0 | 0.3 |

## 6. The Decision Pipeline (each step)

1. **Plasticity recovery** for rules silent for >80 steps (rate 0.0025/step toward 1.0)
2. **Explore weight homeostasis** — every explore rule's weight drifts toward 0.2 at rate 0.0005/step
3. **Visit map decay** (rate 0.996/step) — spatial recency trace
4. **Memory rule firing** — the rule for the agent's current quadrant fires; all memory weights drift toward 1.0 at 0.0002/step
5. **Stagnation check** — if last 12 positions contain <5 unique cells, perturb a random safety/food rule with plasticity > 0.2
6. **Sensing** — read four adjacent cell contents
7. **Rule filtering** — find rules whose condition matches sense; reject any that would move into a sensed hazard (action filter)
8. **Safety reinforcement** — if any rule was filtered, increment safety goal priority
9. **Scoring** — for each surviving rule: `score = weight × goal_priority`. Explore rules additionally multiply by:
   - `(1 − familiarity × 0.6)` (novelty bonus from visit map)
   - `4×` if direction matches `lastDirection` (momentum)
   - memory weight for destination quadrant (regional bias)
10. **Softmax selection** with temperature 0.12
11. **Movement** — chosen action's direction; hazard destinations bounce the agent back with negative feedback
12. **Outcome processing**:
    - Update visit map at landed cell
    - If food eaten: respawn immediately at random empty cell (not under any agent), then credit-assign to recently-fired memory rules under shared-budget redistribution
13. **Rule update** — chosen rule's weight changes by `learning_rate × feedback`. Asymmetric: positive feedback uses category-specific small rate and hardens; negative feedback uses larger rate and does not harden.
14. **Goal priority updates** from outcome (small deltas based on what happened)

### Shared-Budget Memory (the v5 mechanism worth highlighting)

The four memory rule weights share a fixed total budget of 4.0 (sum at initialization). When food is eaten:
- Memory rules that fired within the credit window (8 steps) are "credited"
- Each credited rule's desired growth is proportional to its headroom toward the ceiling
- Total desired growth is taken from uncredited rules multiplicatively (preserving budget)
- Uncredited weights asymptotically approach but never reach zero, preserving the option of relearning a region later

This forces memory weights to encode *relative* regional productivity rather than absolute, which is the only signal that can drive differentiation in a uniformly-respawning environment.

### Dual-Agent Mode

When enabled, two agents share the world. Processing order alternates each tick (eliminates first-mover bias). Agents cannot perceive each other; coupling is purely through the shared food supply.

## 7. Constants (current values and tunability)

```javascript
// World
GRID                     = 12         // dimensions (12×12 grid)
TICK_MS                  = 300        // live-mode step interval (ms)

// Stagnation detection
HISTORY_LEN              = 12         // window of recent positions to track
UNIQUE_THRESHOLD         = 5          // fewer than this → stagnation
PERTURB_BOOST            = 0.4        // max magnitude of perturbation nudge

// Plasticity
PLASTICITY_RECOVERY      = 0.0025
RECOVERY_GRACE_STEPS     = 80         // steps silent before recovery starts

// Spatial memory
VISIT_DECAY              = 0.996      // per-step multiplicative decay
VISIT_INCREMENT          = 0.5
NOVELTY_BONUS_STRENGTH   = 0.6        // up to 60% score discount for very-familiar cells

// Goal dynamics
SAFETY_REINFORCEMENT     = 0.015      // per action-filter rejection

// Weight bounds (most rules)
WEIGHT_CEILING           = 1.5
WEIGHT_FLOOR             = 0.05

// Selection
TEMPERATURE              = 0.12       // softmax temperature
INITIAL_JITTER           = 0.03       // random offset to initial weights

// Momentum
MOMENTUM_MULTIPLIER      = 4.0        // score boost for action matching last direction

// Memory rules
MEMORY_CREDIT_WINDOW     = 8          // steps within which firing can receive food credit
MEMORY_LEARN_RATE        = 0.08       // fraction of headroom transferred per credit event
MEMORY_WEIGHT_CEILING    = 2.0
MEMORY_DRIFT_RATE        = 0.0002     // per-step drift toward 1.0 baseline

// Explore homeostasis
EXPLORE_HOMEOSTASIS_RATE = 0.0005     // per-step pull toward baseline
EXPLORE_BASELINE_WEIGHT  = 0.2

// Food respawn delay (currently disabled — set to 0/0 for instantaneous)
FOOD_RESPAWN_DELAY_MIN   = 5          // minimum delay (used only if enabled)
FOOD_RESPAWN_DELAY_VAR   = 15         // additional random variance
```

### Parameter sensitivity notes

The following constants have outsized effects on behavior and are worth careful tuning:

- **TEMPERATURE** (0.12): controls decision determinism. Lower → more decisive, higher → more random. Below 0.05 the agent becomes effectively deterministic.
- **MEMORY_LEARN_RATE** (0.08): controls how fast regional preferences develop. The current value produces moderate differentiation; 0.02–0.03 would produce gentler preferences (worth trying for single-agent recovery).
- **MOMENTUM_MULTIPLIER** (4.0): controls how strongly the agent commits to its current direction. Below 2.0 the orbital-sweep behavior disappears; above 8.0 the agent becomes too directional to respond to opportunities.
- **NOVELTY_BONUS_STRENGTH** (0.6): controls how strongly the agent avoids recently-visited cells. Too high produces erratic movement; too low produces tight loops.
- **EXPLORE_HOMEOSTASIS_RATE** (0.0005): the restoring force preventing runaway explore weights. Too low and the system collapses at long horizons; too high and legitimate learning gets suppressed.

## 8. Performance History

Efficiency = food eaten / total steps. Higher is better. Theoretical ceiling at this food density is ~30%.

| Version | Mode | Steps | Efficiency | Notes |
|---------|------|-------|------------|-------|
| v1 baseline | single | 2k | 8.5% | Hit "memoryless ceiling" |
| Explore plasticity fix | single | 2k | 11.0% | Differential hardening introduced |
| Add spatial memory + momentum | single | 2k | 17.5% | Peak observed; orbital sweeps emerge |
| Add regional memory | single | 10k | 17.48% | Stable; tight variance |
| (above) extended to 50k | single | 50k | 12.27% | **Catastrophic late-run collapse identified** |
| (above) extended to 50k | dual | 50k | A=15.67%, B=14.42% | Competition damped collapse |
| v4 (add homeostasis + delay + alt order) | single | 50k | 13.40% | Stable across full 50k, very tight variance |
| v4 | dual | 50k | A=8.70%, B=9.84% | **Broken**: scarcity + perturbation cascades |
| v5a (+ shared-budget memory) | single | 50k | 8.67% | Worse: over-commitment loops |
| v5a | dual | 50k | A=9.44%, B=9.19% | Niche differentiation emerges but inefficient |
| **v5 (remove respawn delay)** | single | 50k | 11.51% | Recovered substantially; mild memory differentiation |
| **v5 (current)** | dual | 50k | **A=12.65%, B=12.78%** | **Dual outperforms single** at individual level |

The current state (v5) is the first version in which dual-agent mode produces *better individual performance* than single-agent mode, not just better collective extraction.

## 9. Key Findings

### What works
- **Memory implemented as rules** (not as a separate data structure) is architecturally clean. The same plasticity/hardening machinery applies uniformly.
- **Differential hardening by category** lets each rule type stabilize on its appropriate timescale.
- **Action filtering** (rejecting moves into sensed hazards) is highly effective — hazard hits dropped to essentially zero across all versions.
- **Directional momentum** restored emergent orbital-sweep behavior.
- **Explore weight homeostasis** prevents the runaway-perturbation collapse observed at long horizons.
- **Shared-budget memory** produces real regional differentiation, including complementary niche development between dual agents.
- **Alternating processing order** in dual mode eliminates first-mover bias.
- **Indirect coupling via shared resources** (no direct perception between agents) is sufficient to produce intersubjective dynamics including emergent niche differentiation.

### What didn't work as designed (or worked through unexpected mechanisms)
- **Regional memory** does not learn regional differentiation when used additively. All four weights saturate uniformly. (Shared-budget formulation in v5 fixes this.)
- **Pre-v5 regional memory** improved efficiency 25% but via *score-inflation side effect* sharpening softmax temperature for explore decisions, not through learned regional preference.
- **Long-horizon strategy emergence** (lawn-mower foraging observed once at ~36k steps) is not reproducible across runs. It happens in fortunate trajectories but is not an architectural feature.
- **Food respawn delay** combined destructively with shared-budget memory. The over-commitment-then-deplete cycles created perturbation cascades. Disabled in v5.

### Headline finding (v5)
**Dual-agent mode now outperforms single-agent mode at the individual level.** Each of two competing agents extracts more food per step than a solo agent does in the same world. This is the opposite of the typical resource-competition dynamic and tells us something about the framework: competition provides a grounding force that prevents memory rules from drifting into amplified-noise preferences. The other agent's foraging acts as constant external feedback that keeps each agent's internal model tracking actual food distribution rather than its own historical artifacts.

This is the most substantive emergent property the project has produced. It suggests the framework supports *intersubjective cognition* — cognition that works better when there's another cognizing entity in the environment, even when neither can directly perceive the other.

## 10. Open Questions and Research Directions

### Immediate tuning questions
1. **Recover single-agent performance.** Reduce MEMORY_LEARN_RATE from 0.08 to 0.02 or 0.03 and check whether single-agent efficiency recovers toward v4 baseline (13.4%) without harming dual-agent. Low-risk experiment.
2. **Effect of food respawn delay revisited.** With shared-budget memory tuned gentler, the respawn delay might no longer be destructive. Worth re-testing once learn rate is lowered.

### Architectural questions
3. **Larger worlds.** A 24×24 grid would give memory more substantive regional structure to learn. The dynamics that produce single-mode regression might not survive at larger scales (where local commitments matter less relative to global movement).
4. **Three or more agents.** Does niche differentiation continue to scale? Or does it break down once "regions per agent" drops below some threshold?
5. **Agents that perceive each other.** Right now agents are mutually invisible. Adding direct perception of other agents (perhaps as a new sense type, or as a new rule category) would let us test whether explicit awareness produces qualitatively different cognition than indirect coupling does.
6. **Environmental asymmetries.** Currently food is uniformly distributed. Clustering food in certain regions would give memory rules a structural signal to learn that's currently absent. Compare regions with different food densities.
7. **Reproducible strategy emergence.** The lawn-mower foraging pattern observed at ~36k steps was not reproducible. Is there a configuration in which it *would* reliably emerge?

### Speculative directions
8. **Heterogeneous starting conditions.** Two agents with different initial rule weights or different goal priorities. Studies whether competition produces convergence or sustained differentiation.
9. **Communication or signaling.** Add a way for one agent's state to affect another agent's perception (a "scent" the agent leaves behind, for instance). This would be a substantial expansion of the architecture but could produce coordination dynamics.
10. **Multi-generation dynamics.** Replace dying or stagnant agents with new agents inheriting some traits from successful ones. This adds an evolutionary timescale on top of within-life learning.

## 11. Design Notes for UI Continuation (Claude Code)

The current implementation is a single React component (~1450 lines). Moving to Claude Code with a richer UI should consider the following.

### Suggested file structure

```
src/
  simulation/
    constants.ts        // all tunable constants, with metadata for UI
    world.ts            // makeWorld, processRespawns, etc.
    rules.ts            // makeRuleNodes, makeMemoryRules
    agent.ts            // agentStep, makeAgent
    batch.ts            // runSingleSimulation, runBatch
    report.ts           // generateReport
  components/
    Grid.tsx            // grid rendering
    AgentControls.tsx   // pause/play/step/reset/speed
    ParameterPanel.tsx  // sliders/inputs for all constants
    AgentDetail.tsx     // rules, goals, stats for one agent
    EfficiencyChart.tsx // time-series chart
    BatchPanel.tsx      // batch runner UI and reports
    PresetSelector.tsx  // saved configurations
  state/
    simulationState.ts  // current world state, persisted across mode toggles
    config.ts           // user config / preferences
```

### Parameters worth exposing in the UI

Group these by purpose. Most should be live-editable during a run (changes apply on next tick). A few (GRID size, agent count) require a reset.

**World** (require reset)
- GRID size (8–32, default 12)
- Initial food count (5–30, default 10)
- Initial hazard count (0–20, default 8)
- Dual-agent mode toggle

**Timing** (live)
- TICK_MS (50–1000)
- Batch steps per run (1k, 3k, 5k, 10k, 25k, 50k, 100k)
- Batch run count (1, 3, 5, 10, 20)

**Rule dynamics** (live)
- All HARDENING_BY_CATEGORY values (per category sliders)
- PLASTICITY_RECOVERY, RECOVERY_GRACE_STEPS
- WEIGHT_CEILING, WEIGHT_FLOOR

**Selection** (live, with caveats)
- TEMPERATURE (slider 0.05–0.5; below 0.05 produces near-deterministic behavior)
- MOMENTUM_MULTIPLIER (slider 1.0–8.0)
- NOVELTY_BONUS_STRENGTH (slider 0.0–1.0)

**Memory** (live)
- MEMORY_LEARN_RATE (slider 0.01–0.2)
- MEMORY_WEIGHT_CEILING (slider 1.2–3.0)
- MEMORY_DRIFT_RATE (slider 0.0–0.001)
- MEMORY_CREDIT_WINDOW (slider 3–20)

**Homeostasis** (live)
- EXPLORE_HOMEOSTASIS_RATE (slider 0.0–0.002)
- EXPLORE_BASELINE_WEIGHT (slider 0.1–0.5)

**Stagnation** (live)
- HISTORY_LEN, UNIQUE_THRESHOLD, PERTURB_BOOST

**Food respawn** (live)
- FOOD_RESPAWN_DELAY_MIN / VAR (slider; 0/0 = instantaneous, the v5 default)

### Visualization options worth exposing

- Color scheme: dark mode (current), light mode, high-contrast, colorblind-safe palettes
- Cell size adjustment
- Toggle visibility: visit map overlay, memory region overlay (color cells by which agent's memory weights them higher), rule activation hotspots
- Chart options: which metrics to plot, log/linear y-axis, rolling window size
- Live rule-weight display style: bars (current), radar chart, histogram

### Features worth adding

- **Seed-based reproducibility.** Currently runs are non-deterministic; adding a PRNG seed makes runs reproducible and shareable.
- **Configuration presets.** "Default v5", "Aggressive learning", "Slow and stable", "Demo: orbital sweeps", etc.
- **Configuration import/export.** JSON or URL-encoded for sharing setups.
- **Save and replay runs.** Store the seed + config; replay produces identical outcomes.
- **Snapshot / restore.** Save the full state at a moment; load it later as a starting point.
- **Side-by-side comparison.** Run two configurations simultaneously; compare emergent behavior.
- **Time travel.** Step backwards through a run (requires storing recent state history).
- **Rule weight live editing.** Drag a weight bar to manually adjust during a run; observe effects.
- **Annotation.** Mark interesting moments during observation with timestamps and notes.

### Mobile considerations

- Smaller grids (8×8 to 10×10) work better on phone screens
- Vertical layouts: grid on top, controls below, swipe between detail views
- Touch-friendly: large hit targets for buttons, gesture controls (pinch to zoom, swipe between agents)
- Reduced detail by default with "expand" options for deeper inspection
- "Watch and learn" mode that's primarily passive viewing
- Could ship with curated scenarios — like Game of Life patterns — that demonstrate specific emergent behaviors

### Performance notes

The current implementation handles 50k single-agent or dual-agent batches in seconds. For 100k+ steps or larger grids, consider:

- Web Workers to keep the UI responsive during batch runs
- Typed arrays for grids and visit maps instead of nested JS arrays
- Sparse representation of memory state for very large worlds
- WASM for the inner loop if performance becomes critical

For mobile, the current performance should be plenty even on modest devices.

## 12. Design Philosophy and Commitments

These are the deeper choices that have shaped the project. Future iterations should probably continue respecting them.

- **Substrate-independence is foundational.** Anything that smells like "we have to do this because biological brains do it that way" is a red flag. The framework is exploring what mind-like behavior is possible given purely structural properties.
- **Implement-as-rules first.** Memory, learning rate, attention — try expressing them as rules with appropriate dynamics before reaching for separate data structures.
- **Embrace digital-native unrealism.** Toroidal worlds, cell-sharing, instant respawn are not bugs to apologize for. They are features.
- **Empirical iteration over theoretical reasoning.** Every important finding has come from running the system and watching what happened, not from predicting what would happen. The 50k collapse was completely unanticipated. The dual-outperforms-single finding was completely unanticipated. Future work should preserve this discipline.
- **Each iteration reveals hidden assumptions.** Architectural changes that look local often have non-local consequences. Test broadly before concluding.
- **Check the underlying state, not just the headline metric.** Efficiency numbers can hide what's actually happening. Look at rule weight distributions, perturbation counts, variance across runs, and individual run details. The most informative diagnostic is often what's happening *inside* the agent, not what it's doing externally.

## 13. Files and Artifacts

The current code file is `adaptive-mind-sim.jsx`. It is the source of truth for the v5 implementation. This design reference document is descriptive; the code is authoritative.

Earlier batch logs are preserved in upload history if useful for cross-version comparison:
- v3 peak observation (single, 10k, 17.48%)
- Pre-v4 single 50k (collapse identified)
- Pre-v4 dual 50k (partial collapse)
- v4 single 50k (stable at 13.40%)
- v4 dual 50k (broken)
- v5a single/dual (with respawn delay)
- **v5 single/dual (current stable)**

## 14. How to Resume This Project

In Claude Code or a fresh conversation:

1. Attach this document and `adaptive-mind-sim.jsx`.
2. State whether you're tuning, expanding the UI, or exploring a new research direction.
3. For tuning: Section 10 has the prioritized experiments.
4. For UI expansion: Section 11 has the structure and parameter list.
5. For research: Section 10's architectural and speculative questions are open.

Maintain the design philosophy in Section 12. The framework's character is not just the code; it's the commitments behind the code.
