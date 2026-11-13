export interface Genes {
  speed: number;
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
  speed: { min: 0.3, max: 3.0, default: 1.0 },
  size: { min: 0.5, max: 2.5, default: 1.0 },
  senseRadius: { min: 20, max: 250, default: 80 },
};

/** Lifecycle of a blob within a single day. */
export type BlobState = 'foraging' | 'returning' | 'home' | 'starved' | 'eaten';

/** What the steering system is currently doing; used for rendering the target line. */
export type SteerMode = 'wander' | 'food' | 'hunt' | 'flee' | 'home' | 'idle';

/** Verdict assigned at end of day; `newborn` marks offspring created during dusk. */
export type DayOutcome = 'pending' | 'died' | 'survived' | 'replicated' | 'newborn';

export interface Blob {
  id: number;
  lineageId: number;
  parentId: number | null;
  generation: number;
  genes: Genes;

  x: number;
  y: number;
  heading: number;
  radius: number;

  energy: number;
  maxEnergy: number;
  /** Energy spent per tick, derived from genes once per day. */
  drain: number;
  foodEaten: number;
  kills: number;
  daysSurvived: number;

  state: BlobState;
  mode: SteerMode;
  targetX: number;
  targetY: number;
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
