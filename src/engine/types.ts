import type { NeuralNet } from './NeuralNet';

export interface Genes {
  /** Top speed; actual velocity each tick is `maxSpeed × throttle` chosen by the brain. */
  maxSpeed: number;
  size: number;
  senseRadius: number;
  intelligence: number;
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
  intelligence: { min: 0.4, max: 2.5, default: 1.0 },
};

export type ResourceType = 'food' | 'timber' | 'stone';
export const RESOURCE_TYPES: ResourceType[] = ['food', 'timber', 'stone'];

export interface Stockpile {
  food: number;
  timber: number;
  stone: number;
}

export interface Cargo {
  type: ResourceType | null;
  amount: number;
}

/** A harvestable node: berry bush (food), tree (timber) or quarry (stone). Persists across days. */
export interface ResourceNode {
  id: number;
  type: ResourceType;
  x: number;
  y: number;
  amount: number;
  max: number;
  /** Capacity at creation; bushes left alone grow lusher than this, picked ones drift back. */
  baseMax: number;
  lastHarvestDay: number;
  radius: number;
  /** True for fish shoals in rivers/lakes (food nodes that regrow year-round). */
  isFish?: boolean;
  /** If set (e.g. a planted farm plot), only blobs of this realm can harvest it. */
  ownerRealmId?: number;
  /** Structure id of the farm that owns this plot, if any. */
  farmStructureId?: number;
}

export interface RiverSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export interface Lake {
  x: number;
  y: number;
  radius: number;
}

export type StructureType =
  | 'townCenter'
  | 'granary'
  | 'shelter'
  | 'barricade'
  | 'farm'
  | 'workshop'
  | 'market'
  | 'dock'
  | 'bridge'
  | 'watchtower'
  | 'monument'
  | 'palace'
  | 'factory'
  | 'powerPlant'
  | 'lab'
  | 'hospital'
  | 'skyscraper';

export type SettlementTier = 'camp' | 'village' | 'town' | 'city' | 'metropolis';
export type DiplomaticStance = 'neutral' | 'trade' | 'alliance' | 'war';

export interface RealmRelation {
  a: number;
  b: number;
  stance: DiplomaticStance;
  lastRaidDay: number;
  sinceDay: number;
}

export interface Road {
  id: number;
  realmId: number;
  fromTribeId: number;
  toTribeId: number;
  built: boolean;
  progress: number;
  buildTicks: number;
  /** Upgrades from cobblestone road to paved asphalt highway in modern towns/cities. */
  paved?: boolean;
}

export interface Structure {
  id: number;
  tribeId: number;
  type: StructureType;
  x: number;
  y: number;
  radius: number;
  health: number;
  maxHealth: number;
  /** Blueprints are placed with materials already paid and need builder ticks to finish. */
  built: boolean;
  progress: number;
  buildTicks: number;
  /** Shelter only: blobs currently shielded from winter this tick. */
  occupants: number;
  /** Tick of the last hit, for the damage flash. */
  lastHitTick: number;
}

export type TribeOrigin = 'founder' | 'split' | 'wanderers';
export type GameMode = 'endless' | 'lastStanding';
export type RealmTier = 'chiefdom' | 'kingdom' | 'empire';

export interface Realm {
  id: number;
  name: string;
  color: string;
  /** Tribe id of the capital camp. */
  capitalId: number;
  foundedDay: number;
  tier: RealmTier;
}

export interface Tribe {
  id: number;
  name: string;
  color: string;
  basePosition: { x: number; y: number };
  stockpile: Stockpile;
  extinct: boolean;
  fallenDay: number | null;
  /** Tribe this one split from, or null for founders and wanderers. */
  parentId: number | null;
  foundedDay: number;
  origin: TribeOrigin;
  lastSplitDay: number;
  /** Realm (chiefdom, kingdom or empire) this camp belongs to. */
  realmId: number;
  /** 0–1; capitals are always 1, vassals rebel if loyalty falls too low. */
  loyalty: number;
  /** Accumulated raid pressure from foreign realms, used for vassalization. */
  raidPressure: number;
  lastRaiderRealmId: number | null;
  /** Totals gathered/delivered today, reset each morning. */
  deliveredToday: Stockpile;
}

export type Season = 'summer' | 'fall' | 'winter';

export type BlobState = 'active' | 'dead';
export type DeathCause = 'starved' | 'exhausted' | 'slain' | 'disease' | 'age';
export type BlobRole = 'gatherer' | 'builder' | 'warrior' | 'idle';
export type BlobJob = 'forager' | 'lumberjack' | 'miner' | 'builder' | 'soldier' | 'carrier' | 'scout';

export interface Blob {
  id: number;
  tribeId: number;
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
  /** Last brain outputs, already mapped: throttle in [0, 1], turn in radians/tick, coop in [-1, 1]. */
  throttle: number;
  turn: number;
  coop: number;
  radius: number;

  energy: number;
  maxEnergy: number;
  cargo: Cargo;
  /** Consecutive nights the tribe couldn't feed this blob. */
  hunger: number;
  sheltered: boolean;

  state: BlobState;
  deathCause: DeathCause | null;
  /** Set during the night on blobs born that night, for the pop-in animation. */
  newborn: boolean;
  settledTick: number;

  // Per-day activity, reset each morning; drives fitness, roles and stats.
  harvested: number;
  delivered: number;
  deliveredByType: Stockpile;
  buildWork: number;
  attacks: number;
  kills: number;
  coopSum: number;
  activeTicks: number;
  job: BlobJob;
  role: BlobRole;
  /** Destination camp for a carrier hauling goods along a road, or null. */
  routeTargetTribeId: number | null;
  daysSurvived: number;
  maxAge: number;
  /** Running average of daily fitness, used for selection. */
  fitnessAvg: number;
  spawnX: number;
  spawnY: number;
  maxDisplacement: number;
  /** Closest the blob got to its Town Center while carrying cargo (fitness shaping). */
  closestHomeLoaded: number;

