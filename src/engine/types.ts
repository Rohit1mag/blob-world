import type { NeuralNet } from './NeuralNet';

export interface Genes {
  /** Top speed; actual velocity each tick is `maxSpeed × throttle` chosen by the brain. */
  maxSpeed: number;
  size: number;
  senseRadius: number;
}

export type GeneKey = keyof Genes;

export interface GeneRange {
  min: number;
  max: number;
  default: number;
}

export const GENE_RANGES: Record<GeneKey, GeneRange> = {
  maxSpeed: { min: 0.3, max: 3.0, default: 1.0 },
  size: { min: 0.5, max: 2.5, default: 1.0 },
  senseRadius: { min: 20, max: 250, default: 80 },
};

/**
 * Lifecycle within a single day. Movement is entirely brain-driven while `active`;
 * touching the perimeter with at least one food in hand makes a blob `home` (safe).
 */
export type BlobState = 'active' | 'home' | 'starved' | 'eaten';

/** Verdict assigned at end of day; `newborn` marks offspring created during dusk. */
export type DayOutcome = 'pending' | 'died' | 'survived' | 'replicated' | 'newborn';

export interface Blob {
  id: number;
  lineageId: number;
  parentId: number | null;
  generation: number;
  genes: Genes;
  brain: NeuralNet;

  x: number;
  y: number;
  angle: number;
  /** World units moved on the last tick. */
  velocity: number;
  /** Last brain outputs, already mapped: throttle in [0, 1], turn in radians/tick. */
  throttle: number;
  turn: number;
  radius: number;

  energy: number;
  maxEnergy: number;
  foodEaten: number;
  kills: number;
  daysSurvived: number;
  spawnX: number;
  spawnY: number;
  /** Furthest distance from today's spawn point, used for fitness shaping. */
  maxDisplacement: number;
  /** Closest the blob got to the perimeter after eating, used for fitness shaping. */
  closestEdgeFed: number;

  /** What the brain perceived on its last tick (for the inspector overlay). */
  seesFood: boolean;
  foodX: number;
  foodY: number;
  seesThreat: boolean;
  threatX: number;
  threatY: number;
  seesPrey: boolean;
  preyX: number;
  preyY: number;

  state: BlobState;
  outcome: DayOutcome;
  /** Tick on which the blob's state last changed to a terminal state (home/starved/eaten). */
  settledTick: number;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  eaten: boolean;
}

export interface SimulationConfig {
  seed: number;
  arenaSize: number;
  /** Food pellets are spawned at least this far from the perimeter. */
  foodMargin: number;

  foodPerDay: number;
  /** Std-dev of Gaussian mutation, as a fraction of the parent's trait value. */
  mutationRate: number;
  initialPopulation: number;
  /** Std-dev (fractional) of trait variation in the founding population. */
  initialVariance: number;

  /** Probability that each synapse is nudged when a brain is copied (if mutation > 0). */
  brainMutationProb: number;
  /** Brain mutation σ = `mutationRate × brainMutationScale`. */
  brainMutationScale: number;
  maxTurn: number;
  /**
   * If fewer blobs than this survive a day, the gap is refilled with mutated copies of the
   * day's fittest blobs, so a clumsy random Generation 0 can't immediately go extinct.
   */
  minPopulation: number;

  startEnergy: number;
  /** World units travelled per tick at speed = 1.0. */
  baseVelocity: number;
  /** Visual + collision radius at size = 1.0. */
  baseRadius: number;
  cMove: number;
  cSense: number;
  cBase: number;

  predationEnabled: boolean;
  /** Predator must be at least this many times larger than prey. */
  predationRatio: number;
  preyFoodValue: number;
  preyEnergyGain: number;

  maxDayTicks: number;
  duskTicks: number;
  maxPopulation: number;
}

export interface GenerationStats {
  day: number;
  population: number;
  foodPerDay: number;
  avgSpeed: number;
  avgSize: number;
  avgSense: number;
  sdSpeed: number;
  sdSize: number;
  sdSense: number;
  survived: number;
  replicated: number;
  starved: number;
  eaten: number;
  born: number;
  /** Fraction (0–1) of the day's population that made it home with food. */
  homeRate: number;
  /** Mean food eaten per blob that started the day. */
  avgFood: number;
  /** Blobs added by the `minPopulation` floor rather than by replication. */
  backfilled: number;
  dayTicks: number;
}

export type SimPhase = 'day' | 'dusk' | 'extinct';

export interface DayStatus {
  day: number;
  phase: SimPhase;
  tick: number;
  total: number;
  active: number;
  home: number;
  dead: number;
  foodRemaining: number;
  foodTotal: number;
}
