import { ROLLING_WINDOW } from "../simulation/constants.js";

const W = 552, H = 110;

export default function EfficiencyChart({ history, dual }) {
  if (history.length < 2) {
    return (
      <div style={{
        background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b",
        padding: 12, maxWidth: W + 24, minHeight: H + 20,
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
  const xScale = i => (i / Math.max(history.length - 1, 1)) * W;
  const yScale = v => H - (v / maxY) * H;

  const lines = [
    { pts: history.map((h, i) => `${xScale(i)},${yScale(h.agents[0].cumulative)}`).join(" "), color: "#60a5fa", dash: "4 2" },
    { pts: history.map((h, i) => `${xScale(i)},${yScale(h.agents[0].rolling)}`).join(" "),    color: "#3b82f6", dash: null },
  ];
  if (dual) {
    lines.push({ pts: history.map((h, i) => h.agents[1] ? `${xScale(i)},${yScale(h.agents[1].cumulative)}` : null).filter(Boolean).join(" "), color: "#fcd34d", dash: "4 2" });
    lines.push({ pts: history.map((h, i) => h.agents[1] ? `${xScale(i)},${yScale(h.agents[1].rolling)}` : null).filter(Boolean).join(" "),    color: "#f59e0b", dash: null });
  }

  const latest = history[history.length - 1];
  return (
    <div style={{ background: "#0f172a", borderRadius: 8, border: "1px solid #1e293b", padding: 12, maxWidth: W + 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: 3, color: "#475569", textTransform: "uppercase" }}>
          Efficiency over time
        </span>
        <span style={{ fontSize: 10, color: "#64748b" }}>
          <span style={{ color: "#3b82f6" }}>● A</span>
          {dual && <span style={{ color: "#f59e0b", marginLeft: 8 }}>● B</span>}
          <span style={{ marginLeft: 8, color: "#64748b" }}>
            (solid: rolling-{ROLLING_WINDOW}, dashed: cumulative)
          </span>
        </span>
      </div>
      <svg width={W} height={H} style={{ display: "block" }}>
        {[0.25, 0.5, 0.75, 1.0].map(frac => {
          const y = yScale(maxY * frac);
          return <line key={frac} x1={0} y1={y} x2={W} y2={y} stroke="#1e293b" strokeWidth={1} />;
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
          {dual && latest.agents[1] && (
            <span>  ·  B: cum {(latest.agents[1].cumulative * 100).toFixed(1)}%, roll {(latest.agents[1].rolling * 100).toFixed(1)}%</span>
          )}
        </span>
        <span>step {latest.step}</span>
      </div>
    </div>
  );
}
