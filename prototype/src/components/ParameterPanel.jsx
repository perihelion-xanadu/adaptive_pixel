import React, { useState } from "react";
import { PARAM_META } from "../simulation/constants.js";

// Group order for display
const GROUP_ORDER = [
  "World", "Timing", "Selection", "Memory",
  "Homeostasis", "Plasticity", "Hardening", "Stagnation", "Safety", "Spatial",
];

const GROUP_COLORS = {
  World:       "#6366f1",
  Timing:      "#94a3b8",
  Selection:   "#3b82f6",
  Memory:      "#f59e0b",
  Homeostasis: "#22c55e",
  Plasticity:  "#a78bfa",
  Hardening:   "#ef4444",
  Stagnation:  "#fb923c",
  Safety:      "#f87171",
  Spatial:     "#38bdf8",
};

function Slider({ paramKey, meta, value, onChange, disabled }) {
  const isChanged = value !== meta.default;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{
          fontSize: 11, color: isChanged ? "#e2e8f0" : "#94a3b8",
          fontFamily: "monospace",
        }}>
          {meta.label}
          {meta.requiresReset && (
            <span style={{ fontSize: 9, color: "#f59e0b", marginLeft: 4 }}>↺ reset</span>
          )}
        </span>
        <span style={{
          fontSize: 11, fontFamily: "monospace",
          color: isChanged ? "#60a5fa" : "#64748b",
          minWidth: 60, textAlign: "right",
        }}>
          {value}
          {isChanged && (
            <button onClick={() => onChange(paramKey, meta.default)} style={{
              marginLeft: 6, fontSize: 9, color: "#475569", background: "none",
              border: "none", cursor: "pointer", padding: 0,
            }} title="Reset to default">↺</button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(paramKey, Number(e.target.value))}
        style={{ width: "100%", accentColor: GROUP_COLORS[meta.group] || "#6366f1" }}
      />
    </div>
  );
}

export default function ParameterPanel({ config, onConfigChange, disabled }) {
  // Group params
  const grouped = {};
  for (const [key, meta] of Object.entries(PARAM_META)) {
    const g = meta.group;
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push([key, meta]);
  }

  const [collapsed, setCollapsed] = useState(() =>
    Object.fromEntries(GROUP_ORDER.map(g => [g, g !== "Selection" && g !== "Memory"]))
  );

  const toggle = g => setCollapsed(prev => ({ ...prev, [g]: !prev[g] }));

  const handleChange = (key, val) => onConfigChange({ ...config, [key]: val });

  const resetAll = () => {
    const fresh = Object.fromEntries(
      Object.entries(PARAM_META).map(([k, m]) => [k, m.default])
    );
    onConfigChange(fresh);
  };

  const hasChanges = Object.entries(PARAM_META).some(([k, m]) => config[k] !== m.default);

  return (
    <div style={{
      background: "#0f172a", borderRadius: 12,
      border: "1px solid #1e293b", padding: 16,
      minWidth: 260,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#475569", textTransform: "uppercase" }}>
          Parameters
        </div>
        {hasChanges && (
          <button onClick={resetAll} disabled={disabled} style={{
            fontSize: 10, color: "#64748b", background: "none", border: "none",
            cursor: disabled ? "not-allowed" : "pointer", fontFamily: "monospace",
          }}>
            Reset all ↺
          </button>
        )}
      </div>

      {GROUP_ORDER.filter(g => grouped[g]).map(g => {
        const color = GROUP_COLORS[g] || "#6366f1";
        const isCollapsed = collapsed[g];
        const groupHasChanges = grouped[g].some(([k, m]) => config[k] !== m.default);
        return (
          <div key={g} style={{ marginBottom: 8 }}>
            <button onClick={() => toggle(g)} style={{
              width: "100%", display: "flex", justifyContent: "space-between",
              alignItems: "center", background: "none", border: "none",
              cursor: "pointer", padding: "4px 0", marginBottom: isCollapsed ? 0 : 8,
            }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color, textTransform: "uppercase", fontWeight: 700 }}>
                {g}
                {groupHasChanges && <span style={{ color: "#60a5fa", marginLeft: 4 }}>·</span>}
              </span>
              <span style={{ fontSize: 10, color: "#475569" }}>{isCollapsed ? "▶" : "▼"}</span>
            </button>
            {!isCollapsed && grouped[g].map(([key, meta]) => (
              <Slider
                key={key}
                paramKey={key}
                meta={meta}
                value={config[key]}
                onChange={handleChange}
                disabled={disabled}
              />
            ))}
          </div>
        );
      })}

      <div style={{ fontSize: 10, color: "#334155", marginTop: 8, lineHeight: 1.5 }}>
        Changes apply on the next tick. Parameters marked ↺ reset require a world reset.
      </div>
    </div>
  );
}
