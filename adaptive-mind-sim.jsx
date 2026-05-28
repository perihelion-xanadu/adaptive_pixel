import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// WORLD CONSTANTS
// ─────────────────────────────────────────────────────────────
const GRID = 12;
const CELL = 46;
const TICK_MS = 300;
const CELL_TYPES = { EMPTY: 0, FOOD: 1, HAZARD: 2 };

// Stagnation detection
const HISTORY_LEN = 12;
const UNIQUE_THRESHOLD = 5;
const PERTURB_BOOST = 0.4;

// Rule selection
const TEMPERATURE = 0.12;
const INITIAL_JITTER = 0.03;

// Differential hardening by category
const HARDENING_BY_CATEGORY = {
  safety:  0.035,
  food:    0.04,
  explore: 0,
  memory:  0,
};

// Plasticity recovery
const PLASTICITY_RECOVERY = 0.0025;
const RECOVERY_GRACE_STEPS = 80;

// Spatial memory (visit map)
const VISIT_DECAY = 0.996;
const VISIT_INCREMENT = 0.5;
const NOVELTY_BONUS_STRENGTH = 0.6;

// Safety goal reinforcement on successful action filtering
const SAFETY_REINFORCEMENT = 0.015;

// Weight bounds
const WEIGHT_CEILING = 1.5;
const WEIGHT_FLOOR = 0.05;

// Chart sampling
const CHART_MAX_SAMPLES = 300;
const ROLLING_WINDOW = 30;

// Directional momentum
const MOMENTUM_MULTIPLIER = 4.0;

// Productive (regional) memory
const MEMORY_REGIONS = 4;
const MEMORY_CREDIT_WINDOW = 8;
const MEMORY_LEARN_RATE = 0.08;
const MEMORY_WEIGHT_CEILING = 2.0;
const MEMORY_DRIFT_RATE = 0.0002;

// Explore weight homeostasis — addresses the runaway-perturbation collapse
// observed at long horizons. Without this, accumulated perturbation nudges
// can drive an explore rule's weight arbitrarily far from its baseline,
// locking the agent into degenerate movement patterns over tens of
// thousands of steps. The slow drift pulls every explore weight back
// toward EXPLORE_BASELINE_WEIGHT, with a time constant of ~2000 steps —
// fast enough to correct runaway drift, slow enough that legitimate
// short-term learning from feedback still works.
const EXPLORE_HOMEOSTASIS_RATE = 0.0005;
const EXPLORE_BASELINE_WEIGHT = 0.2;

// Food respawn delay — introduces temporal scarcity. When food is eaten,
// it doesn't reappear immediately but after a small randomized delay.
// This makes the reinforcement signal noisier (the agent can't count on
// the food density being constant), which disrupts the positive feedback
// loops that drive runaway behavior. Also creates natural depletion zones
// that could give memory rules a richer signal to learn from.
const FOOD_RESPAWN_DELAY_MIN = 5;
const FOOD_RESPAWN_DELAY_VAR = 15;

// ─────────────────────────────────────────────────────────────
// WORLD GENERATION
// ─────────────────────────────────────────────────────────────
function makeWorld() {
  const grid = Array.from({ length: GRID }, () => Array(GRID).fill(CELL_TYPES.EMPTY));
  const place = (type, n) => {
    let placed = 0;
    while (placed < n) {
      const r = Math.floor(Math.random() * GRID);
      const c = Math.floor(Math.random() * GRID);
      if (grid[r][c] === CELL_TYPES.EMPTY && !(r === 1 && c === 1) && !(r === GRID - 2 && c === GRID - 2)) {
        grid[r][c] = type;
        placed++;
      }
    }
  };
  place(CELL_TYPES.FOOD, 10);
  place(CELL_TYPES.HAZARD, 8);
  return grid;
}

function makeVisitMap() {
  return Array.from({ length: GRID }, () => Array(GRID).fill(0));
}

// ─────────────────────────────────────────────────────────────
// RULES / GOALS / STATS / AGENTS
// ─────────────────────────────────────────────────────────────
const ACTIONS = ["north", "south", "east", "west", "stay"];
const DIRS = { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1], stay: [0, 0] };

function senseNeighbors(grid, r, c) {
  // World is toroidal. Agents are NOT represented in the grid — only the
  // static world content (empty, food, hazard) is. This means agents are
  // invisible to each other through perception, which is exactly the
  // design we want for indirect-coupling competition.
  const sense = {};
  for (const [dir, [dr, dc]] of Object.entries(DIRS)) {
    if (dir === "stay") { sense[dir] = CELL_TYPES.EMPTY; continue; }
    sense[dir] = grid[(r + dr + GRID) % GRID][(c + dc + GRID) % GRID];
  }
  return sense;
}

function getQuadrant(r, c) {
  const half = GRID / 2;
  return (r < half ? 0 : 2) + (c < half ? 0 : 1);
}

function makeRuleNodes() {
  const j = () => (Math.random() - 0.5) * INITIAL_JITTER;
  return [
    { id: 0,  label: "Flee hazard N", condition: "hazard_north", action: "south", weight: 0.8 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "safety" },
    { id: 1,  label: "Flee hazard S", condition: "hazard_south", action: "north", weight: 0.8 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "safety" },
    { id: 2,  label: "Flee hazard E", condition: "hazard_east",  action: "west",  weight: 0.8 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "safety" },
    { id: 3,  label: "Flee hazard W", condition: "hazard_west",  action: "east",  weight: 0.8 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "safety" },
    { id: 4,  label: "Seek food N",   condition: "food_north",   action: "north", weight: 0.5 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "food" },
    { id: 5,  label: "Seek food S",   condition: "food_south",   action: "south", weight: 0.5 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "food" },
    { id: 6,  label: "Seek food E",   condition: "food_east",    action: "east",  weight: 0.5 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "food" },
    { id: 7,  label: "Seek food W",   condition: "food_west",    action: "west",  weight: 0.5 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "food" },
    { id: 8,  label: "Explore N",     condition: "open_north",   action: "north", weight: 0.2 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "explore" },
    { id: 9,  label: "Explore S",     condition: "open_south",   action: "south", weight: 0.2 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "explore" },
    { id: 10, label: "Explore E",     condition: "open_east",    action: "east",  weight: 0.2 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "explore" },
    { id: 11, label: "Explore W",     condition: "open_west",    action: "west",  weight: 0.2 + j(), plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "explore" },
    { id: 12, label: "Region NW",     condition: null, action: null, region: 0, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 13, label: "Region NE",     condition: null, action: null, region: 1, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 14, label: "Region SW",     condition: null, action: null, region: 2, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 15, label: "Region SE",     condition: null, action: null, region: 3, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
  ];
}

function evaluateCondition(condition, sense) {
  if (!condition) return false;
  const [aspect, dir] = condition.split("_");
  const cell = sense[dir];
  if (aspect === "hazard") return cell === CELL_TYPES.HAZARD;
  if (aspect === "food")   return cell === CELL_TYPES.FOOD;
  if (aspect === "open")   return cell === CELL_TYPES.EMPTY;
  return false;
}

function makeGoals() {
  return [
    { id: "safety",  label: "Avoid Hazards", priority: 0.9, plasticity: 1.0, color: "#ef4444" },
    { id: "food",    label: "Find Food",     priority: 0.6, plasticity: 1.0, color: "#22c55e" },
    { id: "explore", label: "Explore",       priority: 0.3, plasticity: 1.0, color: "#3b82f6" },
  ];
}

function makeStats() {
  return { steps: 0, foodEaten: 0, hazardHits: 0, perturbations: 0, filtered: 0 };
}

// Bundle of per-agent state. The grid is shared across agents; everything
// else here is per-agent and updates independently. startPos lets us put
// the two agents in diagonally opposite corners so they begin spatially
// separated and develop their patrol patterns somewhat independently.
function makeAgent(startPos) {
  return {
    pos: startPos,
    rules: makeRuleNodes(),
    goals: makeGoals(),
    stats: makeStats(),
    visitMap: makeVisitMap(),
    lastDirection: null,
  };
}

// ─────────────────────────────────────────────────────────────
// STAGNATION + PERTURBATION
// ─────────────────────────────────────────────────────────────
function isStagnating(posHistory) {
  if (posHistory.length < HISTORY_LEN) return false;
  const recent = posHistory.slice(-HISTORY_LEN);
  return new Set(recent.map(([r, c]) => `${r},${c}`)).size < UNIQUE_THRESHOLD;
}

function perturbRules(rules) {
  const targetCandidates = rules
    .filter(r => r.category !== 'explore' && r.category !== 'memory' && r.plasticity > 0.2)
    .sort((a, b) => b.plasticity - a.plasticity);
  const explorePool = rules
    .filter(r => r.category === 'explore' && r.plasticity > 0.2)
    .sort((a, b) => b.plasticity - a.plasticity);
  const candidates = targetCandidates.length > 0 ? targetCandidates : explorePool;
  if (candidates.length === 0) return rules;
  const pool = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
  const target = pool[Math.floor(Math.random() * pool.length)];
  return rules.map(r => {
    if (r.id !== target.id) return r;
    const nudge = (Math.random() * 2 - 1) * PERTURB_BOOST * r.plasticity;
    return { ...r, weight: Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, r.weight + nudge)) };
  });
}

