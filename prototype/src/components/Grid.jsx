import { CELL_TYPES, AGENT_COLORS } from "../simulation/constants.js";

const CELL_PX = 46;

export default function Grid({ grid, agents, dualMode, showVisitMap }) {
  const G = grid.length;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${G}, ${CELL_PX}px)`,
      gap: 2,
      background: "#0f172a",
      padding: 12,
      borderRadius: 12,
      border: "1px solid #1e293b",
    }}>
      {grid.map((row, r) =>
        row.map((cell, c) => {
          const isAgent0 = r === agents[0].pos[0] && c === agents[0].pos[1];
          const isAgent1 = dualMode && r === agents[1].pos[0] && c === agents[1].pos[1];
          const v0 = showVisitMap ? agents[0].visitMap[r][c] : 0;
          const v1 = showVisitMap && dualMode ? agents[1].visitMap[r][c] : 0;

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
          if (isAgent0 && isAgent1) cellBg = "#a855f7";
          else if (isAgent0)        cellBg = AGENT_COLORS[0].primary;
          else if (isAgent1)        cellBg = AGENT_COLORS[1].primary;

          const border = isAgent0 && isAgent1 ? "2px solid #d8b4fe"
            : isAgent0 ? `2px solid ${AGENT_COLORS[0].primary}`
            : isAgent1 ? `2px solid ${AGENT_COLORS[1].primary}`
            : cell === CELL_TYPES.HAZARD ? "1px solid #dc2626"
            : cell === CELL_TYPES.FOOD   ? "1px solid #22c55e"
            : "1px solid #1e293b";

          const shadow = isAgent0 && isAgent1 ? "0 0 12px #a855f7aa"
            : isAgent0 ? `0 0 12px ${AGENT_COLORS[0].glow}`
            : isAgent1 ? `0 0 12px ${AGENT_COLORS[1].glow}`
            : "none";

          const symbol = isAgent0 && isAgent1 ? "◇"
            : isAgent0 ? AGENT_COLORS[0].symbol
            : isAgent1 ? AGENT_COLORS[1].symbol
            : cell === CELL_TYPES.FOOD    ? "●"
            : cell === CELL_TYPES.HAZARD  ? "✕"
            : "";

          return (
            <div key={`${r}-${c}`} style={{
              width: CELL_PX, height: CELL_PX, borderRadius: 6,
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
  );
}
