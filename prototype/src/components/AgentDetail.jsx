import { CATEGORY_COLORS, AGENT_COLORS } from "../simulation/constants.js";

function PlasticityBar({ value }) {
  const p = Math.round(value * 100);
  const color = value > 0.6 ? "#22c55e" : value > 0.3 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ fontSize: 10, color: "#64748b", minWidth: 28, textAlign: "right" }}>{p}%</span>
    </div>
  );
}

function GoalBar({ goal }) {
  const p = Math.round(goal.priority * 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>{goal.label}</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>plasticity {Math.round(goal.plasticity * 100)}%</span>
      </div>
      <div style={{ height: 10, background: "#1e293b", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: goal.color, borderRadius: 5, transition: "width 0.4s" }} />
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: "#64748b", marginTop: 2 }}>{p}/100</div>
    </div>
  );
}

export default function AgentDetail({ agents, dualMode, activeTab, onTabChange, config }) {
  const agent = agents[activeTab] || agents[0];
  const rulesByCategory = agent.rules.reduce((acc, r) => {
    (acc[r.category] = acc[r.category] || []).push(r);
    return acc;
  }, {});

  const HARDENING_BY_CATEGORY = {
    safety:  config.HARDENING_SAFETY,
    food:    config.HARDENING_FOOD,
    explore: 0,
    memory:  0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tab selector — dual mode only */}
      {dualMode && (
        <div style={{ display: "flex", gap: 4, padding: 4, background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
          {[0, 1].map(idx => (
            <button key={idx} onClick={() => onTabChange(idx)} style={{
              flex: 1, padding: "8px 12px", borderRadius: 6, border: "none", cursor: "pointer",
              background: activeTab === idx ? AGENT_COLORS[idx].primary + "44" : "transparent",
              color: activeTab === idx ? AGENT_COLORS[idx].primary : "#64748b",
              fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: 1,
            }}>
              {AGENT_COLORS[idx].symbol} Agent {idx === 0 ? "A" : "B"}
            </button>
          ))}
        </div>
      )}

      {/* Goals */}
      <div style={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b", padding: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
          {dualMode ? `Agent ${activeTab === 0 ? "A" : "B"} ` : ""}Goal Structure
        </div>
        {agent.goals.map(goal => <GoalBar key={goal.id} goal={goal} />)}
      </div>

      {/* Rules */}
      <div style={{ background: "#0f172a", borderRadius: 12, border: "1px solid #1e293b", padding: 16 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 12, textTransform: "uppercase" }}>
          {dualMode ? `Agent ${activeTab === 0 ? "A" : "B"} ` : ""}Rule Nodes
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
                const ruleCeiling = rule.category === "memory" ? config.MEMORY_WEIGHT_CEILING : config.WEIGHT_CEILING;
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
  );
}