// ─────────────────────────────────────────────────────────────
// FOOD RESPAWN PROCESSING
// Pending-food entries carry a respawnAt step; when worldStep meets it,
// the food is placed at a random empty cell that isn't currently under
// any agent. Entries that can't be placed (rare; only if the grid is
// crowded) remain pending and retry next tick.
// ─────────────────────────────────────────────────────────────
function processRespawns(grid, pendingFood, worldStep, agentPositions) {
  if (pendingFood.length === 0) return { grid, pendingFood };
  let newGrid = null;
  const stillPending = [];
  const occupied = new Set(agentPositions.map(p => `${p[0]},${p[1]}`));
  for (const pf of pendingFood) {
    if (worldStep < pf.respawnAt) {
      stillPending.push(pf);
      continue;
    }
    // Time to respawn — find a random empty, unoccupied cell
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 200) {
      attempts++;
      const fr = Math.floor(Math.random() * GRID);
      const fc = Math.floor(Math.random() * GRID);
      const source = newGrid || grid;
      if (source[fr][fc] === CELL_TYPES.EMPTY && !occupied.has(`${fr},${fc}`)) {
        if (!newGrid) newGrid = grid.map(row => [...row]);
        newGrid[fr][fc] = CELL_TYPES.FOOD;
        placed = true;
      }
    }
    if (!placed) stillPending.push(pf);
  }
  return { grid: newGrid || grid, pendingFood: stillPending };
}

