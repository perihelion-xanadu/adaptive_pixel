import { CELL_TYPES, ACTIONS, DIRS, INITIAL_JITTER } from "./constants.js";
import { makeVisitMap, senseNeighbors, getQuadrant } from "./world.js";

export function makeRuleNodes() {
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
    { id: 12, label: "Region NW", condition: null, action: null, region: 0, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 13, label: "Region NE", condition: null, action: null, region: 1, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 14, label: "Region SW", condition: null, action: null, region: 2, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
    { id: 15, label: "Region SE", condition: null, action: null, region: 3, weight: 1.0, plasticity: 1.0, activations: 0, lastFiredStep: 0, category: "memory" },
  ];
}

export function makeGoals() {
  return [
    { id: "safety",  label: "Avoid Hazards", priority: 0.9, plasticity: 1.0, color: "#ef4444" },
    { id: "food",    label: "Find Food",     priority: 0.6, plasticity: 1.0, color: "#22c55e" },
    { id: "explore", label: "Explore",       priority: 0.3, plasticity: 1.0, color: "#3b82f6" },
  ];
}

export function makeStats() {
  return { steps: 0, foodEaten: 0, hazardHits: 0, perturbations: 0, filtered: 0 };
}

export function makeAgent(startPos, config) {
  return {
    pos: startPos,
    rules: makeRuleNodes(),
    goals: makeGoals(),
    stats: makeStats(),
    visitMap: makeVisitMap(config),
    lastDirection: null,
  };
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

export function isStagnating(posHistory, config) {
  if (posHistory.length < config.HISTORY_LEN) return false;
  const recent = posHistory.slice(-config.HISTORY_LEN);
  return new Set(recent.map(([r, c]) => `${r},${c}`)).size < config.UNIQUE_THRESHOLD;
}

export function perturbRules(rules, config) {
  const targetCandidates = rules
    .filter(r => r.category !== "explore" && r.category !== "memory" && r.plasticity > 0.2)
    .sort((a, b) => b.plasticity - a.plasticity);
  const explorePool = rules
    .filter(r => r.category === "explore" && r.plasticity > 0.2)
    .sort((a, b) => b.plasticity - a.plasticity);
  const candidates = targetCandidates.length > 0 ? targetCandidates : explorePool;
  if (candidates.length === 0) return rules;
  const pool = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 2)));
  const target = pool[Math.floor(Math.random() * pool.length)];
  return rules.map(r => {
    if (r.id !== target.id) return r;
    const nudge = (Math.random() * 2 - 1) * config.PERTURB_BOOST * r.plasticity;
    return { ...r, weight: Math.max(config.WEIGHT_FLOOR, Math.min(config.WEIGHT_CEILING, r.weight + nudge)) };
  });
}

