import { useState, useEffect, useRef, useCallback } from "react";
import { defaultConfig, CHART_MAX_SAMPLES, ROLLING_WINDOW, AGENT_COLORS, PARAM_META } from "./simulation/constants.js";
import { makeWorld, processRespawns } from "./simulation/world.js";
import { makeAgent, agentStep } from "./simulation/agent.js";
import { runBatch, generateReport } from "./simulation/batch.js";
import Grid from "./components/Grid.jsx";
import EfficiencyChart from "./components/EfficiencyChart.jsx";
import AgentDetail from "./components/AgentDetail.jsx";
import BatchPanel, { BatchReportModal } from "./components/BatchPanel.jsx";
import ParameterPanel from "./components/ParameterPanel.jsx";

function agentStartPositions(config) {
  return [[1, 1], [config.GRID - 2, config.GRID - 2]];
}

export default function App() {
  const [config, setConfig] = useState(defaultConfig);
  const [dualMode, setDualMode] = useState(false);
  const [grid, setGrid] = useState(() => makeWorld(defaultConfig()));
  const [agents, setAgents] = useState(() => agentStartPositions(defaultConfig()).map(p => makeAgent(p, defaultConfig())));
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [generation, setGeneration] = useState(1);
  const [efficiencyHistory, setEfficiencyHistory] = useState([]);
  const [activeAgentTab, setActiveAgentTab] = useState(0);
  const [showVisitMap, setShowVisitMap] = useState(true);

  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [batchReport, setBatchReport] = useState(null);
  const [batchNumRuns, setBatchNumRuns] = useState(5);
  const [batchStepsPerRun, setBatchStepsPerRun] = useState(10000);
  const [showReportModal, setShowReportModal] = useState(false);

  const agentRuntimeRefs = useRef([
    { posHistory: [], foodEvents: [] },
    { posHistory: [], foodEvents: [] },
  ]);
  const intervalRef = useRef(null);
  const pendingFoodRef = useRef([]);
  const stateRef = useRef({ grid, agents, dualMode, config });

  useEffect(() => { stateRef.current = { grid, agents, dualMode, config }; }, [grid, agents, dualMode, config]);

  const step = useCallback(() => {
    const s = stateRef.current;
    let curGrid = s.grid;
    let curPending = pendingFoodRef.current;
    const newAgents = [...s.agents];
    const newLogEntries = [];
    const worldStep = newAgents[0].stats.steps;
    const cfg = s.config;

    const respawnResult = processRespawns(curGrid, curPending, worldStep,
      (s.dualMode ? newAgents : [newAgents[0]]).map(a => a.pos), cfg.GRID);
    curGrid = respawnResult.grid;
    curPending = respawnResult.pendingFood;

    const firstIdx = s.dualMode ? (worldStep % 2) : 0;
    const activeIndices = s.dualMode ? [firstIdx, 1 - firstIdx] : [0];

    for (const idx of activeIndices) {
      const agent = newAgents[idx];
      const rt = agentRuntimeRefs.current[idx];
      const others = activeIndices.filter(i => i !== idx).map(i => newAgents[i].pos);

      rt.posHistory = [...rt.posHistory, agent.pos].slice(-cfg.HISTORY_LEN);
      const prevPert = agent.stats.perturbations;
      const result = agentStep(
        curGrid, agent.pos, agent.rules, agent.goals, agent.stats,
        rt.posHistory, agent.visitMap, agent.lastDirection, others,
        curPending, worldStep, cfg
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
      intervalRef.current = setInterval(step, config.TICK_MS);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running, config.TICK_MS, step, batchRunning]);

  const doReset = useCallback((newDualMode, newConfig) => {
    const dm = newDualMode !== undefined ? newDualMode : dualMode;
    const cfg = newConfig !== undefined ? newConfig : config;
    setRunning(false);
    agentRuntimeRefs.current = [
      { posHistory: [], foodEvents: [] },
      { posHistory: [], foodEvents: [] },
    ];
    pendingFoodRef.current = [];
    setGrid(makeWorld(cfg));
    setAgents(agentStartPositions(cfg).map(p => makeAgent(p, cfg)));
    setLog([]);
    setEfficiencyHistory([]);
    setGeneration(g => g + 1);
    setDualMode(dm);
    setActiveAgentTab(0);
  }, [dualMode, config]);

  const handleConfigChange = (newConfig) => {
    const needsReset = Object.entries(PARAM_META)
      .filter(([, m]) => m.requiresReset)
      .some(([k]) => newConfig[k] !== config[k]);
    setConfig(newConfig);
    if (needsReset) doReset(dualMode, newConfig);
  };

  const startBatch = async () => {
    setRunning(false);
    setBatchRunning(true);
    setBatchReport(null);
    setBatchProgress({ runIndex: 0, runStep: 0, totalRuns: batchNumRuns, totalSteps: batchStepsPerRun });
    try {
      const results = await runBatch(batchNumRuns, batchStepsPerRun, dualMode, config, setBatchProgress);
      setBatchReport(generateReport(results, batchStepsPerRun, config));
      setShowReportModal(true);
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
    a.download = `adaptive-mind-batch-${dualMode ? "dual" : "single"}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
          v5 · plasticity recovery · spatial memory · differential hardening · safety reinforcement ·
          directional momentum · shared-budget regional memory ·{" "}
          {dualMode ? "two competing agents sharing a world" : "single agent baseline"}
        </p>
      </div>

      {/* THREE-COLUMN LAYOUT */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>

        {/* LEFT: Grid + controls + chart + log */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Grid grid={grid} agents={agents} dualMode={dualMode} showVisitMap={showVisitMap} />

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
              cursor: (running || batchRunning) ? "not-allowed" : "pointer",
              background: "transparent", color: "#94a3b8", fontFamily: "monospace", fontSize: 13,
              opacity: (running || batchRunning) ? 0.5 : 1,
            }}>▷ STEP</button>
            <button onClick={() => doReset()} disabled={batchRunning} style={{
              padding: "8px 16px", borderRadius: 8, border: "1px solid #334155",
              cursor: batchRunning ? "not-allowed" : "pointer",
              background: "transparent", color: "#94a3b8", fontFamily: "monospace", fontSize: 13,
              opacity: batchRunning ? 0.5 : 1,
            }}>↺ RESET</button>
            <label style={{
              fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6,
              padding: "6px 10px", border: "1px solid #334155", borderRadius: 6,
              cursor: batchRunning ? "not-allowed" : "pointer",
              opacity: batchRunning ? 0.5 : 1,
              background: dualMode ? "#1e3a8a22" : "transparent",
            }}>
              <input type="checkbox" checked={dualMode} disabled={batchRunning}
                onChange={e => doReset(e.target.checked)} />
              Dual-Agent
            </label>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={showVisitMap}
                onChange={e => setShowVisitMap(e.target.checked)} />
              Visit map
            </label>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {(dualMode ? [0, 1] : [0]).map(idx => {
              const ag = agents[idx];
              const tag = dualMode ? (idx === 0 ? "Agent A" : "Agent B") : "Stats";
              const color = AGENT_COLORS[idx].primary;
              return (
                <div key={idx} style={{
                  flex: 1, minWidth: 260,
                  background: "#0f172a", padding: "10px 16px", borderRadius: 8,
                  border: `1px solid ${dualMode ? color + "44" : "#1e293b"}`,
                }}>
                  <div style={{ fontSize: 10, color, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>{tag}</div>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {[
                      ["Steps",    ag.stats.steps,            "#f1f5f9"],
                      ["Food",     ag.stats.foodEaten,         "#22c55e"],
                      ["Hazards",  ag.stats.hazardHits,        "#ef4444"],
                      ["Perturbs", ag.stats.perturbations,     "#a78bfa"],
                      ["Filtered", ag.stats.filtered || 0,     "#60a5fa"],
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

          <EfficiencyChart history={efficiencyHistory} dual={dualMode} />

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#64748b", flexWrap: "wrap" }}>
            <span><span style={{ color: AGENT_COLORS[0].primary }}>◈</span> Agent A</span>
            {dualMode && <span><span style={{ color: AGENT_COLORS[1].primary }}>◆</span> Agent B</span>}
            {dualMode && <span><span style={{ color: "#a855f7" }}>◇</span> Both</span>}
            <span><span style={{ color: "#22c55e" }}>●</span> Food</span>
            <span><span style={{ color: "#ef4444" }}>✕</span> Hazard</span>
          </div>

          {/* Event log */}
          <div style={{
            background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b",
            padding: 12, minHeight: 100, maxWidth: `${config.GRID * 48}px`,
          }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", marginBottom: 8, textTransform: "uppercase" }}>Event Log</div>
            {log.length === 0
              ? <div style={{ color: "#334155", fontSize: 12, fontStyle: "italic" }}>Awaiting first step…</div>
              : log.map((entry, i) => (
                <div key={i} style={{
                  fontSize: 12,
                  color: i === 0 ? (entry.includes("🔀") ? "#a78bfa" : "#e2e8f0") : "#475569",
                  marginBottom: 3,
                }}>{entry}</div>
              ))}
          </div>
        </div>

        {/* MIDDLE: Batch + Agent detail */}
        <div style={{ flex: 1, minWidth: 300, display: "flex", flexDirection: "column", gap: 16 }}>
          <BatchPanel
            dualMode={dualMode}
            batchRunning={batchRunning}
            batchProgress={batchProgress}
            batchReport={batchReport}
            batchNumRuns={batchNumRuns}
            batchStepsPerRun={batchStepsPerRun}
            onNumRunsChange={setBatchNumRuns}
            onStepsChange={setBatchStepsPerRun}
            onStart={startBatch}
            onViewReport={() => setShowReportModal(true)}
          />
          <AgentDetail
            agents={agents}
            dualMode={dualMode}
            activeTab={activeAgentTab}
            onTabChange={setActiveAgentTab}
            config={config}
          />
        </div>

        {/* RIGHT: Parameter panel */}
        <ParameterPanel
          config={config}
          onConfigChange={handleConfigChange}
          disabled={batchRunning}
        />
      </div>

      <BatchReportModal
        report={showReportModal ? batchReport : null}
        onClose={() => setShowReportModal(false)}
        onDownload={downloadReport}
      />
    </div>
  );
}