// ─────────────────────────────────────────────────────────────
// AGENT STEP
// Pure function. Same rule logic as before, with two changes for
// dual-agent support:
//   1) Agents are not represented in the grid (only world content is)
//   2) Food respawn avoids both this agent's landing cell AND any
//      other agent positions passed in via otherAgentPositions
// ─────────────────────────────────────────────────────────────
function agentStep(grid, agentPos, rules, goals, stats, posHistory, visitMap, lastDirection, otherAgentPositions = [], pendingFood = [], worldStep = 0) {
  const [r, c] = agentPos;
  const sense = senseNeighbors(grid, r, c);
  const newGrid = grid.map(row => [...row]);
  let newRules = rules.map(rule => ({ ...rule }));
  let newGoals = goals.map(g => ({ ...g }));
  let newStats = { ...stats };
  let newPendingFood = pendingFood;
  let log = null;

  // R1. PLASTICITY RECOVERY + R8. EXPLORE WEIGHT HOMEOSTASIS
  //     Both apply to every rule every step. Plasticity recovery returns
  //     plasticity toward 1.0 after sufficient quiet time. Homeostasis
  //     pulls explore weights toward their baseline of 0.2 at a slow rate.
  //     The latter is what prevents the runaway perturbation collapse
  //     observed in 50k-step batches — small accumulated nudges from the
  //     perturbation mechanism no longer push explore weights to extremes
  //     because there's now a restoring force.
  newRules = newRules.map(rule => {
    let plasticity = rule.plasticity;
    let weight = rule.weight;
    const stepsSinceFire = newStats.steps - (rule.lastFiredStep || 0);
    if (stepsSinceFire > RECOVERY_GRACE_STEPS && plasticity < 1.0) {
      plasticity = Math.min(1.0, plasticity + PLASTICITY_RECOVERY);
    }
    if (rule.category === 'explore') {
      weight += (EXPLORE_BASELINE_WEIGHT - weight) * EXPLORE_HOMEOSTASIS_RATE;
    }
    return { ...rule, plasticity, weight };
  });

  // R2. SPATIAL MEMORY DECAY
  let newVisitMap = visitMap.map(row => row.map(v => v * VISIT_DECAY));

  // R7. MEMORY RULE FIRING + DRIFT
  const currentQuadrant = getQuadrant(r, c);
  newRules = newRules.map(rule => {
    if (rule.category !== "memory") return rule;
    const isCurrentRegion = rule.region === currentQuadrant;
    const drift = (1.0 - rule.weight) * MEMORY_DRIFT_RATE;
    return {
      ...rule,
      weight: rule.weight + drift,
      activations: isCurrentRegion ? rule.activations + 1 : rule.activations,
      lastFiredStep: isCurrentRegion ? newStats.steps : rule.lastFiredStep,
    };
  });

  // Stagnation perturbation
  if (isStagnating(posHistory)) {
    newRules = perturbRules(newRules);
    newStats.perturbations = (newStats.perturbations || 0) + 1;
    log = `🔀 Loop detected — perturbing a plastic rule.`;
  }

  // 1. Which rules fire?
  const fired = newRules.filter(rule => evaluateCondition(rule.condition, sense));

  if (fired.length === 0) {
    const action = ACTIONS[Math.floor(Math.random() * 4)];
    const [dr, dc] = DIRS[action];
    const nr = (r + dr + GRID) % GRID;
    const nc = (c + dc + GRID) % GRID;
    newVisitMap[nr][nc] = Math.min(1.0, newVisitMap[nr][nc] + VISIT_INCREMENT);
    return { grid: newGrid, agentPos: [nr, nc], rules: newRules, goals: newGoals, stats: newStats, visitMap: newVisitMap, lastDirection: action, pendingFood: newPendingFood, log: log || "Random walk" };
  }

  // 1b. Action filtering — block any move into a sensed hazard
  const safeFired = fired.filter(rule => rule.action === "stay" || sense[rule.action] !== CELL_TYPES.HAZARD);
  const filteredCount = fired.length - safeFired.length;
  newStats.filtered = (newStats.filtered || 0) + filteredCount;

  // R4. SAFETY REINFORCEMENT
  if (filteredCount > 0) {
    newGoals = newGoals.map(g => {
      if (g.id !== "safety") return g;
      const newPriority = Math.min(1.0, g.priority + SAFETY_REINFORCEMENT * filteredCount * g.plasticity);
      const newPlasticity = Math.max(0.05, g.plasticity - 0.003 * filteredCount);
      return { ...g, priority: newPriority, plasticity: newPlasticity };
    });
  }

  if (safeFired.length === 0) {
    newStats.steps++;
    newVisitMap[r][c] = Math.min(1.0, newVisitMap[r][c] + VISIT_INCREMENT);
    return { grid: newGrid, agentPos: [r, c], rules: newRules, goals: newGoals, stats: newStats, visitMap: newVisitMap, lastDirection, pendingFood: newPendingFood, log: log || "🛑 Surrounded — staying put." };
  }

  // 2. Score safe rules
  const goalMap = Object.fromEntries(newGoals.map(g => [g.id, g.priority]));
  const scored = safeFired.map(rule => {
    let score = rule.weight * (goalMap[rule.category] || 0.1);
    if (rule.category === "explore" && rule.action !== "stay") {
      const [dr, dc] = DIRS[rule.action];
      const destR = (r + dr + GRID) % GRID;
      const destC = (c + dc + GRID) % GRID;
      const familiarity = newVisitMap[destR][destC];
      score *= (1 - familiarity * NOVELTY_BONUS_STRENGTH);
      if (rule.action === lastDirection) score *= MOMENTUM_MULTIPLIER;
      const destQuadrant = getQuadrant(destR, destC);
      const memoryRule = newRules.find(m => m.category === "memory" && m.region === destQuadrant);
      if (memoryRule) score *= memoryRule.weight;
    }
    return { ...rule, score };
  });

  // Softmax selection
  const maxScore = Math.max(...scored.map(r => r.score));
  const expScores = scored.map(r => Math.exp((r.score - maxScore) / TEMPERATURE));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sumExp;
  let chosen = scored[scored.length - 1];
  for (let i = 0; i < scored.length; i++) {
    rand -= expScores[i];
    if (rand <= 0) { chosen = scored[i]; break; }
  }

  // 3. Execute action
  const [dr, dc] = DIRS[chosen.action];
  const nr = (r + dr + GRID) % GRID;
  const nc = (c + dc + GRID) % GRID;
  const destination = newGrid[nr][nc];

  let feedback = 0;
  let landed = [nr, nc];

  if (destination === CELL_TYPES.HAZARD) {
    feedback = -1;
    newStats.hazardHits++;
    log = log || `⚠️ Hit hazard — "${chosen.label}" penalised.`;
    landed = [r, c];
  } else if (destination === CELL_TYPES.FOOD) {
    feedback = +1;
    newStats.foodEaten++;
    log = log || `🍎 Ate food — "${chosen.label}" reinforced.`;
    newGrid[nr][nc] = CELL_TYPES.EMPTY;
    // Respawn food immediately at a random empty cell not under any agent.
    // We previously experimented with a delayed respawn (5–20 steps) to
    // introduce temporal scarcity. That change combined destructively with
    // shared-budget memory — strong regional preferences plus depleted
    // food in preferred regions produced over-commitment loops that the
    // perturbation system couldn't break out of. Reverting to immediate
    // respawn here isolates the shared-budget memory change so we can see
    // its effects without that confound. The pendingFood/processRespawns
    // plumbing is left intact in case we want to revisit delayed respawn
    // with different parameters later.
    const occupied = new Set([`${landed[0]},${landed[1]}`, ...otherAgentPositions.map(p => `${p[0]},${p[1]}`)]);
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      const fr = Math.floor(Math.random() * GRID);
      const fc = Math.floor(Math.random() * GRID);
      if (newGrid[fr][fc] === CELL_TYPES.EMPTY && !occupied.has(`${fr},${fc}`)) {
        newGrid[fr][fc] = CELL_TYPES.FOOD;
        placed = true;
      }
    }
  } else {
    feedback = 0.01;
  }

  newVisitMap[landed[0]][landed[1]] = Math.min(1.0, newVisitMap[landed[0]][landed[1]] + VISIT_INCREMENT);

  // R7. MEMORY CREDIT ASSIGNMENT (shared budget)
  //     The four memory weights compete for a fixed total budget of 4.0
  //     (the sum at initialization). When food is eaten, weight transfers
  //     FROM uncredited rules TO credited rules — they cannot all grow
  //     independently. This forces the weights to encode RELATIVE regional
  //     productivity rather than absolute, which is the only signal that
  //     can drive differentiation in a world where every region is
  //     eventually productive in absolute terms.
  //
  //     Mechanics: each credited rule has a desired growth proportional to
  //     its headroom (so saturated rules don't try to grow further). The
  //     total desired growth is then taken proportionally from uncredited
  //     rules (multiplicatively, so weights approach but never reach zero,
  //     which preserves the option of re-learning a region later via the
  //     drift mechanism).
  if (destination === CELL_TYPES.FOOD) {
    const memoryRules = newRules.filter(r => r.category === "memory");
    const credited = [];
    const uncredited = [];
    for (const rule of memoryRules) {
      const eligible = rule.activations > 0 && (newStats.steps - rule.lastFiredStep) <= MEMORY_CREDIT_WINDOW;
      (eligible ? credited : uncredited).push(rule);
    }

    if (credited.length > 0 && uncredited.length > 0) {
      // Compute desired growth for each credited rule (saturates toward ceiling)
      const growthById = new Map();
      let totalGrowth = 0;
      for (const c of credited) {
        const headroom = MEMORY_WEIGHT_CEILING - c.weight;
        const growth = headroom * MEMORY_LEARN_RATE;
        growthById.set(c.id, growth);
        totalGrowth += growth;
      }
      // Total weight available to redistribute from uncredited rules
      const uncreditedTotal = uncredited.reduce((sum, u) => sum + u.weight, 0);
      const shrinkFraction = uncreditedTotal > 0 ? totalGrowth / uncreditedTotal : 0;

      newRules = newRules.map(rule => {
        if (rule.category !== "memory") return rule;
        if (growthById.has(rule.id)) {
          return { ...rule, weight: rule.weight + growthById.get(rule.id) };
        }
        // Uncredited rule: multiplicative shrinkage
        return { ...rule, weight: rule.weight * (1 - shrinkFraction) };
      });
    }
  }

  // R5. DIFFERENTIAL HARDENING + ASYMMETRIC LEARNING
  newRules = newRules.map(rule => {
    if (rule.id !== chosen.id) return rule;
    const isPositive = feedback > 0;
    const hardeningRate = isPositive ? HARDENING_BY_CATEGORY[rule.category] : 0;
    const learningRate = rule.category === 'explore'
      ? Math.abs(feedback) * 0.15
      : (isPositive ? rule.plasticity * 0.15 : 0.3);
    return {
      ...rule,
      weight:        Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, rule.weight + learningRate * feedback)),
      plasticity:    Math.max(0.05, rule.plasticity - hardeningRate),
      activations:   rule.activations + 1,
      lastFiredStep: newStats.steps,
    };
  });

  // Goal priority updates
  newGoals = newGoals.map(goal => {
    if (goal.plasticity < 0.1) return goal;
    let delta = 0;
    if (goal.id === "safety"  && destination === CELL_TYPES.HAZARD) delta = +0.10;
    if (goal.id === "food"    && destination === CELL_TYPES.FOOD)   delta = +0.05;
    if (goal.id === "safety"  && destination === CELL_TYPES.FOOD)   delta = -0.02;
    if (goal.id === "explore" && newStats.perturbations > (stats.perturbations || 0)) delta = +0.06;
    const natural = { safety: 0.7, food: 0.5, explore: 0.3 };
    const drift = (natural[goal.id] - goal.priority) * 0.003;
    const newPriority   = Math.max(0.1, Math.min(1.0, goal.priority + delta * goal.plasticity + drift));
    const newPlasticity = Math.max(0.05, goal.plasticity - Math.abs(delta) * 0.02);
    return { ...goal, priority: newPriority, plasticity: newPlasticity };
  });

  const newLastDirection = chosen.action === "stay" ? lastDirection : chosen.action;

  newStats.steps++;
  return { grid: newGrid, agentPos: landed, rules: newRules, goals: newGoals, stats: newStats, visitMap: newVisitMap, lastDirection: newLastDirection, pendingFood: newPendingFood, log };
}

