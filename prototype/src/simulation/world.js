import { CELL_TYPES, DIRS } from "./constants.js";

export function makeWorld(config) {
  const G = config.GRID;
  const grid = Array.from({ length: G }, () => Array(G).fill(CELL_TYPES.EMPTY));
  const place = (type, n) => {
    let placed = 0;
    while (placed < n) {
      const r = Math.floor(Math.random() * G);
      const c = Math.floor(Math.random() * G);
      if (grid[r][c] === CELL_TYPES.EMPTY && !(r === 1 && c === 1) && !(r === G - 2 && c === G - 2)) {
        grid[r][c] = type;
        placed++;
      }
    }
  };
  place(CELL_TYPES.FOOD, config.INITIAL_FOOD);
  place(CELL_TYPES.HAZARD, config.INITIAL_HAZARDS);
  return grid;
}

export function makeVisitMap(config) {
  const G = config.GRID;
  return Array.from({ length: G }, () => Array(G).fill(0));
}

// Scan up to `viewDistance` tiles in each cardinal direction.
// Returns the type of the NEAREST non-empty cell found, or EMPTY if the
// entire corridor is clear. Nearer cells therefore occlude farther ones —
// a hazard at distance 1 hides food at distance 2, just as a wall would.
export function senseNeighbors(grid, r, c, G, viewDistance = 1) {
  const sense = {};
  for (const [dir, [dr, dc]] of Object.entries(DIRS)) {
    if (dir === "stay") { sense[dir] = CELL_TYPES.EMPTY; continue; }
    sense[dir] = CELL_TYPES.EMPTY;
    for (let d = 1; d <= viewDistance; d++) {
      const nr = (r + dr * d + G) % G;
      const nc = (c + dc * d + G) % G;
      const cell = grid[nr][nc];
      if (cell !== CELL_TYPES.EMPTY) {
        sense[dir] = cell;
        break; // nearest non-empty wins; farther tiles are occluded
      }
    }
  }
  return sense;
}

export function getQuadrant(r, c, G) {
  const half = G / 2;
  return (r < half ? 0 : 2) + (c < half ? 0 : 1);
}

export function processRespawns(grid, pendingFood, worldStep, agentPositions, G) {
  if (pendingFood.length === 0) return { grid, pendingFood };
  let newGrid = null;
  const stillPending = [];
  const occupied = new Set(agentPositions.map(p => `${p[0]},${p[1]}`));
  for (const pf of pendingFood) {
    if (worldStep < pf.respawnAt) { stillPending.push(pf); continue; }
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 200) {
      attempts++;
      const fr = Math.floor(Math.random() * G);
      const fc = Math.floor(Math.random() * G);
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
