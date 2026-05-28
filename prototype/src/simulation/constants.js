// Each entry: { default, min, max, step, label, group, requiresReset? }
// requiresReset: true means the param can't be changed mid-run without resetting.
export const PARAM_META = {
  // ── World (require reset) ──────────────────────────────────
  GRID: {
    default: 12, min: 8, max: 24, step: 2,
    label: "Grid size", group: "World", requiresReset: true,
  },
  INITIAL_FOOD: {
    default: 10, min: 3, max: 30, step: 1,
    label: "Initial food", group: "World", requiresReset: true,
  },
  INITIAL_HAZARDS: {
    default: 8, min: 0, max: 20, step: 1,
    label: "Initial hazards", group: "World", requiresReset: true,
  },
  VIEW_DISTANCE: {
    default: 1, min: 1, max: 6, step: 1,
    label: "View distance (tiles)", group: "World",
  },

  // ── Timing (live) ─────────────────────────────────────────
  TICK_MS: {
    default: 300, min: 50, max: 1000, step: 50,
    label: "Tick speed (ms)", group: "Timing",
  },

  // ── Stagnation (live) ─────────────────────────────────────
  HISTORY_LEN: {
    default: 12, min: 5, max: 30, step: 1,
    label: "History window", group: "Stagnation",
  },
  UNIQUE_THRESHOLD: {
    default: 5, min: 2, max: 15, step: 1,
    label: "Unique-cell threshold", group: "Stagnation",
  },
  PERTURB_BOOST: {
    default: 0.4, min: 0.05, max: 1.0, step: 0.05,
    label: "Perturbation boost", group: "Stagnation",
  },

  // ── Selection (live) ──────────────────────────────────────
  TEMPERATURE: {
    default: 0.12, min: 0.05, max: 0.5, step: 0.01,
    label: "Softmax temperature", group: "Selection",
  },
  MOMENTUM_MULTIPLIER: {
    default: 4.0, min: 1.0, max: 8.0, step: 0.5,
    label: "Momentum multiplier", group: "Selection",
  },
  NOVELTY_BONUS_STRENGTH: {
    default: 0.6, min: 0.0, max: 1.0, step: 0.05,
    label: "Novelty bonus strength", group: "Selection",
  },

  // ── Plasticity (live) ─────────────────────────────────────
  PLASTICITY_RECOVERY: {
    default: 0.0025, min: 0.0005, max: 0.01, step: 0.0005,
    label: "Plasticity recovery rate", group: "Plasticity",
  },
  RECOVERY_GRACE_STEPS: {
    default: 80, min: 10, max: 200, step: 10,
    label: "Recovery grace (steps)", group: "Plasticity",
  },
  WEIGHT_CEILING: {
    default: 1.5, min: 1.0, max: 3.0, step: 0.1,
    label: "Weight ceiling", group: "Plasticity",
  },
  WEIGHT_FLOOR: {
    default: 0.05, min: 0.01, max: 0.2, step: 0.01,
    label: "Weight floor", group: "Plasticity",
  },

  // ── Memory (live) ─────────────────────────────────────────
  MEMORY_LEARN_RATE: {
    default: 0.08, min: 0.01, max: 0.2, step: 0.01,
    label: "Memory learn rate", group: "Memory",
  },
  MEMORY_WEIGHT_CEILING: {
    default: 2.0, min: 1.2, max: 3.0, step: 0.1,
    label: "Memory weight ceiling", group: "Memory",
  },
  MEMORY_DRIFT_RATE: {
    default: 0.0002, min: 0.0, max: 0.001, step: 0.0001,
    label: "Memory drift rate", group: "Memory",
  },
  MEMORY_CREDIT_WINDOW: {
    default: 8, min: 3, max: 20, step: 1,
    label: "Credit window (steps)", group: "Memory",
  },

  // ── Explore homeostasis (live) ────────────────────────────
  EXPLORE_HOMEOSTASIS_RATE: {
    default: 0.0005, min: 0.0, max: 0.002, step: 0.0001,
    label: "Homeostasis rate", group: "Homeostasis",
  },
  EXPLORE_BASELINE_WEIGHT: {
    default: 0.2, min: 0.1, max: 0.5, step: 0.05,
    label: "Explore baseline weight", group: "Homeostasis",
  },

  // ── Safety (live) ─────────────────────────────────────────
  SAFETY_REINFORCEMENT: {
    default: 0.015, min: 0.0, max: 0.1, step: 0.005,
    label: "Safety reinforcement", group: "Safety",
  },

  // ── Spatial memory (live) ─────────────────────────────────
  VISIT_DECAY: {
    default: 0.996, min: 0.97, max: 1.0, step: 0.001,
    label: "Visit map decay", group: "Spatial",
  },
  VISIT_INCREMENT: {
    default: 0.5, min: 0.1, max: 1.0, step: 0.05,
    label: "Visit increment", group: "Spatial",
  },

  // ── Hardening by category (live) ──────────────────────────
  HARDENING_SAFETY: {
    default: 0.035, min: 0.0, max: 0.1, step: 0.005,
    label: "Safety hardening/fire", group: "Hardening",
  },
  HARDENING_FOOD: {
    default: 0.04, min: 0.0, max: 0.1, step: 0.005,
    label: "Food hardening/fire", group: "Hardening",
  },
};

export function defaultConfig() {
  return Object.fromEntries(
    Object.entries(PARAM_META).map(([k, v]) => [k, v.default])
  );
}

// Non-tunable constants (display, chart, etc.)
export const CHART_MAX_SAMPLES = 300;
export const ROLLING_WINDOW = 30;
export const INITIAL_JITTER = 0.03;
export const CELL_TYPES = { EMPTY: 0, FOOD: 1, HAZARD: 2 };
export const ACTIONS = ["north", "south", "east", "west", "stay"];
export const DIRS = { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1], stay: [0, 0] };
export const MEMORY_REGIONS = 4;

export const CATEGORY_COLORS = {
  safety:  { bg: "#fef2f2", border: "#ef4444", text: "#991b1b" },
  food:    { bg: "#f0fdf4", border: "#22c55e", text: "#14532d" },
  explore: { bg: "#eff6ff", border: "#3b82f6", text: "#1e3a8a" },
  memory:  { bg: "#fef3c7", border: "#f59e0b", text: "#78350f" },
};

export const AGENT_COLORS = [
  { primary: "#3b82f6", glow: "#3b82f6aa", symbol: "◈", tintR: 59,  tintG: 130, tintB: 246 },
  { primary: "#f59e0b", glow: "#f59e0baa", symbol: "◆", tintR: 245, tintG: 158, tintB: 11  },
];