// ─────────────────────────────────────────────────────────────
// HEADLESS SIMULATION — used by batch mode
// Supports both single-agent and dual-agent runs via the dual flag.
// ─────────────────────────────────────────────────────────────
async function runSingleSimulation(stepsToRun, dual, onProgress) {
  let grid = makeWorld();
  const numAgents = dual ? 2 : 1;
  const startPositions = [[1, 1], [GRID - 2, GRID - 2]];
  const agents = Array.from({ length: numAgents }, (_, i) => makeAgent(startPositions[i]));
  const posHistory = Array.from({ length: numAgents }, () => []);
  let lastFoodEaten = Array.from({ length: numAgents }, () => 0);
  const learningCurve = [];
  let pendingFood = [];

  for (let s = 0; s < stepsToRun; s++) {
    // 1. Process any food respawns whose delay has expired. This happens
    //    once per tick before any agent steps, so both agents see the
    //    same world after respawns.
    const respawnResult = processRespawns(grid, pendingFood, s, agents.map(a => a.pos));
    grid = respawnResult.grid;
    pendingFood = respawnResult.pendingFood;

    // 2. Determine processing order. In dual mode we alternate which agent
    //    processes first each tick. This eliminates the structural first-
    //    mover advantage that we observed in 50k dual-agent batches, where
    //    the always-first agent compounds a small per-tick lead into a
    //    significant cumulative efficiency gap by run's end.
    const firstIdx = dual ? (s % 2) : 0;
    const order = dual ? [firstIdx, 1 - firstIdx] : [0];

    for (const idx of order) {
      const agent = agents[idx];
      const others = agents.filter((_, i) => i !== idx).map(a => a.pos);

      posHistory[idx] = [...posHistory[idx], agent.pos].slice(-HISTORY_LEN);
      const prevPert = agent.stats.perturbations;
      const result = agentStep(
        grid, agent.pos, agent.rules, agent.goals, agent.stats,
        posHistory[idx], agent.visitMap, agent.lastDirection, others,
        pendingFood, s
      );
      if (result.stats.perturbations > prevPert) posHistory[idx] = [];

      grid = result.grid;
      pendingFood = result.pendingFood;
      agents[idx] = {
        pos: result.agentPos,
        rules: result.rules,
        goals: result.goals,
        stats: result.stats,
        visitMap: result.visitMap,
        lastDirection: result.lastDirection,
      };
    }

    if ((s + 1) % 1000 === 0) {
      const snapshot = {
        step: s + 1,
        agents: agents.map((a, i) => ({
          foodEaten: a.stats.foodEaten,
          hazardHits: a.stats.hazardHits,
          perturbations: a.stats.perturbations,
          cumulativeEff: a.stats.foodEaten / (s + 1),
          rollingEff: (a.stats.foodEaten - lastFoodEaten[i]) / 1000,
        })),
      };
      lastFoodEaten = agents.map(a => a.stats.foodEaten);
      learningCurve.push(snapshot);
      onProgress(s + 1);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return { agents, learningCurve, dual };
}

async function runBatch(numRuns, stepsPerRun, dual, onProgress) {
  const results = [];
  for (let i = 0; i < numRuns; i++) {
    const result = await runSingleSimulation(stepsPerRun, dual, (step) => {
      onProgress({ runIndex: i, runStep: step, totalRuns: numRuns, totalSteps: stepsPerRun });
    });
    results.push(result);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// REPORT GENERATION
// ─────────────────────────────────────────────────────────────
function pad(s, n, right = false) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  return right ? s + " ".repeat(n - s.length) : " ".repeat(n - s.length) + s;
}
function padR(s, n) { return pad(s, n, true); }
function pct(v) { return (v * 100).toFixed(2) + " %"; }
function avg(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function fmt(v, d = 2) { return Number(v).toFixed(d); }

function generateReport(results, stepsPerRun) {
  const dual = results[0].dual;
  const numAgents = dual ? 2 : 1;
  const numRuns = results.length;
  const totalSteps = numRuns * stepsPerRun;
  const ts = new Date().toISOString();
  const lines = [];
  const SEP_BIG = "=".repeat(80);
  const SEP_SM  = "-".repeat(80);

  lines.push(SEP_BIG);
  lines.push("                  ADAPTIVE MIND SIMULATION — BATCH REPORT");
  lines.push(SEP_BIG);
  lines.push(`Timestamp:             ${ts}`);
  lines.push(`Mode:                  ${dual ? "DUAL-AGENT" : "SINGLE-AGENT"}`);
  lines.push(`Agents per Run:        ${numAgents}`);
  lines.push(`Total Test Runs:       ${numRuns}`);
  lines.push(`Steps Per Run:         ${stepsPerRun}`);
  lines.push(`Total Steps Simulated: ${totalSteps}`);
  lines.push(SEP_SM);
  lines.push("");

  // ── 1. Executive Summary ──
  lines.push(SEP_BIG);
  lines.push("1. EXECUTIVE SUMMARY");
  lines.push(SEP_BIG);
  for (let a = 0; a < numAgents; a++) {
    const tag = dual ? `[Agent ${a === 0 ? "A" : "B"}]` : "";
    lines.push("");
    if (dual) lines.push(`${tag}`);
    const foods   = results.map(r => r.agents[a].stats.foodEaten);
    const hazards = results.map(r => r.agents[a].stats.hazardHits);
    const perts   = results.map(r => r.agents[a].stats.perturbations);
    const effs    = results.map(r => r.agents[a].stats.foodEaten / stepsPerRun);
    lines.push("Metric                 | Average    | Min        | Max        | Total");
    lines.push("-----------------------|------------|------------|------------|---------");
    lines.push(`Food Eaten             | ${padR(fmt(avg(foods)), 10)} | ${padR(Math.min(...foods), 10)} | ${padR(Math.max(...foods), 10)} | ${foods.reduce((a, b) => a + b, 0)}`);
    lines.push(`Hazard Hits            | ${padR(fmt(avg(hazards)), 10)} | ${padR(Math.min(...hazards), 10)} | ${padR(Math.max(...hazards), 10)} | ${hazards.reduce((a, b) => a + b, 0)}`);
    lines.push(`Perturbations (Loops)  | ${padR(fmt(avg(perts)), 10)} | ${padR(Math.min(...perts), 10)} | ${padR(Math.max(...perts), 10)} | ${perts.reduce((a, b) => a + b, 0)}`);
    lines.push(`Cumulative Efficiency  | ${padR(pct(avg(effs)), 10)} | ${padR(pct(Math.min(...effs)), 10)} | ${padR(pct(Math.max(...effs)), 10)} | N/A`);
  }
  lines.push("");

  // ── 2. Learning Curve ──
  lines.push(SEP_BIG);
  lines.push("2. LEARNING CURVE (AVERAGED OVER RUNS)");
  lines.push(SEP_BIG);
  for (let a = 0; a < numAgents; a++) {
    lines.push("");
    if (dual) lines.push(`[Agent ${a === 0 ? "A" : "B"}]`);
    const curveLen = results[0].learningCurve.length;
    lines.push("Step   | Avg Food | Avg Haz | Avg Pert | Cum. Eff.   | Rolling-1k Eff.");
    lines.push("-------|----------|---------|----------|-------------|----------------");
    for (let i = 0; i < curveLen; i++) {
      const step = results[0].learningCurve[i].step;
      const fe = avg(results.map(r => r.learningCurve[i].agents[a].foodEaten));
      const hh = avg(results.map(r => r.learningCurve[i].agents[a].hazardHits));
      const pp = avg(results.map(r => r.learningCurve[i].agents[a].perturbations));
      const ce = avg(results.map(r => r.learningCurve[i].agents[a].cumulativeEff));
      const re = avg(results.map(r => r.learningCurve[i].agents[a].rollingEff));
      lines.push(`${padR(step, 6)} | ${padR(fmt(fe, 1), 8)} | ${padR(fmt(hh, 1), 7)} | ${padR(fmt(pp, 1), 8)} | ${padR(pct(ce), 11)} | ${pct(re)}`);
    }
  }
  lines.push("");

  // ── 3. Rule Profiles ──
  lines.push(SEP_BIG);
  lines.push("3. FINAL RULE NODE PROFILES (AVERAGED)");
  lines.push(SEP_BIG);
  for (let a = 0; a < numAgents; a++) {
    lines.push("");
    if (dual) lines.push(`[Agent ${a === 0 ? "A" : "B"}]`);
    lines.push("Rule Label             | Category | Avg Weight | Avg Plasticity | Avg Activations");
    lines.push("-----------------------|----------|------------|----------------|----------------");
    const numRules = results[0].agents[a].rules.length;
    for (let i = 0; i < numRules; i++) {
      const label = results[0].agents[a].rules[i].label;
      const cat   = results[0].agents[a].rules[i].category;
      const w = avg(results.map(r => r.agents[a].rules[i].weight));
      const p = avg(results.map(r => r.agents[a].rules[i].plasticity));
      const ac = avg(results.map(r => r.agents[a].rules[i].activations));
      lines.push(`${padR(label, 22)} | ${padR(cat, 8)} | ${padR(fmt(w, 3), 10)} | ${padR(pct(p), 14)} | ${fmt(ac, 1)}`);
    }
  }
  lines.push("");

  // ── 4. Goal Priorities ──
  lines.push(SEP_BIG);
  lines.push("4. FINAL GOAL PRIORITIES (AVERAGED)");
  lines.push(SEP_BIG);
  for (let a = 0; a < numAgents; a++) {
    lines.push("");
    if (dual) lines.push(`[Agent ${a === 0 ? "A" : "B"}]`);
    lines.push("Goal Name        | Avg Priority | Avg Plasticity");
    lines.push("-----------------|--------------|----------------");
    for (let i = 0; i < results[0].agents[a].goals.length; i++) {
      const label = results[0].agents[a].goals[i].label;
      const pr = avg(results.map(r => r.agents[a].goals[i].priority));
      const pl = avg(results.map(r => r.agents[a].goals[i].plasticity));
      lines.push(`${padR(label, 16)} | ${padR(pct(pr), 12)} | ${pct(pl)}`);
    }
  }
  lines.push("");

  // ── 5. Per-Run Details ──
  lines.push(SEP_BIG);
  lines.push("5. DETAILED INDIVIDUAL RUN LOGS");
  lines.push(SEP_BIG);
  results.forEach((res, idx) => {
    lines.push("");
    lines.push(SEP_SM);
    lines.push(`RUN ${idx + 1} FINAL METRICS:`);
    lines.push(SEP_SM);
    for (let a = 0; a < numAgents; a++) {
      const ag = res.agents[a];
      if (dual) lines.push(`\n  --- Agent ${a === 0 ? "A" : "B"} ---`);
      lines.push(`  Steps:         ${stepsPerRun}`);
      lines.push(`  Food Eaten:    ${ag.stats.foodEaten}`);
      lines.push(`  Hazard Hits:   ${ag.stats.hazardHits}`);
      lines.push(`  Perturbations: ${ag.stats.perturbations}`);
      lines.push(`  Efficiency:    ${pct(ag.stats.foodEaten / stepsPerRun)}`);
      lines.push("");
      lines.push("  Final Goals State:");
      ag.goals.forEach(g => {
        lines.push(`    ${padR(g.label, 18)} priority ${pct(g.priority)}, plasticity ${pct(g.plasticity)}`);
      });
      lines.push("");
      lines.push("  Final Rules:");
      ["safety", "food", "explore", "memory"].forEach(cat => {
        lines.push(`    [${cat.toUpperCase()}]`);
        ag.rules.filter(r => r.category === cat).forEach(rule => {
          lines.push(`      ${padR(rule.label, 20)} w:${fmt(rule.weight, 3)} plast:${pct(rule.plasticity)} act:${rule.activations}`);
        });
      });
    }
  });
  lines.push("");
  lines.push(SEP_BIG);
  lines.push("[REPORT END]");
  lines.push(SEP_BIG);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// VISUAL HELPERS
// ─────────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  safety:  { bg: "#fef2f2", border: "#ef4444", text: "#991b1b" },
  food:    { bg: "#f0fdf4", border: "#22c55e", text: "#14532d" },
  explore: { bg: "#eff6ff", border: "#3b82f6", text: "#1e3a8a" },
  memory:  { bg: "#fef3c7", border: "#f59e0b", text: "#78350f" },
};

// Distinct visual identities for the two agents. Agent A keeps the blue
// it had as the sole agent; Agent B gets a warm amber so they're easily
// distinguishable on the grid and in the chart legend.
const AGENT_COLORS = [
  { primary: "#3b82f6", glow: "#3b82f6aa", symbol: "◈", tintR: 59,  tintG: 130, tintB: 246 },
  { primary: "#f59e0b", glow: "#f59e0baa", symbol: "◆", tintR: 245, tintG: 158, tintB: 11  },
];

function PlasticityBar({ value }) {
  const pct = Math.round(value * 100);
  const color = value > 0.6 ? "#22c55e" : value > 0.3 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 10, color: "#64748b", minWidth: 28, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function GoalBar({ goal }) {
  const pct = Math.round(goal.priority * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>{goal.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>plasticity {Math.round(goal.plasticity * 100)}%</span>
      </div>
      <div style={{ height: 10, background: "#1e293b", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: goal.color, borderRadius: 5, transition: "width 0.4s" }} />
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: "#64748b", marginTop: 2 }}>{pct}/100</div>
    </div>
  );
}

function EfficiencyChart({ history, dual }) {
  const width = 552, height = 110;
  if (history.length < 2) {
    return (
      <div style={{
        background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b",
        padding: 12, maxWidth: width + 24, minHeight: height + 20,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ color: "#334155", fontSize: 11, fontStyle: "italic" }}>
          Run the simulation to see efficiency over time…
        </span>
      </div>
    );
  }
  const allValues = history.flatMap(h => [
    h.agents[0].cumulative, h.agents[0].rolling,
    ...(dual && h.agents[1] ? [h.agents[1].cumulative, h.agents[1].rolling] : []),
  ]);
  const maxY = Math.max(0.15, ...allValues) * 1.1;
  const xScale = i => (i / Math.max(history.length - 1, 1)) * width;
  const yScale = v => height - (v / maxY) * height;

  const lines = [];
  // Agent A
  lines.push({ pts: history.map((h, i) => `${xScale(i)},${yScale(h.agents[0].cumulative)}`).join(" "), color: "#60a5fa", dash: "4 2" });
  lines.push({ pts: history.map((h, i) => `${xScale(i)},${yScale(h.agents[0].rolling)}`).join(" "), color: "#3b82f6", dash: null });
  // Agent B (if dual)
  if (dual) {
    lines.push({ pts: history.map((h, i) => h.agents[1] ? `${xScale(i)},${yScale(h.agents[1].cumulative)}` : null).filter(Boolean).join(" "), color: "#fcd34d", dash: "4 2" });
    lines.push({ pts: history.map((h, i) => h.agents[1] ? `${xScale(i)},${yScale(h.agents[1].rolling)}` : null).filter(Boolean).join(" "), color: "#f59e0b", dash: null });
  }
  const latest = history[history.length - 1];
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b", padding: 12, maxWidth: width + 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "#475569", textTransform: "uppercase" }}>Efficiency over time</span>
        <span style={{ fontSize: 10, color: "#64748b" }}>
          <span style={{ color: "#3b82f6" }}>● A</span>
          {dual && <span style={{ color: "#f59e0b", marginLeft: 8 }}>● B</span>}
          <span style={{ marginLeft: 8, color: "#64748b" }}>(solid: rolling-{ROLLING_WINDOW}, dashed: cumulative)</span>
        </span>
      </div>
      <svg width={width} height={height} style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1.0].map(frac => {
          const y = yScale(maxY * frac);
          return <line key={frac} x1={0} y1={y} x2={width} y2={y} stroke="#1e293b" strokeWidth={1} />;
        })}
        {lines.map((line, i) =>
          <polyline key={i} fill="none" stroke={line.color} strokeWidth={1.5}
            points={line.pts} strokeDasharray={line.dash || undefined} />
        )}
      </svg>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
        <span>step {history[0].step}</span>
        <span>
          A: cum {(latest.agents[0].cumulative * 100).toFixed(1)}%, roll {(latest.agents[0].rolling * 100).toFixed(1)}%
          {dual && latest.agents[1] && <span>  ·  B: cum {(latest.agents[1].cumulative * 100).toFixed(1)}%, roll {(latest.agents[1].rolling * 100).toFixed(1)}%</span>}
        </span>
        <span>step {latest.step}</span>
      </div>
    </div>
  );
}

function BatchReportModal({ report, onClose, onDownload }) {
  if (!report) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
    }}>
      <div style={{
        background: "#0a0f1e", borderRadius: 12, border: "1px solid #334155",
        maxWidth: 900, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{
          padding: 16, borderBottom: "1px solid #1e293b",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: "#94a3b8", textTransform: "uppercase" }}>Batch Run Report</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onDownload} style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid #334155", cursor: "pointer",
              background: "#1e3a8a", color: "#93c5fd", fontFamily: "monospace", fontSize: 12,
            }}>↓ DOWNLOAD .LOG</button>
            <button onClick={onClose} style={{
              padding: "6px 14px", borderRadius: 6, border: "1px solid #334155", cursor: "pointer",
              background: "transparent", color: "#94a3b8", fontFamily: "monospace", fontSize: 12,
            }}>✕ CLOSE</button>
          </div>
        </div>
        <pre style={{
          margin: 0, padding: 16, overflow: "auto",
          fontFamily: "'Courier New', monospace", fontSize: 11, color: "#cbd5e1",
          background: "#0f172a", flex: 1, lineHeight: 1.5,
        }}>
          {report}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────
