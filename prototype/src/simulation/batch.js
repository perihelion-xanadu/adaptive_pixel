import { makeWorld, processRespawns } from "./world.js";
import { makeAgent, agentStep } from "./agent.js";
import { PARAM_META } from "./constants.js";

export async function runSingleSimulation(stepsToRun, dual, config, onProgress) {
  let grid = makeWorld(config);
  const G = config.GRID;
  const numAgents = dual ? 2 : 1;
  const startPositions = [[1, 1], [G - 2, G - 2]];
  const agents = Array.from({ length: numAgents }, (_, i) => makeAgent(startPositions[i], config));
  const posHistory = Array.from({ length: numAgents }, () => []);
  let lastFoodEaten = Array.from({ length: numAgents }, () => 0);
  const learningCurve = [];
  let pendingFood = [];

  for (let s = 0; s < stepsToRun; s++) {
    const respawnResult = processRespawns(grid, pendingFood, s, agents.map(a => a.pos), G);
    grid = respawnResult.grid;
    pendingFood = respawnResult.pendingFood;

    const firstIdx = dual ? (s % 2) : 0;
    const order = dual ? [firstIdx, 1 - firstIdx] : [0];

    for (const idx of order) {
      const agent = agents[idx];
      const others = agents.filter((_, i) => i !== idx).map(a => a.pos);
      posHistory[idx] = [...posHistory[idx], agent.pos].slice(-config.HISTORY_LEN);
      const prevPert = agent.stats.perturbations;
      const result = agentStep(
        grid, agent.pos, agent.rules, agent.goals, agent.stats,
        posHistory[idx], agent.visitMap, agent.lastDirection, others,
        pendingFood, s, config
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
          foodEaten:      a.stats.foodEaten,
          hazardHits:     a.stats.hazardHits,
          perturbations:  a.stats.perturbations,
          cumulativeEff:  a.stats.foodEaten / (s + 1),
          rollingEff:     (a.stats.foodEaten - lastFoodEaten[i]) / 1000,
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

export async function runBatch(numRuns, stepsPerRun, dual, config, onProgress) {
  const results = [];
  for (let i = 0; i < numRuns; i++) {
    const result = await runSingleSimulation(stepsPerRun, dual, config, (step) => {
      onProgress({ runIndex: i, runStep: step, totalRuns: numRuns, totalSteps: stepsPerRun });
    });
    results.push(result);
  }
  return results;
}

// ── Report helpers ────────────────────────────────────────────
function pad(s, n, right = false) {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  return right ? s + " ".repeat(n - s.length) : " ".repeat(n - s.length) + s;
}
function padR(s, n) { return pad(s, n, true); }
function pct(v)    { return (v * 100).toFixed(2) + " %"; }
function avg(arr)  { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function fmt(v, d = 2) { return Number(v).toFixed(d); }

export function generateReport(results, stepsPerRun, config) {
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

  // ── 0. Configuration ──
  lines.push(SEP_BIG);
  lines.push("0. CONFIGURATION USED FOR THIS BATCH");
  lines.push(SEP_BIG);
  if (config) {
    // Group params by their group label, same order as the UI panel
    const groupOrder = [
      "World", "Timing", "Selection", "Memory",
      "Homeostasis", "Plasticity", "Hardening", "Stagnation", "Safety", "Spatial",
    ];
    const grouped = {};
    for (const [key, meta] of Object.entries(PARAM_META)) {
      if (!grouped[meta.group]) grouped[meta.group] = [];
      grouped[meta.group].push([key, meta]);
    }
    let anyChanged = false;
    for (const group of groupOrder) {
      if (!grouped[group]) continue;
      lines.push(`  [${group.toUpperCase()}]`);
      for (const [key, meta] of grouped[group]) {
        const val = config[key] !== undefined ? config[key] : meta.default;
        const changed = val !== meta.default;
        if (changed) anyChanged = true;
        const marker = changed ? "* " : "  ";
        lines.push(`  ${marker}${padR(meta.label, 30)} ${val}${changed ? `  (default: ${meta.default})` : ""}`);
      }
      lines.push("");
    }
    if (!anyChanged) {
      lines.push("  All parameters are at their default values.");
      lines.push("");
    }
    lines.push("  (* = changed from default)");
  } else {
    lines.push("  Configuration not recorded (defaults assumed).");
  }
  lines.push("");

  lines.push(SEP_BIG);
  lines.push("1. EXECUTIVE SUMMARY");
  lines.push(SEP_BIG);
  for (let a = 0; a < numAgents; a++) {
    const tag = dual ? `[Agent ${a === 0 ? "A" : "B"}]` : "";
    lines.push("");
    if (dual) lines.push(tag);
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
      const w  = avg(results.map(r => r.agents[a].rules[i].weight));
      const p  = avg(results.map(r => r.agents[a].rules[i].plasticity));
      const ac = avg(results.map(r => r.agents[a].rules[i].activations));
      lines.push(`${padR(label, 22)} | ${padR(cat, 8)} | ${padR(fmt(w, 3), 10)} | ${padR(pct(p), 14)} | ${fmt(ac, 1)}`);
    }
  }
  lines.push("");

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
