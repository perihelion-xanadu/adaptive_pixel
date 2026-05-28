export default function BatchPanel({
  dualMode, batchRunning, batchProgress, batchReport,
  batchNumRuns, batchStepsPerRun,
  onNumRunsChange, onStepsChange, onStart, onViewReport,
}) {
  return (
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
              <select value={batchNumRuns} onChange={e => onNumRunsChange(+e.target.value)}
                style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
                  padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}>
                {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 4 }}>
              Steps per run
              <select value={batchStepsPerRun} onChange={e => onStepsChange(+e.target.value)}
                style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
                  padding: "4px 8px", borderRadius: 4, fontFamily: "monospace", fontSize: 12 }}>
                {[1000, 3000, 5000, 10000, 25000, 50000].map(n =>
                  <option key={n} value={n}>{n.toLocaleString()}</option>
                )}
              </select>
            </label>
          </div>
          <button onClick={onStart} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
            background: "#4f46e5", color: "#e0e7ff",
            fontFamily: "monospace", fontWeight: 700, fontSize: 13, letterSpacing: 1, width: "100%",
          }}>
            ▶ RUN BATCH ({batchNumRuns} × {batchStepsPerRun.toLocaleString()})
          </button>
          {batchReport && (
            <button onClick={onViewReport} style={{
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
  );
}

export function BatchReportModal({ report, onClose, onDownload }) {
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
          <div style={{ fontSize: 11, letterSpacing: 3, color: "#94a3b8", textTransform: "uppercase" }}>
            Batch Run Report
          </div>
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