  lastAttackTick: number;
  lastGatherTick: number;
  lastBuildTick: number;

  /** What the brain perceived on its last tick (for the inspector overlay). */
  sensed: {
    food: { x: number; y: number } | null;
    timber: { x: number; y: number } | null;
    stone: { x: number; y: number } | null;
    ally: { x: number; y: number } | null;
    threat: { x: number; y: number } | null;
  };
}

export interface SimulationConfig {
  seed: number;
  /** `endless`: tribes split, ruins are resettled and wanderers arrive; the world never ends. */
  mode: GameMode;
  arenaSize: number;
  /** Founding tribes on day 1. */
  tribeCount: number;
  /** Most tribes alive at once in endless mode. */
  maxTribes: number;
  /** Smallest tribe that may send out a splinter group. */
  splitMinPopulation: number;
  /** Minimum days between wanderer bands. */
  wandererCooldown: number;

  /** Berry units regrown per summer day across the whole map (scaled down in fall/winter). */
  foodPerDay: number;
  /** Std-dev of Gaussian mutation, as a fraction of the parent's trait value. */
  mutationRate: number;
  /** Founders in each camp on day 1. */
  blobsPerTribe: number;
  /** Std-dev (fractional) of trait variation in the founding population. */
  initialVariance: number;
  /** 0–1 strength of the forage-and-return reflex founders are born with (0 = blank random brains). */
  instinct: number;

  /** Probability that each synapse is nudged when a brain is copied (if mutation > 0). */
  brainMutationProb: number;
  /** Brain mutation σ = `mutationRate × brainMutationScale`. */
  brainMutationScale: number;
  maxTurn: number;

  /**
   * During the first `graceDays`, any tribe below this size is topped up with mutated copies
   * of its fittest members, so clumsy random Generation-0 brains can't wipe a tribe out
   * before it has had a chance to learn. Afterwards tribes can go extinct.
   */
  minTribePopulation: number;
  graceDays: number;

  dayTicks: number;
  nightTicks: number;
  yearLength: number;

  startEnergy: number;
  baseVelocity: number;
  baseRadius: number;
  cMove: number;
  cSense: number;
  cBrain: number;
  cBase: number;
  /** Multiplier on cBase for unsheltered blobs in winter (1.4 = +40%). */
  winterDrainMultiplier: number;

  carryCapacity: number;
  /** Food each citizen eats per night. */
  ration: number;
  birthCost: number;
  /** Food kept safe overnight per granary level; anything above spoils. */
  safeFoodBase: number;
  spoilRate: number;
  housingBase: number;
  /** Mean days a blob lives before dying of old age. */
  lifespan: number;
  shelterCapacity: number;
  winterDiseaseChance: number;

  aggressionThreshold: number;
  cooperationThreshold: number;
  attackDamage: number;
  attackCooldown: number;
  /** Shifts the coopAction output; negative values make founders more warlike. */
  aggressionBias: number;

  startingStockpile: Stockpile;
  maxPopulation: number;
}

export interface TribeDayStats {
  population: number;
  stockpile: Stockpile;
  structures: number;
  realmId: number;
}

export interface GenerationStats {
  day: number;
  year: number;
  dayOfYear: number;
  season: Season;
  population: number;
  tribes: TribeDayStats[];
  stockpile: Stockpile;
  structures: number;
  roles: Record<BlobRole, number>;
  jobs: Record<BlobJob, number>;
  deaths: Record<DeathCause, number>;
  born: number;
  backfilled: number;
  /** Tribes founded today by splitting or by wanderers. */
  founded: number;
  livingTribes: number;
  delivered: Stockpile;
  avgSpeed: number;
  avgSize: number;
  avgSense: number;
  avgIntelligence: number;
}

export interface WinterRecord {
  year: number;
  startPopulation: number;
  endPopulation: number;
  /** Blobs alive at winter's start that saw spring (excludes winter births and arrivals). */
  survived: number;
  /** Per tribe, survivors / population entering winter (null if the tribe was already extinct). */
  tribeSurvival: (number | null)[];
}

/** `won`: one tribe is left standing. `extinct`: none are. Both end the run. */
export type SimPhase = 'day' | 'night' | 'extinct' | 'won';

export interface TribeStatus {
  id: number;
  name: string;
  color: string;
  population: number;
  stockpile: Stockpile;
  housing: number;
  extinct: boolean;
  fallenDay: number | null;
  parentId: number | null;
  foundedDay: number;
  origin: TribeOrigin;
  realmId: number;
  loyalty: number;
  tier: SettlementTier;
}

export interface RealmStatus {
  id: number;
  name: string;
  color: string;
  capitalId: number;
  tier: RealmTier;
  population: number;
  camps: number;
  food: number;
}

/** Something notable that happened, for the chronicle feed. */
export interface WorldEvent {
  day: number;
  kind: 'split' | 'wanderers' | 'fell' | 'realm' | 'vassal' | 'rebel' | 'trade' | 'alliance' | 'war' | 'peace' | 'festival' | 'road';
  tribeId: number;
  text: string;
}

export interface DayStatus {
  day: number;
  year: number;
  dayOfYear: number;
  season: Season;
  phase: SimPhase;
  winnerId: number | null;
  tick: number;
  dayTicks: number;
  population: number;
  tribes: TribeStatus[];
  realms: RealmStatus[];
  diplomacy: { realmA: number; realmB: number; stance: DiplomaticStance }[];
}