const AGENT_START_POSITIONS = [[1, 1], [GRID - 2, GRID - 2]];

export default function AdaptiveMindSim() {
  // Dual-agent mode toggle. Both agents always exist in state, but in
  // single mode only agent 0 is active and rendered. Switching modes
  // performs a reset since the run-to-run comparison only makes sense
  // for runs that started in the same mode.
  const [dualMode, setDualMode] = useState(false);

  // Shared world
  const [grid, setGrid] = useState(() => makeWorld());

  // Per-agent state, always two entries
  const [agents, setAgents] = useState(() => AGENT_START_POSITIONS.map(makeAgent));

  // UI state
  const [running, setRunning]   = useState(false);
  const [speed, setSpeed]       = useState(TICK_MS);
  const [log, setLog]           = useState([]);
  const [generation, setGeneration] = useState(1);
  const [efficiencyHistory, setEfficiencyHistory] = useState([]);
  const [activeAgentTab, setActiveAgentTab] = useState(0);

  // Batch state
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchReport, setBatchReport] = useState(null);
  const [batchNumRuns, setBatchNumRuns] = useState(5);
  const [batchStepsPerRun, setBatchStepsPerRun] = useState(10000);

  // Per-agent runtime refs (not displayed)
  const agentRuntimeRefs = useRef([
    { posHistory: [], foodEvents: [] },
    { posHistory: [], foodEvents: [] },
  ]);
  const intervalRef = useRef(null);
  const pendingFoodRef = useRef([]);
  const stateRef    = useRef({ grid, agents, dualMode });

  useEffect(() => {
    stateRef.current = { grid, agents, dualMode };
  }, [grid, agents, dualMode]);

  const step = useCallback(() => {
    const s = stateRef.current;
    let curGrid = s.grid;
    let curPending = pendingFoodRef.current;
    const newAgents = [...s.agents];
    const newLogEntries = [];
    // worldStep is the global tick counter — both agents share it. We
    // use agent 0's current step count, which is the same as agent 1's
    // after every completed tick.
    const worldStep = newAgents[0].stats.steps;

    // 1. Process any food respawns whose delay has expired.
    const respawnResult = processRespawns(
      curGrid, curPending, worldStep,
      (s.dualMode ? newAgents : [newAgents[0]]).map(a => a.pos)
    );
    curGrid = respawnResult.grid;
    curPending = respawnResult.pendingFood;

    // 2. Alternate processing order in dual mode (eliminates first-mover bias).
    const firstIdx = s.dualMode ? (worldStep % 2) : 0;
    const activeIndices = s.dualMode ? [firstIdx, 1 - firstIdx] : [0];

    for (const idx of activeIndices) {
      const agent = newAgents[idx];
      const rt = agentRuntimeRefs.current[idx];
      const others = activeIndices.filter(i => i !== idx).map(i => newAgents[i].pos);

      rt.posHistory = [...rt.posHistory, agent.pos].slice(-HISTORY_LEN);
      const prevPert = agent.stats.perturbations;
      const result = agentStep(
        curGrid, agent.pos, agent.rules, agent.goals, agent.stats,
        rt.posHistory, agent.visitMap, agent.lastDirection, others,
        curPending, worldStep
      );
      if (result.stats.perturbations > prevPert) rt.posHistory = [];

      const ate = result.stats.foodEaten > agent.stats.foodEaten ? 1 : 0;
      rt.foodEvents = [...rt.foodEvents, ate].slice(-ROLLING_WINDOW * 3);

      curGrid = result.grid;
      curPending = result.pendingFood;
      newAgents[idx] = {
        pos: result.agentPos,
        rules: result.rules,
        goals: result.goals,
        stats: result.stats,
        visitMap: result.visitMap,
        lastDirection: result.lastDirection,
      };
      if (result.log) {
        newLogEntries.push(s.dualMode ? `[${idx === 0 ? "A" : "B"}] ${result.log}` : result.log);
      }
    }

    pendingFoodRef.current = curPending;

    // Build efficiency-history sample combining both agents' metrics
    const sample = {
      step: newAgents[0].stats.steps,
      agents: activeIndices.map(idx => {
        const ag = newAgents[idx];
        const rt = agentRuntimeRefs.current[idx];
        const cumulative = ag.stats.steps > 0 ? ag.stats.foodEaten / ag.stats.steps : 0;
        const recent = rt.foodEvents.slice(-ROLLING_WINDOW);
        const rolling = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
        return { cumulative, rolling };
      }),
    };
    // Pad with placeholders for missing agent if single mode (chart code is robust)
    if (sample.agents.length < 2) sample.agents.push(null);

    setEfficiencyHistory(prev => [...prev, sample].slice(-CHART_MAX_SAMPLES));
    setGrid(curGrid);
    setAgents(newAgents);
    if (newLogEntries.length > 0) {
      setLog(prev => [...newLogEntries.reverse(), ...prev].slice(0, 8));
    }
  }, []);

  useEffect(() => {
    if (running && !batchRunning) {
      intervalRef.current = setInterval(step, speed);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, speed, step, batchRunning]);

  const reset = (newDualMode = dualMode) => {
    setRunning(false);
    agentRuntimeRefs.current = [
      { posHistory: [], foodEvents: [] },
      { posHistory: [], foodEvents: [] },
    ];
    pendingFoodRef.current = [];
    setGrid(makeWorld());
    setAgents(AGENT_START_POSITIONS.map(makeAgent));
    setLog([]);
    setEfficiencyHistory([]);
    setGeneration(g => g + 1);
    if (newDualMode !== dualMode) {
      setDualMode(newDualMode);
      setActiveAgentTab(0);
    }
  };

  const startBatch = async () => {
    setRunning(false);
    setBatchRunning(true);
    setBatchReport(null);
    setBatchProgress({ runIndex: 0, runStep: 0, totalRuns: batchNumRuns, totalSteps: batchStepsPerRun });
    try {
      const results = await runBatch(batchNumRuns, batchStepsPerRun, dualMode, setBatchProgress);
      const reportText = generateReport(results, batchStepsPerRun);
      setBatchReport(reportText);
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  };

  const downloadReport = () => {
    if (!batchReport) return;
    const blob = new Blob([batchReport], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const modeStr = dualMode ? "dual" : "single";
    a.download = `adaptive-mind-batch-${modeStr}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // The currently-displayed agent for the rules/goals panel
  const displayedAgent = agents[activeAgentTab] || agents[0];
  const displayedRules = displayedAgent.rules;
  const displayedGoals = displayedAgent.goals;
  const rulesByCategory = displayedRules.reduce((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r);
    return acc;
  }, {});

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1e",
      fontFamily: "'Courier New', monospace", color: "#e2e8f0",
      padding: 24, display: "flex", flexDirection: "column", gap: 20,
    }}>

      {/* HEADER */}
      <div style={{ borderBottom: "1px solid #1e293b", paddingBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
          Adaptive Rule System · Generation {generation} · {dualMode ? "Dual-Agent Mode" : "Single-Agent Mode"}
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: 1 }}>
          Emergent Mind Prototype
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b", maxWidth: 720 }}>
          v4 · plasticity recovery · spatial memory · differential hardening · safety reinforcement · directional momentum · regional memory · {dualMode ? "two competing agents sharing a world" : "single agent baseline"}
        </p>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* LEFT: GRID + CONTROLS + CHART */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
            gap: 2, background: "#0f172a", padding: 12,
            borderRadius: 12, border: "1px solid #1e293b",
          }}>
            {grid.map((row, r) =>
              row.map((cell, c) => {
                const isAgent0 = r === agents[0].pos[0] && c === agents[0].pos[1];
                const isAgent1 = dualMode && r === agents[1].pos[0] && c === agents[1].pos[1];
                const v0 = agents[0].visitMap[r][c];
                const v1 = dualMode ? agents[1].visitMap[r][c] : 0;
                // Composite the two visit-tints with simple alpha blending
                // over the dark cell background.
                const baseColor = cell === CELL_TYPES.HAZARD ? [127, 29, 29]
                                : cell === CELL_TYPES.FOOD   ? [20, 83, 45]
                                : [15, 23, 41];
                let [tr, tg, tb] = baseColor;
                const a0 = v0 * 0.5, a1 = v1 * 0.5;
                tr = tr * (1 - a0) + AGENT_COLORS[0].tintR * a0;
                tg = tg * (1 - a0) + AGENT_COLORS[0].tintG * a0;
                tb = tb * (1 - a0) + AGENT_COLORS[0].tintB * a0;
                tr = tr * (1 - a1) + AGENT_COLORS[1].tintR * a1;
                tg = tg * (1 - a1) + AGENT_COLORS[1].tintG * a1;
                tb = tb * (1 - a1) + AGENT_COLORS[1].tintB * a1;
                let cellBg = `rgb(${Math.round(tr)},${Math.round(tg)},${Math.round(tb)})`;
                if (isAgent0 && isAgent1) cellBg = "#a855f7"; // overlap = purple
                else if (isAgent0)        cellBg = AGENT_COLORS[0].primary;
                else if (isAgent1)        cellBg = AGENT_COLORS[1].primary;

                const border = isAgent0 && isAgent1 ? "2px solid #d8b4fe"
                  : isAgent0 ? `2px solid ${AGENT_COLORS[0].primary}`
                  : isAgent1 ? `2px solid ${AGENT_COLORS[1].primary}`
                  : cell === CELL_TYPES.HAZARD ? "1px solid #dc2626"
                  : cell === CELL_TYPES.FOOD ? "1px solid #22c55e"
                  : "1px solid #1e293b";
                const shadow = isAgent0 && isAgent1 ? "0 0 12px #a855f7aa"
                  : isAgent0 ? `0 0 12px ${AGENT_COLORS[0].glow}`
                  : isAgent1 ? `0 0 12px ${AGENT_COLORS[1].glow}`
                  : "none";

                const symbol = isAgent0 && isAgent1 ? "◇"
                  : isAgent0 ? AGENT_COLORS[0].symbol
                  : isAgent1 ? AGENT_COLORS[1].symbol
                  : cell === CELL_TYPES.FOOD ? "●"
                  : cell === CELL_TYPES.HAZARD ? "✕"
                  : "";

                return (
                  <div key={`${r}-${c}`} style={{
                    width: CELL, height: CELL, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, background: cellBg, border, boxShadow: shadow,
                    transition: "background 0.2s",
                  }}>
                    {symbol}
                  </div>
                );
              })
            )}
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setRunning(r => !r)} disabled={batchRunning} style={{
              padding: "8px 20px", borderRadius: 8, border: "none",
              cursor: batchRunning ? "not-allowed" : "pointer",
              background: running ? "#7f1d1d" : "#1e3a8a",
              color: running ? "#fca5a5" : "#93c5fd",
              opacity: batchRunning ? 0.5 : 1,
              fontFamily: "monospace", fontWeight: 700, fontSize: 13, letterSpacing: 1,
            }}>
              {running ? "⏸ PAUSE" : "▶ RUN"}
            </button>
            <button onClick={step} disabled={running || batchRunning} style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #334155",
              cursor: running || batchRunning ? "not-allowed" : "pointer",
              background: "transparent", color: "#94a3b8", fontFamily: "monospace", fontSize: 13,
              opacity: (running || batchRunning) ? 0.5 : 1,
            }}>▷ STEP</button>
            <button onClick={() => reset()} disabled={batchRunning} style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #334155",
              cursor: batchRunning ? "not-allowed" : "pointer",
              background: "transparent", color: "#94a3b8", fontFamily: "monospace", fontSize: 13,
              opacity: batchRunning ? 0.5 : 1,
            }}>↺ RESET</button>
            <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 8 }}>
              Speed
              <input type="range" min={80} max={800} step={40} value={speed}
                onChange={e => setSpeed(+e.target.value)} disabled={batchRunning}
                style={{ width: 80 }} />
              <span style={{ color: "#94a3b8" }}>{speed}ms</span>
            </label>
            <label style={{
              fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6,
              padding: "6px 10px", border: "1px solid #334155", borderRadius: 6, cursor: batchRunning ? "not-allowed" : "pointer",
              opacity: batchRunning ? 0.5 : 1, background: dualMode ? "#1e3a8a22" : "transparent",
            }}>
              <input type="checkbox" checked={dualMode} disabled={batchRunning}
                onChange={e => reset(e.target.checked)} />
              Dual-Agent Mode
            </label>
          </div>

          {/* Stats — one block per active agent */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(dualMode ? [0, 1] : [0]).map(idx => {
              const ag = agents[idx];
              const tag = dualMode ? (idx === 0 ? "Agent A" : "Agent B") : "Stats";
              const color = AGENT_COLORS[idx].primary;
              return (
                <div key={idx} style={{
                  flex: 1, minWidth: 280,
                  background: "#0f172a", padding: "10px 16px", borderRadius: 8,
                  border: `1px solid ${dualMode ? color + "44" : "#1e293b"}`,
                }}>
                  <div style={{
                    fontSize: 10, color, letterSpacing: 2,
                    textTransform: "uppercase", marginBottom: 6,
                  }}>{tag}</div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {[
                      ["Steps",         ag.stats.steps,         "#f1f5f9"],
                      ["Food",          ag.stats.foodEaten,     "#22c55e"],
                      ["Hazards",       ag.stats.hazardHits,    "#ef4444"],
                      ["Perturbs",      ag.stats.perturbations, "#a78bfa"],
                      ["Filtered",      ag.stats.filtered || 0, "#60a5fa"],
                    ].map(([label, val, c]) => (
                      <div key={label}>
                        <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: c }}>{val}</div>
                      </div>
                    ))}
                    <div>
                      <div style={{ fontSize: 9, color: "#475569", letterSpacing: 2, textTransform: "uppercase" }}>Eff</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color: "#f59e0b" }}>
                        {ag.stats.steps === 0 ? "—" : `${Math.round((ag.stats.foodEaten / Math.max(1, ag.stats.steps)) * 100)}%`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Efficiency chart */}
          <EfficiencyChart history={efficiencyHistory} dual={dualMode} />

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
            <span><span style={{ color: AGENT_COLORS[0].primary }}>◈</span> Agent A</span>
            {dualMode && <span><span style={{ color: AGENT_COLORS[1].primary }}>◆</span> Agent B</span>}
            {dualMode && <span><span style={{ color: "#a855f7" }}>◇</span> Both (same cell)</span>}
            <span><span style={{ color: "#22c55e" }}>●</span> Food</span>
            <span><span style={{ color: "#ef4444" }}>✕</span> Hazard</span>
          </div>

          {/* Event log */}
          <div style={{
            background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b",
            padding: 12, minHeight: 120, maxWidth: `${GRID * CELL + 24}px`,
          }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 8, textTransform: "uppercase" }}>Event Log</div>
            {log.length === 0
              ? <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>Awaiting first step…</div>
              : log.map((entry, i) => (
                <div key={i} style={{
                  fontSize: 12,
                  color: i === 0
                    ? (entry.includes("🔀") ? "#a78bfa" : "#e2e8f0")
                    : "#475569",
                  marginBottom: 3, transition: "color 0.5s",
                }}>{entry}</div>
              ))}
          </div>
        </div>

        {/* RIGHT: BATCH + AGENT TABS + GOALS + RULES */}
        <div style={{ flex: 1, minWidth: 320, display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Batch Panel */}
          <div style={{
            background: "#0f172a", borderRadius: 12,
            border: batchRunning ? "1px solid #6366f1" : "1px solid #1e293b",
            padding: 16, transition: "border 0.3s",
          }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
              Batch Evaluation {dualMode ? "(dual-agent)" : "(single-agent)"}
            </div>
            {batchRunning && batchProgress ? (
              <div>
                <div style={{ marginBottom: 8, fontSize: 12, color: "#cbd5e1" }}>
                  Run {batchProgress.runIndex + 1} of {batchProgress.totalRuns} · step {batchProgress.runStep} / {batchProgress.totalSteps}
                </div>
                <div style={{ height: 8, background: "#1e293b", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
                  <div style={{
                    width: `${(batchProgress.runStep / batchProgress.totalSteps) * 100}%`,
                    height: "100%", background: "#6366f1", borderRadius: 4, transition: "width 0.2s",
                  }} />
                </div>
                <div style={{ height: 4, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${((batchProgress.runIndex + batchProgress.runStep / batchProgress.totalSteps) / batchProgress.totalRuns) * 100}%`,
                    height: "100%", background: "#a78bfa", borderRadius: 4, transition: "width 0.2s",
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 8 }}>
                  Running headless — no rendering, no chart, no event log.
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 4 }}>
                    Runs
                    <select value={batchNumRuns} onChange={e => setBatchNumRuns(+e.target.value)}
                      style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
                        padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}>
                      {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 4 }}>
                    Steps per run
                    <select value={batchStepsPerRun} onChange={e => setBatchStepsPerRun(+e.target.value)}
                      style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
                        padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}>
                      {[1000, 3000, 5000, 10000, 25000, 50000].map(n => <option key={n} value={n}>{n.toLocaleString()}</option>)}
                    </select>
                  </label>
                </div>
                <button onClick={startBatch} style={{
                  padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                  background: "#4f46e5", color: "#e0e7ff",
                  fontFamily: "monospace", fontWeight: 700, fontSize: 13, letterSpacing: 1, width: "100%",
                }}>
                  ▶ RUN BATCH ({batchNumRuns} × {batchStepsPerRun.toLocaleString()})
                </button>
                {batchReport && (
                  <button onClick={() => setBatchReport(batchReport)} style={{
                    padding: "6px 14px", borderRadius: 6, border: "1px solid #334155", cursor: "pointer",
                    background: "transparent", color: "#a78bfa", fontFamily: "monospace", fontSize: 12,
                    width: "100%", marginTop: 8,
                  }}>↗ View last report</button>
                )}
                <div style={{ fontSize: 11, color: "#334155", marginTop: 8, lineHeight: 1.5 }}>
                  {dualMode
                    ? "Two agents share the same world, food supply, and hazard layout. They cannot perceive each other; competition is purely through depletion."
                    : "Single-agent baseline. Toggle Dual-Agent Mode to enable competition."}
                </div>
              </div>
            )}
          </div>

          {/* Agent tab selector (only in dual mode) */}
          {dualMode && (
            <div style={{ display: "flex", gap: 4, padding: 4, background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
              {[0, 1].map(idx => (
                <button key={idx} onClick={() => setActiveAgentTab(idx)} style={{
                  flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: activeAgentTab === idx ? AGENT_COLORS[idx].primary + "44" : "transparent",
                  color: activeAgentTab === idx ? AGENT_COLORS[idx].primary : "#64748b",
                  fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 1,
                }}>
                  {AGENT_COLORS[idx].symbol} Agent {idx === 0 ? "A" : "B"}
                </button>
              ))}
            </div>
          )}

          {/* Goals (for active agent) */}
          <div style={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b", padding: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
              {dualMode ? `Agent ${activeAgentTab === 0 ? "A" : "B"} ` : ""}Goal Structure
            </div>
            {displayedGoals.map(goal => <GoalBar key={goal.id} goal={goal} />)}
          </div>

          {/* Rules (for active agent) */}
          <div style={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b", padding: 16 }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
              {dualMode ? `Agent ${activeAgentTab === 0 ? "A" : "B"} ` : ""}Rule Nodes
            </div>
            {Object.entries(rulesByCategory).map(([cat, catRules]) => {
              const colors = CATEGORY_COLORS[cat];
              return (
                <div key={cat} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 10, letterSpacing: 2, fontWeight: 700, color: colors.text,
                    textTransform: "uppercase", marginBottom: 8, paddingBottom: 4,
                    borderBottom: `1px solid ${colors.border}33`,
                  }}>
                    {cat} rules · hardens @ {(HARDENING_BY_CATEGORY[cat] * 100).toFixed(1)}%/fire
                  </div>
                  {catRules.map(rule => {
                    const ruleCeiling = rule.category === "memory" ? MEMORY_WEIGHT_CEILING : WEIGHT_CEILING;
                    return (
                      <div key={rule.id} style={{
                        marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                        background: colors.bg + "10", border: `1px solid ${colors.border}22`,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>{rule.label}</span>
                          <span style={{ fontSize: 10, color: "#475569" }}>
                            w:{rule.weight.toFixed(2)} · ×{rule.activations}
                          </span>
                        </div>
                        <div style={{ marginBottom: 2 }}>
                          <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>WEIGHT (0–{ruleCeiling})</div>
                          <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{
                              width: `${(rule.weight / ruleCeiling) * 100}%`, height: "100%",
                              background: colors.border, borderRadius: 2, transition: "width 0.3s",
                            }} />
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: "#475569", marginBottom: 2 }}>PLASTICITY</div>
                          <PlasticityBar value={rule.plasticity} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <BatchReportModal
        report={batchReport}
        onClose={() => setBatchReport(null)}
        onDownload={downloadReport}
      />
    </div>
  );
}
