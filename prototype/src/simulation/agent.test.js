import { describe, it, expect } from "vitest";
import { makeAgent, makeRuleNodes, isStagnating, agentStep } from "./agent.js";
import { defaultConfig } from "./constants.js";
import { makeWorld } from "./world.js";

describe("Agent Simulation Mechanics", () => {
  const config = defaultConfig();

  it("should initialize rule nodes with 16 default rules", () => {
    const rules = makeRuleNodes();
    expect(rules).toHaveLength(16);
    expect(rules.filter(r => r.category === "safety")).toHaveLength(4);
    expect(rules.filter(r => r.category === "food")).toHaveLength(4);
    expect(rules.filter(r => r.category === "explore")).toHaveLength(4);
    expect(rules.filter(r => r.category === "memory")).toHaveLength(4);
  });

  it("should construct a valid agent object", () => {
    const agent = makeAgent([3, 4], config);
    expect(agent.pos).toEqual([3, 4]);
    expect(agent.rules).toHaveLength(16);
    expect(agent.goals).toHaveLength(3);
    expect(agent.stats.steps).toBe(0);
    expect(agent.visitMap).toHaveLength(config.GRID);
    expect(agent.visitMap[0]).toHaveLength(config.GRID);
  });

  it("should correctly identify stagnation", () => {
    const stagnantHistory = [
      [1, 1], [1, 2], [1, 1], [1, 2], [1, 1], [1, 2],
      [1, 1], [1, 2], [1, 1], [1, 2], [1, 1], [1, 2]
    ];
    const nonStagnantHistory = [
      [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
      [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], [1, 12]
    ];

    expect(isStagnating(stagnantHistory, config)).toBe(true);
    expect(isStagnating(nonStagnantHistory, config)).toBe(false);
  });

  it("should step the agent and update visit map and stats", () => {
    const grid = makeWorld(config);
    const agent = makeAgent([5, 5], config);
    const posHistory = [[5, 5]];

    const result = agentStep(
      grid,
      agent.pos,
      agent.rules,
      agent.goals,
      agent.stats,
      posHistory,
      agent.visitMap,
      agent.lastDirection,
      [], // otherAgentPositions
      [], // pendingFood
      0,  // worldStep
      config
    );

    expect(result.stats.steps).toBe(1);
    expect(result.agentPos).toHaveLength(2);
    // Grid coordinate should be valid and within bounds
    expect(result.agentPos[0]).toBeGreaterThanOrEqual(0);
    expect(result.agentPos[0]).toBeLessThan(config.GRID);
    expect(result.agentPos[1]).toBeGreaterThanOrEqual(0);
    expect(result.agentPos[1]).toBeLessThan(config.GRID);

    // Recency-weighted spatial trace at the landed position should be reinforced
    const [nr, nc] = result.agentPos;
    expect(result.visitMap[nr][nc]).toBeGreaterThan(0);
  });
});