export function agentStep(
  grid, agentPos, rules, goals, stats, posHistory,
  visitMap, lastDirection, otherAgentPositions = [],
  pendingFood = [], worldStep = 0, config
) {
  void worldStep;
  const G = config.GRID;
  const HARDENING_BY_CATEGORY = {
    safety:  config.HARDENING_SAFETY,
    food:    config.HARDENING_FOOD,
    explore: 0,
    memory:  0,
  };

  const [r, c] = agentPos;
  // Full-range sense used for rule firing (food/hazard detection at distance).
  // Adjacent-only sense used for the action filter — we only block moves into
  // the *immediately* neighbouring cell; a hazard two tiles away should not
  // prevent the agent from stepping toward it (the adjacent cell is safe).
  const sense = senseNeighbors(grid, r, c, G, config.VIEW_DISTANCE);
  const adjacentSense = config.VIEW_DISTANCE > 1
    ? senseNeighbors(grid, r, c, G, 1)
    : sense;
  const newGrid = grid.map(row => [...row]);
  let newRules = rules.map(rule => ({ ...rule }));
  let newGoals = goals.map(g => ({ ...g }));
  let newStats = { ...stats };
  let newPendingFood = pendingFood;
  let log = null;

  // R1. Plasticity recovery + R8. Explore weight homeostasis
  newRules = newRules.map(rule => {
    let plasticity = rule.plasticity;
    let weight = rule.weight;
    const stepsSinceFire = newStats.steps - (rule.lastFiredStep || 0);
    if (stepsSinceFire > config.RECOVERY_GRACE_STEPS && plasticity < 1.0) {
      plasticity = Math.min(1.0, plasticity + config.PLASTICITY_RECOVERY);
    }
    if (rule.category === "explore") {
      weight += (config.EXPLORE_BASELINE_WEIGHT - weight) * config.EXPLORE_HOMEOSTASIS_RATE;
    }
    return { ...rule, plasticity, weight };
  });

  // R2. Spatial memory decay
  let newVisitMap = visitMap.map(row => row.map(v => v * config.VISIT_DECAY));

  // R7. Memory rule firing + drift
  const currentQuadrant = getQuadrant(r, c, G);
  newRules = newRules.map(rule => {
    if (rule.category !== "memory") return rule;
    const isCurrentRegion = rule.region === currentQuadrant;
    const drift = (1.0 - rule.weight) * config.MEMORY_DRIFT_RATE;
    return {
      ...rule,
      weight: rule.weight + drift,
      activations: isCurrentRegion ? rule.activations + 1 : rule.activations,
      lastFiredStep: isCurrentRegion ? newStats.steps : rule.lastFiredStep,
    };
  });

  // Stagnation perturbation
  if (isStagnating(posHistory, config)) {
    newRules = perturbRules(newRules, config);
    newStats.perturbations = (newStats.perturbations || 0) + 1;
    log = `🔀 Loop detected — perturbing a plastic rule.`;
  }

  // Which rules fire?
  const fired = newRules.filter(rule => evaluateCondition(rule.condition, sense));

  if (fired.length === 0) {
    const action = ACTIONS[Math.floor(Math.random() * 4)];
    const [dr, dc] = DIRS[action];
    const nr = (r + dr + G) % G;
    const nc = (c + dc + G) % G;
    newVisitMap[nr][nc] = Math.min(1.0, newVisitMap[nr][nc] + config.VISIT_INCREMENT);
    return { grid: newGrid, agentPos: [nr, nc], rules: newRules, goals: newGoals, stats: newStats, visitMap: newVisitMap, lastDirection: action, pendingFood: newPendingFood, log: log || "Random walk" };
  }

  // Action filtering — block moves into sensed hazards
  const safeFired = fired.filter(rule => rule.action === "stay" || adjacentSense[rule.action] !== CELL_TYPES.HAZARD);
  const filteredCount = fired.length - safeFired.length;
  newStats.filtered = (newStats.filtered || 0) + filteredCount;

  // R4. Safety reinforcement
  if (filteredCount > 0) {
    newGoals = newGoals.map(g => {
      if (g.id !== "safety") return g;
      const newPriority = Math.min(1.0, g.priority + config.SAFETY_REINFORCEMENT * filteredCount * g.plasticity);
      const newPlasticity = Math.max(0.05, g.plasticity - 0.003 * filteredCount);
      return { ...g, priority: newPriority, plasticity: newPlasticity };
    });
  }

  if (safeFired.length === 0) {
    newStats.steps++;
    newVisitMap[r][c] = Math.min(1.0, newVisitMap[r][c] + config.VISIT_INCREMENT);
    return { grid: newGrid, agentPos: [r, c], rules: newRules, goals: newGoals, stats: newStats, visitMap: newVisitMap, lastDirection, pendingFood: newPendingFood, log: log || "🛑 Surrounded — staying put." };
  }

  // Score safe rules
  const goalMap = Object.fromEntries(newGoals.map(g => [g.id, g.priority]));
  const scored = safeFired.map(rule => {
    let score = rule.weight * (goalMap[rule.category] || 0.1);
    if (rule.category === "explore" && rule.action !== "stay") {
      const [dr, dc] = DIRS[rule.action];
      const destR = (r + dr + G) % G;
      const destC = (c + dc + G) % G;
      const familiarity = newVisitMap[destR][destC];
      score *= (1 - familiarity * config.NOVELTY_BONUS_STRENGTH);
      if (rule.action === lastDirection) score *= config.MOMENTUM_MULTIPLIER;
      const destQuadrant = getQuadrant(destR, destC, G);
      const memoryRule = newRules.find(m => m.category === "memory" && m.region === destQuadrant);
      if (memoryRule) score *= memoryRule.weight;
    }
    return { ...rule, score };
  });

  // Softmax selection
  const maxScore = Math.max(...scored.map(r => r.score));
  const expScores = scored.map(r => Math.exp((r.score - maxScore) / config.TEMPERATURE));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sumExp;
  let chosen = scored[scored.length - 1];
  for (let i = 0; i < scored.length; i++) {
    rand -= expScores[i];
    if (rand <= 0) { chosen = scored[i]; break; }
  }

  // Execute action
  const [dr, dc] = DIRS[chosen.action];
  const nr = (r + dr + G) % G;
  const nc = (c + dc + G) % G;
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
    // Immediate respawn at a random empty cell not under any agent
    const occupied = new Set([`${landed[0]},${landed[1]}`, ...otherAgentPositions.map(p => `${p[0]},${p[1]}`)]);
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 1000) {
      attempts++;
      const fr = Math.floor(Math.random() * G);
      const fc = Math.floor(Math.random() * G);
      if (newGrid[fr][fc] === CELL_TYPES.EMPTY && !occupied.has(`${fr},${fc}`)) {
        newGrid[fr][fc] = CELL_TYPES.FOOD;
        placed = true;
      }
    }
  } else {
    feedback = 0.01;
  }

  newVisitMap[landed[0]][landed[1]] = Math.min(1.0, newVisitMap[landed[0]][landed[1]] + config.VISIT_INCREMENT);

  // R7. Memory credit assignment (shared budget)
  if (destination === CELL_TYPES.FOOD) {
    const memoryRules = newRules.filter(r => r.category === "memory");
    const credited = [];
    const uncredited = [];
    for (const rule of memoryRules) {
      const eligible = rule.activations > 0 && (newStats.steps - rule.lastFiredStep) <= config.MEMORY_CREDIT_WINDOW;
      (eligible ? credited : uncredited).push(rule);
    }
    if (credited.length > 0 && uncredited.length > 0) {
      const growthById = new Map();
      let totalGrowth = 0;
      for (const c of credited) {
        const headroom = config.MEMORY_WEIGHT_CEILING - c.weight;
        const growth = headroom * config.MEMORY_LEARN_RATE;
        growthById.set(c.id, growth);
        totalGrowth += growth;
      }
      const uncreditedTotal = uncredited.reduce((sum, u) => sum + u.weight, 0);
      const shrinkFraction = uncreditedTotal > 0 ? totalGrowth / uncreditedTotal : 0;
      newRules = newRules.map(rule => {
        if (rule.category !== "memory") return rule;
        if (growthById.has(rule.id)) return { ...rule, weight: rule.weight + growthById.get(rule.id) };
        return { ...rule, weight: rule.weight * (1 - shrinkFraction) };
      });
    }
  }

  // R5. Differential hardening + asymmetric learning
  newRules = newRules.map(rule => {
    if (rule.id !== chosen.id) return rule;
    const isPositive = feedback > 0;
    const hardeningRate = isPositive ? HARDENING_BY_CATEGORY[rule.category] : 0;
    const learningRate = rule.category === "explore"
      ? Math.abs(feedback) * 0.15
      : (isPositive ? rule.plasticity * 0.15 : 0.3);
    return {
      ...rule,
      weight:        Math.max(config.WEIGHT_FLOOR, Math.min(config.WEIGHT_CEILING, rule.weight + learningRate * feedback)),
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
