import { BASE_LAYOUTS, DEFAULT_CONFIG, MODE_SETTINGS, STRUCTURE_SPECS, TRIBE_TEMPLATES } from './config';
import { BRAIN_SHAPE, NeuralNet } from './NeuralNet';
import { Random } from './random';
import { SpatialGrid } from './SpatialGrid';
import {
  GENE_RANGES,
  type Blob,
  type BlobJob,
  type BlobRole,
  type DayStatus,
  type DeathCause,
  type DiplomaticStance,
  type GeneKey,
  type Genes,
  type GenerationStats,
  type Lake,
  type Realm,
  type RealmRelation,
  type RealmTier,
  type ResourceNode,
  type ResourceType,
  type RiverSegment,
  type Road,
  type Season,
  type SettlementTier,
  type SimPhase,
  type SimulationConfig,
  type Stockpile,
  type Structure,
  type StructureType,
  type Tribe,
  type TribeOrigin,
  type WinterRecord,
  type WorldEvent,
} from './types';

const GRID_CELL = 50;
const INV_PI = 1 / Math.PI;
/** Distance at which `homeDist` proximity bottoms out at 0. */
const HOME_SENSE_RANGE = 600;
/** Blueprints creep forward on their own so construction never fully stalls without builders. */
const AUTO_BUILD_RATE = 0.1;
const REPAIR_RATE = 0.5;
const BUILD_REACH = 12;
const REFUEL_COST = 0.2;
/** Drop-off zone beyond the Town Center's footprint where cargo is unloaded. */
const DEPOSIT_REACH = 30;
const LOADED_SHAPING = 25;
const EMPTY_HOME_PULL = 0.3;
const SHELTER_REACH = 40;

const REGEN = {
  /** Fraction of max regrown per day at full season strength. */
  timber: 0.07,
  stone: 0.1,
};
const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'timber', 'stone'];
/** Side of the founding region; `foodPerDay` is tuned for the bushes of a map this size. */
const CORE_SPAN = 800;
const REFERENCE_BUSHES = 48;
/** Untouched bushes grow up to this multiple of their original size. */
const LUSH_MAX = 1.5;
const LUSH_AFTER_DAYS = 10;
const MIN_CAMP_SPACING = 280;
const RUIN_DECAY_DAYS = 30;
const HALL_OF_FAME_SIZE = 24;
const MAX_EVENTS = 200;
const MAX_HISTORY = 2400;
/** Fraction of the remaining days' rations a tribe keeps back from breeding after midsummer. */
const WINTER_RESERVE = 1.5;
const WATCHTOWER_RANGE = 120;
const WATCHTOWER_DAMAGE = 14;
const WATCHTOWER_COOLDOWN = 25;
const ROAD_BUILD_COST = 10;
const ROAD_BUILD_TICKS = 80;
const ROAD_HALF_WIDTH = 16;
const ROAD_SPEED_BONUS = 1.35;
const HIGHWAY_SPEED_BONUS = 1.75;
const SKYSCRAPER_HOUSING = 25;
const RESOURCE_POPUP_COLOR: Record<ResourceType, string> = {
  food: '#b6f36b',
  timber: '#8ce6a0',
  stone: '#cbd5e1',
};
const JOB_INDEX: Record<BlobJob, number> = {
  forager: 13,
  lumberjack: 14,
  miner: 15,
  builder: 16,
  soldier: 17,
  carrier: 18,
  scout: 19,
};
const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

function emptyStock(): Stockpile {
  return { food: 0, timber: 0, stone: 0 };
}

export function clampGenes(g: Genes): Genes {
  return {
    maxSpeed: clamp(g.maxSpeed, GENE_RANGES.maxSpeed.min, GENE_RANGES.maxSpeed.max),
    size: clamp(g.size, GENE_RANGES.size.min, GENE_RANGES.size.max),
    senseRadius: clamp(g.senseRadius, GENE_RANGES.senseRadius.min, GENE_RANGES.senseRadius.max),
    intelligence: clamp(g.intelligence, GENE_RANGES.intelligence.min, GENE_RANGES.intelligence.max),
  };
}

export function seasonOf(dayOfYear: number, yearLength: number): Season {
  const f = dayOfYear / yearLength;
  return f < 0.6 ? 'summer' : f < 0.8 ? 'fall' : 'winter';
}

/** 0 through summer, rising through fall, peaking at 1 in midwinter. */
export function seasonIntensity(dayOfYear: number, yearLength: number): number {
  const f = dayOfYear / yearLength;
  if (f < 0.6) return 0;
  if (f < 0.8) return ((f - 0.6) / 0.2) * 0.6;
  return 0.6 + 0.4 * (1 - Math.abs(f - 0.9) / 0.1);
}

/** Natural regrowth multiplier for food and timber. */
function growthMultiplier(dayOfYear: number, yearLength: number): number {
  const f = dayOfYear / yearLength;
  if (f < 0.6) return 1;
  if (f < 0.8) return 1 - ((f - 0.6) / 0.2) * 0.7;
  return 0.08;
}

/**
 * Headless, deterministic tribal simulation. Has no knowledge of React or rendering:
 * callers advance it with `step()` at whatever rate they like and read state directly.
 */
export class SimulationEngine {
  config: SimulationConfig;
  private pendingConfig: Partial<SimulationConfig> | null = null;
  private rng: Random;

  tribes: Tribe[] = [];
  realms: Realm[] = [];
  relations = new Map<string, RealmRelation>();
  roads: Road[] = [];
  river: RiverSegment[] = [];
  lakes: Lake[] = [];
  blobs: Blob[] = [];
  /** Recent watchtower shots for visual tracers. */
  towerShots: { x1: number; y1: number; x2: number; y2: number; tick: number; color: string }[] = [];
  /** Transient visual effects (clashes, splashes, sparks, popups, fireworks). */
  visualFx: {
    kind: 'clash' | 'splash' | 'spark' | 'popup' | 'firework';
    x: number;
    y: number;
    tx?: number;
    ty?: number;
    color: string;
    text?: string;
    tick: number;
    day: number;
  }[] = [];
  /** Latest notable coordinate for Director Mode camera tracking. */
  directorFocus: { x: number; y: number; day: number; tick: number } | null = null;
  /** Wilderness sites discovered by scouts. */
  scoutedSites: { x: number; y: number; score: number; day: number }[] = [];
  nodes: ResourceNode[] = [];
  structures: Structure[] = [];
  history: GenerationStats[] = [];
  winters: WinterRecord[] = [];
  /** Genes of the population as it started the current day (for distribution charts). */
  generationGenes: { tribeId: number; genes: Genes }[] = [];
  /** Recent splits, arrivals and falls, newest last. */
  events: WorldEvent[] = [];

  day = 0;
  tick = 0;
  phase: SimPhase = 'day';
  /** The last tribe standing, once the run is won. */
  winnerId: number | null = null;
  /** Bumped whenever `history` changes, so UI can cheaply detect new data. */
  revision = 0;

  private nightCounter = 0;
  private nextId = 1;
  private readonly inputs = new Float32Array(BRAIN_SHAPE.inputs);
  private blobGrid: SpatialGrid<Blob>;
  private nodeGrid: SpatialGrid<ResourceNode>;
  /** Blob id → tribe id for everyone alive on the first day of winter. */
  private winterStart: Map<number, number> | null = null;
  private dayBirths = 0;
  private dayBackfilled = 0;
  private dayDeaths: Record<DeathCause, number> = { starved: 0, exhausted: 0, slain: 0, disease: 0, age: 0 };
  /** Last day each tribe was attacked; drives barricade construction. */
  private lastRaided: number[] = [];
  private dayFounded = 0;
  private lastWandererDay = -999;
  /** Rebuilt every tick so per-blob checks don't scan every structure in the world. */
  private structuresByTribe: Structure[][] = [];
  private barricades: Structure[] = [];
  private readonly nearestNode: Record<ResourceType, ResourceNode | null> = { food: null, timber: null, stone: null };
  private readonly nearestD2: Record<ResourceType, number> = { food: Infinity, timber: Infinity, stone: Infinity };
  /** Best brains seen so far; wanderer bands descend from them. */
  private hallOfFame: { id: number; genes: Genes; brain: NeuralNet; score: number }[] = [];

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG };
    this.rng = new Random(this.config.seed);
    this.blobGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.nodeGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.reset(config);
  }

  // ───────────────────────────── Public API ─────────────────────────────

  /** Restart from day 1: new map, new tribes, random brains. */
  reset(config: Partial<SimulationConfig> = {}): void {
    const merged = { ...this.config, ...(this.pendingConfig ?? {}), ...config };
    // Mode settings apply unless the caller sets them explicitly.
    const modeSettings = MODE_SETTINGS[merged.mode];
    this.config = { ...merged, ...modeSettings, ...pick(config, Object.keys(modeSettings) as (keyof typeof modeSettings)[]) };
    this.pendingConfig = null;
    const cfg = this.config;
    const L = cfg.arenaSize;
    this.rng = new Random(cfg.seed);
    this.blobGrid = new SpatialGrid(L, L, GRID_CELL);
    this.nodeGrid = new SpatialGrid(L, L, GRID_CELL);
    this.nextId = 1;
    this.day = 0;
    this.tick = 0;
    this.winnerId = null;
    this.history = [];
    this.winters = [];
    this.events = [];
    this.winterStart = null;
    this.blobs = [];
    this.structures = [];
    this.tribes = [];
    this.realms = [];
    this.relations.clear();
    this.roads = [];
    this.river = [];
    this.lakes = [];
    this.towerShots = [];
    this.visualFx = [];
    this.directorFocus = null;
    this.scoutedSites = [];
    this.lastRaided = [];
    this.hallOfFame = [];
    this.lastWandererDay = -999;

    const layout = BASE_LAYOUTS[cfg.tribeCount] ?? BASE_LAYOUTS[4];
    // Founders share a core region the size of the classic map; the rest is open land.
    const span = Math.min(L, CORE_SPAN);
    const offset = (L - span) / 2;
    for (const [fx, fy] of layout) this.foundTribe(offset + fx * span, offset + fy * span, 'founder', null);

    this.generateMap();

    const perTribe = Math.max(1, Math.round(cfg.blobsPerTribe));
    const v = cfg.initialVariance;
    for (const t of this.tribes) {
      for (let i = 0; i < perTribe; i++) {
        const genes = clampGenes({
          maxSpeed: GENE_RANGES.maxSpeed.default * (1 + v * this.rng.gaussian()),
          size: GENE_RANGES.size.default * (1 + v * this.rng.gaussian()),
          senseRadius: GENE_RANGES.senseRadius.default * (1 + v * this.rng.gaussian()),
          intelligence: GENE_RANGES.intelligence.default * (1 + v * this.rng.gaussian()),
        });
        this.blobs.push(this.createBlob(t.id, genes, this.foundingBrain(), null));
      }
      this.assignJobs(t);
    }

    this.history.push(this.computeStats());
    this.startDay();
  }

  /** Queue parameter changes; they are applied when the next day begins. */
  setConfig(partial: Partial<SimulationConfig>): void {
    this.pendingConfig = { ...(this.pendingConfig ?? {}), ...partial };
  }

  get dayOfYear(): number {
    return Math.max(0, this.day - 1) % this.config.yearLength;
  }

  get year(): number {
    return Math.floor(Math.max(0, this.day - 1) / this.config.yearLength) + 1;
  }

  get season(): Season {
    return seasonOf(this.dayOfYear, this.config.yearLength);
  }

  /** 0 → 1 through the night; 0 during the day. */
  get nightProgress(): number {
    return this.phase === 'night' ? Math.min(1, this.nightCounter / Math.max(1, this.config.nightTicks)) : 0;
  }

  townCenter(tribeId: number): Structure {
    return this.structures.find((s) => s.tribeId === tribeId && s.type === 'townCenter')!;
  }

  housing(tribeId: number): number {
    const shelters = this.structures.filter((s) => s.tribeId === tribeId && s.type === 'shelter' && s.built).length;
    const skyscrapers = this.structures.filter((s) => s.tribeId === tribeId && s.type === 'skyscraper' && s.built).length;
    return this.config.housingBase + shelters * this.config.shelterCapacity + skyscrapers * SKYSCRAPER_HOUSING;
  }

  safeFoodCapacity(tribeId: number): number {
    const granaries = this.structures.filter((s) => s.tribeId === tribeId && s.type === 'granary' && s.built).length;
    return this.config.safeFoodBase * (1 + granaries);
  }

  settlementTier(pop: number, tribeId?: number): SettlementTier {
    const hasSkyscraper =
      tribeId !== undefined && this.structures.some((s) => s.tribeId === tribeId && s.type === 'skyscraper' && s.built);
    if (pop >= 80 || hasSkyscraper) return 'metropolis';
    if (pop >= 55) return 'city';
    if (pop >= 40) return 'town';
    if (pop >= 22) return 'village';
    return 'camp';
  }

  carryCapacityFor(tribeId: number): number {
    const hasWorkshop = this.structures.some((s) => s.tribeId === tribeId && s.type === 'workshop' && s.built);
    const hasFactory = this.structures.some((s) => s.tribeId === tribeId && s.type === 'factory' && s.built);
    return this.config.carryCapacity + (hasWorkshop ? 1 : 0) + (hasFactory ? 2 : 0);
  }

  getStatus(): DayStatus {
    const pops = this.tribes.map(() => 0);
    let population = 0;
    for (const b of this.blobs) {
      if (b.state !== 'active' || b.newborn) continue;
      pops[b.tribeId]++;
      population++;
    }
    return {
      day: this.day,
      year: this.year,
      dayOfYear: this.dayOfYear,
      season: this.season,
      phase: this.phase,
      winnerId: this.winnerId,
      tick: this.tick,
      dayTicks: this.config.dayTicks,
      population,
      tribes: this.tribes.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        population: pops[t.id],
        stockpile: { ...t.stockpile },
        housing: this.housing(t.id),
        extinct: t.extinct,
        fallenDay: t.fallenDay,
        parentId: t.parentId,
        foundedDay: t.foundedDay,
        origin: t.origin,
        realmId: t.realmId,
        loyalty: t.loyalty,
        tier: this.settlementTier(pops[t.id], t.id),
      })),
      realms: this.realms
        .map((r) => {
          const members = this.tribes.filter((t) => !t.extinct && t.realmId === r.id);
          return {
            id: r.id,
            name: r.name,
            color: r.color,
            capitalId: r.capitalId,
            tier: r.tier,
            population: members.reduce((s, t) => s + pops[t.id], 0),
            camps: members.length,
            food: members.reduce((s, t) => s + t.stockpile.food, 0),
          };
        })
        .filter((r) => r.camps > 0),
      diplomacy: [...this.relations.values()]
        .filter((rel) => {
          const ra = this.realms[rel.a];
          const rb = this.realms[rel.b];
          return rel.stance !== 'neutral' && ra && rb && !this.tribes[ra.capitalId]?.extinct && !this.tribes[rb.capitalId]?.extinct;
        })
        .map((rel) => ({ realmA: rel.a, realmB: rel.b, stance: rel.stance })),
    };
  }

  /** Contribution score: drives parent selection, backfill and "Select Fittest". */
  fitness(b: Blob): number {
    const dt = b.deliveredByType;
    const disp = 3 * (b.maxDisplacement / this.config.arenaSize);
    let score = disp;
    if (b.job === 'forager') {
      score += dt.food * 35 + (dt.timber + dt.stone) * 15 + b.harvested * 8 + b.buildWork * 0.1;
    } else if (b.job === 'lumberjack') {
      score += dt.timber * 35 + dt.food * 15 + dt.stone * 15 + b.harvested * 8 + b.buildWork * 0.1;
    } else if (b.job === 'miner') {
      score += dt.stone * 35 + dt.food * 15 + dt.timber * 15 + b.harvested * 8 + b.buildWork * 0.1;
    } else if (b.job === 'builder') {
      score += b.buildWork * 0.6 + b.delivered * 15 + b.harvested * 4;
    } else if (b.job === 'carrier') {
      score += b.delivered * 38 + b.harvested * 6;
    } else if (b.job === 'scout') {
      score += 35 * (b.maxDisplacement / this.config.arenaSize) + b.delivered * 20 + b.harvested * 6;
    } else {
      // soldier
      score += b.kills * 45 + b.attacks * 10 + b.delivered * 12 + b.harvested * 4;
    }
    if (b.cargo.amount > 0) score += LOADED_SHAPING * Math.max(0, 1 - b.closestHomeLoaded / 250);
    if (b.state === 'active') score += 5;
    return score;
  }

  /** Highest-contributing blob still active in the field. */
  fittestBlob(): Blob | null {
    let best: Blob | null = null;
    let bestScore = -Infinity;
    for (const b of this.blobs) {
      if (b.state !== 'active' || b.newborn) continue;
      const s = this.fitness(b);
      if (s > bestScore) {
        bestScore = s;
        best = b;
      }
    }
    return best;
  }

  /** True once the run has ended, either with a sole surviving tribe or with none. */
  get finished(): boolean {
    return this.phase === 'extinct' || this.phase === 'won';
  }

  step(): void {
    if (this.finished) return;
    if (this.phase === 'night') {
      if (++this.nightCounter >= this.config.nightTicks) this.startDay();
      return;
    }
    this.tick++;
    this.simulateTick();
    if (this.tick >= this.config.dayTicks || !this.blobs.some((b) => b.state === 'active')) this.endDay();
  }

  runTicks(n: number): void {
    for (let i = 0; i < n && !this.finished; i++) this.step();
  }

  /** Run until the next day has begun (or the run has ended). */
  advanceDay(): void {
    const target = this.day + 1;
    const guard = (this.config.dayTicks + this.config.nightTicks + 10) * 2;
    for (let i = 0; i < guard && this.day < target && !this.finished; i++) this.step();
  }

  // ───────────────────────────── World setup ─────────────────────────────

  private makeStructure(tribeId: number, type: StructureType, x: number, y: number): Structure {
    const spec = STRUCTURE_SPECS[type];
    return {
      id: this.nextId++,
      tribeId,
      type,
      x,
      y,
      radius: spec.radius,
      health: spec.maxHealth,
      maxHealth: spec.maxHealth,
      built: false,
      progress: 0,
      buildTicks: spec.buildTicks,
      occupants: 0,
      lastHitTick: -999,
    };
  }

  private generateMap(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    this.nodes = [];
    this.nodeGrid.clear();
    const bases = this.tribes.map((t) => t.basePosition);
    const clearOfBases = (x: number, y: number, min: number) => bases.every((b) => Math.hypot(b.x - x, b.y - y) >= min);
    const add = (type: ResourceType, x: number, y: number, max: number, radius: number) => this.addNode(type, x, y, max, radius);
    const areaScale = (L / CORE_SPAN) ** 2;

    this.generateWater(bases, clearOfBases);

    // Berry bushes: a few near each camp, the rest scattered across open ground.
    for (const b of bases) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
        const d = this.rng.range(95, 150);
        const fx = b.x + Math.cos(a) * d;
        const fy = b.y + Math.sin(a) * d;
        if (!this.isInWater(fx, fy)) add('food', fx, fy, 4, 7);
      }
    }
    const scattered = Math.round(24 * areaScale);
    for (let placed = 0, tries = 0; placed < scattered && tries < scattered * 20; tries++) {
      const x = this.rng.range(50, L - 50);
      const y = this.rng.range(50, L - 50);
      if (!clearOfBases(x, y, 130) || this.isInWater(x, y)) continue;
      add('food', x, y, 4, 7);
      placed++;
    }

    // Each camp has a small home grove and stone outcrop on its outer side.
    for (const b of bases) {
      const away = Math.atan2(b.y - L / 2, b.x - L / 2);
      for (let i = 0; i < 4; i++) {
        const a = away + 0.9 + this.rng.range(-0.25, 0.25);
        const d = this.rng.range(120, 150) + i * 6;
        add('timber', b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 6, 9);
      }
      const sa = away - 0.9;
      add('stone', b.x + Math.cos(sa) * 135, b.y + Math.sin(sa) * 135, 8, 10);
    }

    // Larger forests sit between neighbouring camps, so wood is shared and contested.
    const groves: [number, number][] = bases.map((b, i) => {
      const n = bases[(i + 1) % bases.length];
      return [(b.x + n.x) / 2, (b.y + n.y) / 2];
    });
    for (const [gx, gy] of groves) {
      for (let i = 0; i < 6; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(0, 42);
        add('timber', gx + Math.cos(a) * d, gy + Math.sin(a) * d, 6, 9);
      }
    }

    // Stone is concentrated in the centre: the richest, most dangerous ground.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const d = this.rng.range(25, 55);
      add('stone', L / 2 + Math.cos(a) * d, L / 2 + Math.sin(a) * d, 16, 11);
    }

    // Wilderness beyond the founding core: small woods and outcrops waiting for new camps.
    const wild = Math.round(4 * (areaScale - 1));
    for (let placed = 0, tries = 0; placed < wild && tries < wild * 30; tries++) {
      const x = this.rng.range(70, L - 70);
      const y = this.rng.range(70, L - 70);
      if (!clearOfBases(x, y, 260) || this.isInWater(x, y)) continue;
      for (let i = 0; i < 4; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(0, 32);
        const tx = x + Math.cos(a) * d;
        const ty = y + Math.sin(a) * d;
        if (!this.isInWater(tx, ty)) add('timber', tx, ty, 6, 9);
      }
      const sa = this.rng.range(0, Math.PI * 2);
      const sx = x + Math.cos(sa) * 70;
      const sy = y + Math.sin(sa) * 70;
      if (!this.isInWater(sx, sy)) add('stone', sx, sy, 8, 10);
      placed++;
    }
  }

  private generateWater(bases: { x: number; y: number }[], clearOfBases: (x: number, y: number, min: number) => boolean): void {
    const L = this.config.arenaSize;
    const width = L >= 1200 ? 34 : 24;
    const steps = 14;
    const horizontal = this.rng.next() < 0.5;
    const pts: { x: number; y: number }[] = [];
    const baseOffset = this.rng.range(-0.18, 0.18) * L;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wave = Math.sin(t * Math.PI * 2.5 + this.rng.range(-0.2, 0.2)) * (L * 0.11);
      let x = horizontal ? t * L : L * 0.5 + baseOffset + wave;
      let y = horizontal ? L * 0.5 + baseOffset + wave : t * L;
      // Nudge river away from founding Town Centers so camps stay dry.
      for (const b of bases) {
        const dx = x - b.x;
        const dy = y - b.y;
        const d = Math.hypot(dx, dy);
        const minD = 95;
        if (d < minD && d > 0.1) {
          x = b.x + (dx / d) * minD;
          y = b.y + (dy / d) * minD;
        }
      }
      pts.push({ x: clamp(x, 0, L), y: clamp(y, 0, L) });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      this.river.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, width });
    }

    // Scenic lakes in open ground.
    const lakeCount = L >= 1500 ? 3 : L >= 1100 ? 2 : 1;
    for (let placed = 0, tries = 0; placed < lakeCount && tries < 60; tries++) {
      const radius = this.rng.range(48, 76);
      const x = this.rng.range(140, L - 140);
      const y = this.rng.range(140, L - 140);
      if (!clearOfBases(x, y, radius + 115)) continue;
      if (this.lakes.some((lk) => Math.hypot(lk.x - x, lk.y - y) < lk.radius + radius + 120)) continue;
      this.lakes.push({ x, y, radius });
      placed++;
    }

    // Fish shoals near the riverbanks and lakeshores so blobs can fish from the edge.
    for (let i = 0; i < this.river.length; i += 2) {
      const seg = this.river[i];
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const side = i % 4 === 0 ? 1 : -1;
      const offset = seg.width * 0.34 * side;
      const mx = (seg.x1 + seg.x2) / 2 + nx * offset;
      const my = (seg.y1 + seg.y2) / 2 + ny * offset;
      const node = this.addNode('food', mx, my, 6, 9);
      node.isFish = true;
    }
    for (const lk of this.lakes) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
        const fx = lk.x + Math.cos(a) * Math.max(8, lk.radius - 10);
        const fy = lk.y + Math.sin(a) * Math.max(8, lk.radius - 10);
        const node = this.addNode('food', fx, fy, 6, 9);
        node.isFish = true;
      }
    }
  }

  private distToRiver(x: number, y: number): { dist: number; width: number; px: number; py: number } {
    let bestD = Infinity;
    let bestW = 0;
    let bestPx = x;
    let bestPy = y;
    for (const seg of this.river) {
      const vx = seg.x2 - seg.x1;
      const vy = seg.y2 - seg.y1;
      const len2 = vx * vx + vy * vy;
      const t = len2 > 0 ? clamp(((x - seg.x1) * vx + (y - seg.y1) * vy) / len2, 0, 1) : 0;
      const px = seg.x1 + t * vx;
      const py = seg.y1 + t * vy;
      const d = Math.hypot(x - px, y - py) - seg.width * 0.5;
      if (d < bestD) {
        bestD = d;
        bestW = seg.width;
        bestPx = px;
        bestPy = py;
      }
    }
    return { dist: bestD, width: bestW, px: bestPx, py: bestPy };
  }

  isInWater(x: number, y: number): boolean {
    if (this.distToRiver(x, y).dist < 0) return true;
    for (const lk of this.lakes) {
      if (Math.hypot(x - lk.x, y - lk.y) < lk.radius) return true;
    }
    return false;
  }

  private onBuiltBridge(x: number, y: number): boolean {
    for (const s of this.structures) {
      if (s.type === 'bridge' && s.built && Math.hypot(s.x - x, s.y - y) <= s.radius + 10) return true;
    }
    return false;
  }

  private addNode(type: ResourceType, x: number, y: number, max: number, radius: number): ResourceNode {
    const L = this.config.arenaSize;
    const node: ResourceNode = {
      id: this.nextId++,
      type,
      x: clamp(x, 30, L - 30),
      y: clamp(y, 30, L - 30),
      amount: max,
      max,
      baseMax: max,
      lastHarvestDay: 0,
      radius,
    };
    this.nodes.push(node);
    this.nodeGrid.insert(node);
    return node;
  }

  // ───────────────────────────── Tribes & camps ─────────────────────────────

  private foundTribe(x: number, y: number, origin: TribeOrigin, parentId: number | null): Tribe {
    const id = this.tribes.length;
    const template = TRIBE_TEMPLATES[id % TRIBE_TEMPLATES.length];
    const generation = Math.floor(id / TRIBE_TEMPLATES.length);
    const livingColors = new Set(this.tribes.filter((t) => !t.extinct).map((t) => t.color));
    const color = !livingColors.has(template.color)
      ? template.color
      : (TRIBE_TEMPLATES.find((t) => !livingColors.has(t.color))?.color ?? template.color);
    const realmId = origin === 'split' && parentId !== null ? this.tribes[parentId].realmId : this.realms.length;
    const tribe: Tribe = {
      id,
      name: generation > 0 ? `${template.name} ${ROMAN[generation] ?? generation + 1}` : template.name,
      color,
      basePosition: { x, y },
      stockpile: origin === 'founder' ? { ...this.config.startingStockpile } : emptyStock(),
      extinct: false,
      fallenDay: null,
      parentId,
      foundedDay: this.day,
      origin,
      lastSplitDay: this.day,
      realmId,
      loyalty: origin === 'split' ? 0.85 : 1,
      raidPressure: 0,
      lastRaiderRealmId: null,
      deliveredToday: emptyStock(),
    };
    if (origin !== 'split' || parentId === null) {
      this.realms.push({
        id: realmId,
        name: tribe.name,
        color: tribe.color,
        capitalId: id,
        foundedDay: this.day,
        tier: 'chiefdom',
      });
    }
    this.tribes.push(tribe);
    this.lastRaided.push(-999);

    // A new camp clears away whatever ruin stood on the spot.
    this.structures = this.structures.filter(
      (s) => !(this.tribes[s.tribeId].extinct && Math.hypot(s.x - x, s.y - y) < 120),
    );
    const tc = this.makeStructure(id, 'townCenter', x, y);
    tc.built = true;
    tc.progress = tc.buildTicks;
    this.structures.push(tc);
    return tribe;
  }

  /** Top up the land around a new camp so settlers have something to work with. */
  private ensureHomeResources(x: number, y: number): void {
    const near = (type: ResourceType, r: number) =>
      this.nodes.filter((n) => n.type === type && Math.hypot(n.x - x, n.y - y) < r).length;
    for (let have = near('food', 170); have < 6; have++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(90, 150);
      this.addNode('food', x + Math.cos(a) * d, y + Math.sin(a) * d, 4, 7);
    }
    const groveAngle = this.rng.range(0, Math.PI * 2);
    for (let have = near('timber', 180); have < 4; have++) {
      const a = groveAngle + this.rng.range(-0.3, 0.3);
      const d = this.rng.range(115, 150);
      this.addNode('timber', x + Math.cos(a) * d, y + Math.sin(a) * d, 6, 9);
    }
    if (near('stone', 190) < 1) {
      const a = groveAngle + Math.PI + this.rng.range(-0.4, 0.4);
      this.addNode('stone', x + Math.cos(a) * 135, y + Math.sin(a) * 135, 8, 10);
    }
  }

  /**
   * Pick open ground for a new camp: away from living camps, near resources, preferring
   * abandoned ruins. Splinter groups stay near their parent; wanderers keep their distance.
   */
  private findCampSite(near: { x: number; y: number } | null): { x: number; y: number } | null {
    const L = this.config.arenaSize;
    const margin = 90;
    const camps = this.tribes.filter((t) => !t.extinct).map((t) => t.basePosition);
    const ruins = this.tribes.filter((t) => t.extinct).map((t) => t.basePosition);
    const candidates = [...ruins.map((p) => ({ ...p, ruin: true }))];
    for (let i = 0; i < 48; i++) {
      candidates.push({ x: this.rng.range(margin, L - margin), y: this.rng.range(margin, L - margin), ruin: false });
    }
    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (c.x < margin || c.y < margin || c.x > L - margin || c.y > L - margin) continue;
      if (this.isInWater(c.x, c.y) || this.distToRiver(c.x, c.y).dist < 28) continue;
      let nearestCamp = Infinity;
      for (const p of camps) nearestCamp = Math.min(nearestCamp, Math.hypot(p.x - c.x, p.y - c.y));
      if (nearestCamp < MIN_CAMP_SPACING) continue;
      let richness = 0;
      for (const n of this.nodes) {
        const d = Math.hypot(n.x - c.x, n.y - c.y);
        if (d < 200) richness += n.type === 'food' ? 1 : 0.6;
      }
      let score = Math.min(richness, 12) * 3 + (c.ruin ? 8 : 0);
      for (const sc of this.scoutedSites) {
        if (Math.hypot(sc.x - c.x, sc.y - c.y) < 120) {
          score += Math.min(10, sc.score);
          break;
        }
      }
      if (near) score -= Math.hypot(near.x - c.x, near.y - c.y) / 25;
      else score += Math.min(nearestCamp, 600) / 30;
      if (score > bestScore) {
        bestScore = score;
        best = { x: c.x, y: c.y };
      }
    }
    return best;
  }

  /**
   * Founders' brains: random, plus (scaled by `instinct`) a forage reflex wired into two hidden
   * units — steer toward food while the pack has room, toward home once something is carried.
   * The sensory gating in `sense()` does the switching; evolution refines everything else.
   */
  private foundingBrain(): NeuralNet {
    const net = NeuralNet.random(BRAIN_SHAPE, this.rng);
    const s = this.config.instinct;
    if (s <= 0) return net;
    const { inputs: I, hidden: H } = BRAIN_SHAPE;
    const p = net.params;
    const w2 = H * I + H;
    const b2 = w2 + BRAIN_SHAPE.outputs * H;
    for (const [h, input] of [
      [0, 0],
      [1, 8],
    ]) {
      for (let i = 0; i < I; i++) p[h * I + i] *= 1 - s;
      p[H * I + h] *= 1 - s;
      p[h * I + input] += 2 * s;
      p[w2 + h] = 1.5 * s + p[w2 + h] * (1 - s);
    }
    p[b2 + 1] += 1.5 * s;
    return net;
  }

  private sameRealm(aTribeId: number, bTribeId: number): boolean {
    return this.tribes[aTribeId].realmId === this.tribes[bTribeId].realmId;
  }

  private relationKey(aRealmId: number, bRealmId: number): string {
    return aRealmId < bRealmId ? `${aRealmId}:${bRealmId}` : `${bRealmId}:${aRealmId}`;
  }

  private getRelation(aRealmId: number, bRealmId: number): RealmRelation | undefined {
    if (aRealmId === bRealmId) return undefined;
    return this.relations.get(this.relationKey(aRealmId, bRealmId));
  }

  getStance(aRealmId: number, bRealmId: number): DiplomaticStance {
    if (aRealmId === bRealmId) return 'trade';
    return this.getRelation(aRealmId, bRealmId)?.stance ?? 'neutral';
  }

  private isFriendlyRealm(aTribeId: number, bTribeId: number): boolean {
    const ra = this.tribes[aTribeId].realmId;
    const rb = this.tribes[bTribeId].realmId;
    if (ra === rb) return true;
    const stance = this.getStance(ra, rb);
    return stance === 'trade' || stance === 'alliance';
  }

  /** God-tool: spawn a lush berry grove near a camp and top up its food. */
  blessHarvest(tribeId: number): void {
    const t = this.tribes[tribeId];
    if (!t || t.extinct) return;
    const { x, y } = t.basePosition;
    for (let i = 0; i < 3; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(70, 125);
      this.addNode('food', x + Math.cos(a) * d, y + Math.sin(a) * d, 6, 8);
    }
    t.stockpile.food += 25;
    this.logEvent('festival', tribeId, `Bountiful harvest blessed ${t.name}`);
    this.revision++;
  }

  /** God-tool: immediately build a road from this camp to its capital or nearest peaceful neighbor. */
  sponsorRoad(tribeId: number): void {
    const t = this.tribes[tribeId];
    if (!t || t.extinct) return;
    const r = this.realms[t.realmId];
    let target: Tribe | null = null;
    if (r && r.capitalId !== t.id && !this.tribes[r.capitalId].extinct) {
      target = this.tribes[r.capitalId];
    } else {
      let bestD = Infinity;
      for (const o of this.tribes) {
        if (o.id === t.id || o.extinct) continue;
        if (this.getStance(t.realmId, o.realmId) === 'war') continue;
        const already = this.roads.some(
          (rd) => (rd.fromTribeId === t.id && rd.toTribeId === o.id) || (rd.fromTribeId === o.id && rd.toTribeId === t.id),
        );
        if (already) continue;
        const d = Math.hypot(o.basePosition.x - t.basePosition.x, o.basePosition.y - t.basePosition.y);
        if (d < bestD) {
          bestD = d;
          target = o;
        }
      }
    }
    if (!target) return;
    const existing = this.roads.find(
      (rd) => (rd.fromTribeId === t.id && rd.toTribeId === target!.id) || (rd.fromTribeId === target!.id && rd.toTribeId === t.id),
    );
    if (existing) {
      existing.built = true;
      existing.progress = existing.buildTicks;
    } else {
      this.roads.push({
        id: this.nextId++,
        realmId: t.realmId,
        fromTribeId: t.id,
        toTribeId: target.id,
        built: true,
        progress: ROAD_BUILD_TICKS,
        buildTicks: ROAD_BUILD_TICKS,
      });
    }
    this.logEvent('road', t.id, `Road opened between ${t.name} and ${target.name}`);
    this.revision++;
  }

  /** God-tool: set diplomatic stance between two realms. */
  setDiplomacy(aRealmId: number, bRealmId: number, stance: DiplomaticStance): void {
    if (aRealmId === bRealmId) return;
    const a = Math.min(aRealmId, bRealmId);
    const b = Math.max(aRealmId, bRealmId);
    const key = this.relationKey(a, b);
    const ra = this.realms[a];
    const rb = this.realms[b];
    if (!ra || !rb) return;
    this.relations.set(key, {
      a,
      b,
      stance,
      lastRaidDay: stance === 'war' ? this.day : -999,
      sinceDay: this.day,
    });
    const labelA = this.realmLabel(ra);
    const labelB = this.realmLabel(rb);
    if (stance === 'war') this.logEvent('war', ra.capitalId, `${labelA} & ${labelB} went to war`);
    else if (stance === 'trade') this.logEvent('trade', ra.capitalId, `${labelA} & ${labelB} signed a trade pact`);
    else if (stance === 'alliance') this.logEvent('alliance', ra.capitalId, `${labelA} & ${labelB} formed an alliance`);
    else this.logEvent('peace', ra.capitalId, `${labelA} & ${labelB} made peace`);
    this.revision++;
  }

  /** God-tool: hold a festival at a camp, boosting loyalty and energy. */
  triggerFestival(tribeId: number): void {
    const t = this.tribes[tribeId];
    if (!t || t.extinct) return;
    t.loyalty = clamp(t.loyalty + 0.15, 0, 1);
    for (const b of this.blobs) {
      if (b.tribeId === tribeId && b.state === 'active') b.energy = b.maxEnergy;
    }
    this.logEvent('festival', tribeId, `${t.name} held a grand festival`);
    this.revision++;
  }

  private recordHostility(attackerRealmId: number, victimRealmId: number): void {
    if (attackerRealmId === victimRealmId) return;
    const key = this.relationKey(attackerRealmId, victimRealmId);
    const a = Math.min(attackerRealmId, victimRealmId);
    const b = Math.max(attackerRealmId, victimRealmId);
    const existing = this.relations.get(key);
    if (existing) {
      existing.lastRaidDay = this.day;
      if (existing.stance !== 'war') {
        const wasTrade = existing.stance === 'trade';
        existing.stance = 'war';
        existing.sinceDay = this.day;
        const ra = this.realms[a];
        const rb = this.realms[b];
        if (ra && rb) {
          this.logEvent('war', ra.capitalId, `${this.realmLabel(ra)} & ${this.realmLabel(rb)} ${wasTrade ? 'broke trade into war' : 'went to war'}`);
        }
      }
    } else {
      this.relations.set(key, { a, b, stance: 'war', lastRaidDay: this.day, sinceDay: this.day });
      const ra = this.realms[a];
      const rb = this.realms[b];
      if (ra && rb) this.logEvent('war', ra.capitalId, `${this.realmLabel(ra)} & ${this.realmLabel(rb)} went to war`);
    }
  }

  private realmLabel(r: Realm): string {
    if (r.tier === 'empire') return `${r.name} Empire`;
    if (r.tier === 'kingdom') return `Kingdom of ${r.name}`;
    return r.name;
  }

  private createRealm(capital: Tribe): Realm {
    const realm: Realm = {
      id: this.realms.length,
      name: capital.name,
      color: capital.color,
      capitalId: capital.id,
      foundedDay: this.day,
      tier: 'chiefdom',
    };
    this.realms.push(realm);
    capital.realmId = realm.id;
    capital.loyalty = 1;
    return realm;
  }

  /** Recompute each realm's capital (if it fell) and tier, logging promotions. */
  private updateRealms(): void {
    const pops = this.tribePopulations();
    for (const r of this.realms) {
      const camps = this.tribes.filter((t) => !t.extinct && t.realmId === r.id);
      if (camps.length === 0) continue;

      if (this.tribes[r.capitalId].extinct) {
        camps.sort((a, b) => pops[b.id] - pops[a.id]);
        const nextCap = camps[0];
        r.capitalId = nextCap.id;
        r.name = nextCap.name;
        r.color = nextCap.color;
        nextCap.loyalty = 1;
      }

      const prevTier = r.tier;
      const capHasPalace = this.structures.some((s) => s.tribeId === r.capitalId && s.type === 'palace' && s.built);
      const nextTier: RealmTier =
        camps.length >= 4 || (camps.length >= 3 && capHasPalace) ? 'empire' : camps.length >= 2 ? 'kingdom' : 'chiefdom';
      r.tier = nextTier;
      const rank = { chiefdom: 0, kingdom: 1, empire: 2 } as const;
      if (rank[nextTier] > rank[prevTier]) {
        this.logEvent('realm', r.capitalId, `${this.realmLabel(r)} proclaimed (${camps.length} camps)`);
      }
    }
  }

  /** Vassal tribute, famine relief, conquest/vassalization, and loyalty/rebellion. */
  private processRealms(): void {
    const cfg = this.config;
    const pops = this.tribePopulations();

    // 1. Tribute & famine relief between vassals and their capital.
    for (const t of this.tribes) {
      if (t.extinct) continue;
      const r = this.realms[t.realmId];
      if (!r || r.capitalId === t.id) continue;
      const cap = this.tribes[r.capitalId];
      if (cap.extinct) continue;

      const pop = pops[t.id];
      const capPop = pops[cap.id];
      const surplusFloor = pop * cfg.ration * 5;
      if (t.stockpile.food > surplusFloor + pop * cfg.ration) {
        const tribute = (t.stockpile.food - surplusFloor) * 0.15;
        t.stockpile.food -= tribute;
        cap.stockpile.food += tribute;
      }

      const needed = pop * cfg.ration * 3 - t.stockpile.food;
      const capFloor = capPop * cfg.ration * 8;
      if (needed > 0 && cap.stockpile.food > capFloor) {
        const relief = Math.min(needed, (cap.stockpile.food - capFloor) * 0.25);
        cap.stockpile.food -= relief;
        t.stockpile.food += relief;
        t.loyalty = Math.min(1, t.loyalty + 0.05);
      }
    }

    // 2. Conquest: a heavily raided, weakened camp swears fealty to its attacker's realm.
    for (const t of this.tribes) {
      if (t.extinct || t.lastRaiderRealmId === null || t.raidPressure < 12) {
        t.raidPressure *= 0.8;
        continue;
      }
      const attackerRealm = this.realms[t.lastRaiderRealmId];
      if (!attackerRealm || attackerRealm.id === t.realmId || this.tribes[attackerRealm.capitalId].extinct) {
        t.raidPressure *= 0.8;
        continue;
      }
      const pop = pops[t.id];
      const attackerCapPop = pops[attackerRealm.capitalId];
      if (pop > 0 && (pop <= 8 || pop < attackerCapPop * 0.45)) {
        const oldRealm = this.realms[t.realmId];
        const wasCapital = oldRealm && oldRealm.capitalId === t.id;
        t.realmId = attackerRealm.id;
        t.loyalty = 0.65;
        t.raidPressure = 0;
        t.lastRaiderRealmId = null;
        this.logEvent('vassal', t.id, `${t.name} swore fealty to ${this.realmLabel(attackerRealm)}`);
        // If a capital was conquered, its other vassals break free into independent chiefdoms.
        if (wasCapital) {
          for (const other of this.tribes) {
            if (!other.extinct && other.id !== t.id && other.realmId === oldRealm.id) {
              this.createRealm(other);
              this.logEvent('rebel', other.id, `${other.name} broke free after ${t.name} fell`);
            }
          }
        }
      } else {
        t.raidPressure *= 0.8;
      }
    }

    // 3. Loyalty drift & rebellion for vassals.
    for (const t of this.tribes) {
      if (t.extinct) continue;
      const r = this.realms[t.realmId];
      if (!r || r.capitalId === t.id) {
        t.loyalty = 1;
        continue;
      }
      const cap = this.tribes[r.capitalId];
      if (cap.extinct) continue;
      const dist = Math.hypot(t.basePosition.x - cap.basePosition.x, t.basePosition.y - cap.basePosition.y);
      const pop = pops[t.id];
      const capPop = pops[cap.id];
      const hungry = t.stockpile.food < pop * cfg.ration * 2;
      let delta = dist > 550 ? -0.025 : dist > 350 ? -0.01 : 0.005;
      if (hungry) delta -= 0.04;
      if (pop > capPop * 1.15) delta -= 0.025;
      if (this.structures.some((s) => s.tribeId === t.id && s.type === 'monument' && s.built)) delta += 0.02;
      if (this.structures.some((s) => s.tribeId === cap.id && s.type === 'monument' && s.built)) delta += 0.01;
      if (this.structures.some((s) => s.tribeId === cap.id && s.type === 'palace' && s.built)) delta += 0.015;
      t.loyalty = clamp(t.loyalty + delta, 0, 1);

      if (t.loyalty <= 0.15 && this.day - t.foundedDay > 15) {
        const overlord = this.realmLabel(r);
        this.createRealm(t);
        this.logEvent('rebel', t.id, `${t.name} rebelled against ${overlord}`);
      }
    }

    // 4. Plan realm roads between capital and vassals, and between trading capitals.
    const tryPlanRoad = (a: Tribe, b: Tribe, realmId: number) => {
      const exists = this.roads.some(
        (rd) => (rd.fromTribeId === a.id && rd.toTribeId === b.id) || (rd.fromTribeId === b.id && rd.toTribeId === a.id),
      );
      if (exists) return;
      const payer =
        a.stockpile.timber >= ROAD_BUILD_COST && a.stockpile.stone >= ROAD_BUILD_COST
          ? a
          : b.stockpile.timber >= ROAD_BUILD_COST && b.stockpile.stone >= ROAD_BUILD_COST
            ? b
            : null;
      if (!payer) return;
      payer.stockpile.timber -= ROAD_BUILD_COST;
      payer.stockpile.stone -= ROAD_BUILD_COST;
      this.roads.push({
        id: this.nextId++,
        realmId,
        fromTribeId: a.id,
        toTribeId: b.id,
        built: false,
        progress: 0,
        buildTicks: ROAD_BUILD_TICKS,
      });
    };

    for (const t of this.tribes) {
      if (t.extinct) continue;
      const r = this.realms[t.realmId];
      if (!r || r.capitalId === t.id) continue;
      const cap = this.tribes[r.capitalId];
      if (!cap.extinct) tryPlanRoad(cap, t, r.id);
    }

    for (const rel of this.relations.values()) {
      if (rel.stance !== 'trade' && rel.stance !== 'alliance') continue;
      const ra = this.realms[rel.a];
      const rb = this.realms[rel.b];
      if (!ra || !rb) continue;
      const capA = this.tribes[ra.capitalId];
      const capB = this.tribes[rb.capitalId];
      if (capA && capB && !capA.extinct && !capB.extinct) tryPlanRoad(capA, capB, ra.id);
    }

    // Early-game frontier roads between nearby peaceful camps.
    if (this.day >= 5) {
      const living = this.tribes.filter((t) => !t.extinct);
      for (let i = 0; i < living.length; i++) {
        for (let j = i + 1; j < living.length; j++) {
          const a = living[i];
          const b = living[j];
          if (this.getStance(a.realmId, b.realmId) === 'war') continue;
          const d = Math.hypot(a.basePosition.x - b.basePosition.x, a.basePosition.y - b.basePosition.y);
          if (d <= 560) tryPlanRoad(a, b, a.realmId);
        }
      }
    }

    // Prune roads whose endpoints fell or went to war; pave highways once either town has modern industry.
    const isModernHub = (id: number) =>
      this.structures.some((s) => s.tribeId === id && s.built && (s.type === 'factory' || s.type === 'powerPlant' || s.type === 'skyscraper'));
    this.roads = this.roads.filter((rd) => {
      const a = this.tribes[rd.fromTribeId];
      const b = this.tribes[rd.toTribeId];
      if (a.extinct || b.extinct) return false;
      if (rd.built && !rd.paved && (isModernHub(a.id) || isModernHub(b.id))) rd.paved = true;
      return this.getStance(a.realmId, b.realmId) !== 'war';
    });

    // Late summer / fall Harvest Festivals for well-fed villages and towns.
    const doy = this.dayOfYear;
    if (doy >= cfg.yearLength * 0.55 && doy <= cfg.yearLength * 0.78) {
      for (const t of this.tribes) {
        if (t.extinct) continue;
        const pop = pops[t.id];
        if (this.settlementTier(pop) === 'camp') continue;
        if (t.stockpile.food > pop * cfg.ration * 14 && this.rng.next() < 0.08) {
          t.stockpile.food -= pop * cfg.ration * 1.2;
          t.loyalty = clamp(t.loyalty + 0.08, 0, 1);
          this.logEvent('festival', t.id, `${t.name} celebrated a Harvest Festival`);
        }
      }
    }

    this.updateRealms();
    this.processDiplomacy();
  }

  /** Peace after quiet years, trade pacts, alliances, and nightly caravan exchange. */
  private processDiplomacy(): void {
    const livingRealms = this.realms.filter((r) => this.tribes.some((t) => !t.extinct && t.realmId === r.id));
    const hasMarket = new Set<number>();
    for (const s of this.structures) {
      if (s.type === 'market' && s.built && !this.tribes[s.tribeId].extinct) {
        hasMarket.add(this.tribes[s.tribeId].realmId);
      }
    }

    for (let i = 0; i < livingRealms.length; i++) {
      for (let j = i + 1; j < livingRealms.length; j++) {
        const ra = livingRealms[i];
        const rb = livingRealms[j];
        const key = this.relationKey(ra.id, rb.id);
        let rel = this.relations.get(key);
        if (!rel) {
          rel = { a: Math.min(ra.id, rb.id), b: Math.max(ra.id, rb.id), stance: 'neutral', lastRaidDay: -999, sinceDay: this.day };
          this.relations.set(key, rel);
        }

        if (rel.stance === 'war' && this.day - rel.lastRaidDay >= 25) {
          rel.stance = 'neutral';
          rel.sinceDay = this.day;
          this.logEvent('peace', ra.capitalId, `${this.realmLabel(ra)} & ${this.realmLabel(rb)} made peace`);
        } else if (rel.stance === 'neutral' && this.day - rel.lastRaidDay >= 15 && hasMarket.has(ra.id) && hasMarket.has(rb.id)) {
          rel.stance = 'trade';
          rel.sinceDay = this.day;
          this.logEvent('trade', ra.capitalId, `${this.realmLabel(ra)} & ${this.realmLabel(rb)} signed a trade pact`);
        } else if (rel.stance === 'trade' && this.day - rel.sinceDay >= 20 && this.day - rel.lastRaidDay >= 25) {
          rel.stance = 'alliance';
          rel.sinceDay = this.day;
          this.logEvent('alliance', ra.capitalId, `${this.realmLabel(ra)} & ${this.realmLabel(rb)} forged an alliance`);
        }

        if (rel.stance === 'trade' || rel.stance === 'alliance') {
          const capA = this.tribes[ra.capitalId];
          const capB = this.tribes[rb.capitalId];
          if (!capA || !capB || capA.extinct || capB.extinct) continue;
          // Exchange complementary surpluses + small market prosperity bonus.
          for (const res of RESOURCE_TYPES) {
            const diff = capA.stockpile[res] - capB.stockpile[res];
            if (Math.abs(diff) > 10) {
              const shift = diff * 0.08;
              capA.stockpile[res] -= shift;
              capB.stockpile[res] += shift;
            }
          }
          const bonus = rel.stance === 'alliance' ? 2.2 : 1.5;
          capA.stockpile.food += bonus;
          capB.stockpile.food += bonus;
          capA.stockpile.timber += 0.5;
          capB.stockpile.timber += 0.5;
        }
      }
    }
  }

  private livingTribeCount(): number {
    return this.tribes.reduce((n, t) => n + (t.extinct ? 0 : 1), 0);
  }

  private addFx(
    kind: 'clash' | 'splash' | 'spark' | 'popup' | 'firework',
    x: number,
    y: number,
    color: string,
    extra: { tx?: number; ty?: number; text?: string } = {},
  ): void {
    this.visualFx.push({ kind, x, y, color, tick: this.tick, day: this.day, ...extra });
    if (this.visualFx.length > 140) this.visualFx.splice(0, this.visualFx.length - 140);
  }

  private logEvent(kind: WorldEvent['kind'], tribeId: number, text: string): void {
    this.events.push({ day: this.day, kind, tribeId, text });
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const t = this.tribes[tribeId];
    if (t) {
      this.directorFocus = { x: t.basePosition.x, y: t.basePosition.y, day: this.day, tick: this.tick };
      if (kind === 'realm' || kind === 'festival') {
        this.addFx('firework', t.basePosition.x, t.basePosition.y, t.color);
      }
    }
  }

  /** In summer, a crowded and well-fed tribe sends a splinter group off to found a new camp. */
  private trySplit(): void {
    const cfg = this.config;
    if (cfg.mode !== 'endless' || this.day < 30) return;
    if (this.dayOfYear >= cfg.yearLength * 0.55) return;
    if (this.livingTribeCount() >= cfg.maxTribes) return;

    for (const t of this.tribes) {
      if (t.extinct || this.day - t.lastSplitDay < 60) continue;
      const members = this.blobs.filter((b) => b.tribeId === t.id && b.state !== 'dead');
      const pop = members.length;
      if (pop < Math.max(cfg.splitMinPopulation, cfg.blobsPerTribe * 1.5)) continue;
      if (pop < this.housing(t.id) - 3) continue;
      if (t.stockpile.food < pop * cfg.ration * 8) continue;

      const site = this.findCampSite(t.basePosition);
      if (!site) continue;
      const child = this.foundTribe(site.x, site.y, 'split', t.id);
      this.ensureHomeResources(site.x, site.y);
      t.lastSplitDay = this.day;

      // Take every other member by fitness, so both camps keep some of the best.
      members.sort((a, b) => b.fitnessAvg - a.fitnessAvg);
      const groupSize = clamp(Math.round(pop * 0.4), 6, 14);
      for (let i = 1, moved = 0; i < members.length && moved < groupSize; i += 2, moved++) {
        members[i].tribeId = child.id;
        members[i].hunger = 0;
      }
      const food = t.stockpile.food * 0.35;
      t.stockpile.food -= food;
      child.stockpile.food = food;
      this.dayFounded++;
      this.logEvent('split', child.id, `${child.name} split from ${t.name}`);
      return;
    }
  }

  /** When the world empties out, a band of strangers descended from the best brains arrives. */
  private maybeWanderers(force = false): void {
    const cfg = this.config;
    if (cfg.mode !== 'endless' || (!force && this.day <= cfg.graceDays)) return;
    const living = this.livingTribeCount();
    if (living >= cfg.maxTribes) return;
    const worldPop = this.blobs.reduce((n, b) => n + (b.state !== 'dead' ? 1 : 0), 0);
    if (living >= 3 && worldPop >= cfg.blobsPerTribe * 2) return;
    if (worldPop > 0 && this.day - this.lastWandererDay < cfg.wandererCooldown) return;

    const site = this.findCampSite(null);
    if (!site) return;
    const tribe = this.foundTribe(site.x, site.y, 'wanderers', null);
    this.ensureHomeResources(site.x, site.y);
    tribe.stockpile.food = cfg.startingStockpile.food;
    this.lastWandererDay = this.day;

    const hof = this.hallOfFame;
    for (let i = 0; i < cfg.blobsPerTribe; i++) {
      let genes: Genes;
      let brain: NeuralNet;
      const m = Math.max(cfg.mutationRate, 0.05);
      if (hof.length > 0) {
        const src = hof[Math.floor(this.rng.next() * Math.min(hof.length, 12))];
        genes = { ...src.genes };
        for (const key of Object.keys(genes) as GeneKey[]) genes[key] *= 1 + m * this.rng.gaussian();
        genes = clampGenes(genes);
        brain = src.brain.cloneAndMutate(cfg.brainMutationProb, m * cfg.brainMutationScale, this.rng);
      } else {
        genes = clampGenes({
          maxSpeed: GENE_RANGES.maxSpeed.default,
          size: GENE_RANGES.size.default,
          senseRadius: GENE_RANGES.senseRadius.default,
          intelligence: GENE_RANGES.intelligence.default,
        });
        brain = this.foundingBrain();
      }
      const b = this.createBlob(tribe.id, genes, brain, null);
      b.x = site.x + this.rng.range(-20, 20);
      b.y = site.y + this.rng.range(-20, 20);
      this.blobs.push(b);
    }
    this.dayFounded++;
    this.logEvent('wanderers', tribe.id, `Wanderers settled as ${tribe.name}`);
  }

  private updateHallOfFame(): void {
    for (const b of this.blobs) {
      if (b.state === 'dead' || b.daysSurvived < 3 || b.fitnessAvg <= 0) continue;
      const existing = this.hallOfFame.find((e) => e.id === b.id);
      if (existing) existing.score = Math.max(existing.score, b.fitnessAvg);
      else this.hallOfFame.push({ id: b.id, genes: { ...b.genes }, brain: b.brain, score: b.fitnessAvg });
    }
    this.hallOfFame.sort((a, b) => b.score - a.score);
    if (this.hallOfFame.length > HALL_OF_FAME_SIZE) this.hallOfFame.length = HALL_OF_FAME_SIZE;
  }

  /** Abandoned outbuildings crumble a while after their tribe falls; the town center stays as a ruin. */
  private decayRuins(): void {
    const removedIds = new Set<number>();
    this.structures = this.structures.filter((s) => {
      if (s.type === 'townCenter') return true;
      const t = this.tribes[s.tribeId];
      const decay = t.extinct && t.fallenDay !== null && this.day - t.fallenDay > RUIN_DECAY_DAYS;
      if (decay) removedIds.add(s.id);
      return !decay;
    });
    if (removedIds.size > 0) this.removeFarmNodes(removedIds);
  }

  private removeFarmNodes(structureIds: Set<number>): void {
    let changed = false;
    this.nodes = this.nodes.filter((n) => {
      if (n.farmStructureId !== undefined && structureIds.has(n.farmStructureId)) {
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) {
      this.nodeGrid.clear();
      for (const n of this.nodes) this.nodeGrid.insert(n);
    }
  }

  private ensureFarmNode(s: Structure): void {
    const tribe = this.tribes[s.tribeId];
    const existing = this.nodes.find((n) => n.farmStructureId === s.id);
    if (existing) {
      existing.ownerRealmId = tribe.realmId;
      return;
    }
    const node = this.addNode('food', s.x, s.y, 6, 7);
    node.ownerRealmId = tribe.realmId;
    node.farmStructureId = s.id;
  }

  /** Keep long runs light: thin out older history once it gets long. */
  private compactHistory(): void {
    if (this.history.length <= MAX_HISTORY) return;
    const half = Math.floor(this.history.length / 2);
    const older = this.history.slice(0, half).filter((_, i) => i % 2 === 0);
    this.history = [...older, ...this.history.slice(half)];
  }

  private createBlob(tribeId: number, genes: Genes, brain: NeuralNet, parent: Blob | null): Blob {
    const id = this.nextId++;
    const tc = this.tribes[tribeId].basePosition;
    return {
      id,
      tribeId,
      lineageId: parent ? parent.lineageId : id,
      parentId: parent ? parent.id : null,
      generation: parent ? parent.generation + 1 : 0,
      genes,
      brain,
      x: tc.x,
      y: tc.y,
      angle: 0,
      velocity: 0,
      throttle: 0,
      turn: 0,
      coop: 0,
      radius: genes.size * this.config.baseRadius,
      energy: this.config.startEnergy,
      maxEnergy: this.config.startEnergy,
      cargo: { type: null, amount: 0 },
      hunger: 0,
      sheltered: false,
      state: 'active',
      deathCause: null,
      newborn: false,
      settledTick: 0,
      harvested: 0,
      delivered: 0,
      deliveredByType: emptyStock(),
      buildWork: 0,
      attacks: 0,
      kills: 0,
      coopSum: 0,
      activeTicks: 0,
      job: 'forager',
      role: 'idle',
      routeTargetTribeId: null,
      daysSurvived: 0,
      fitnessAvg: 0,
      // Founders get staggered lifespans so the first generation doesn't die off all at once.
      maxAge: Math.round(this.config.lifespan * this.rng.range(parent ? 0.75 : 0.3, 1.25)),
      spawnX: tc.x,
      spawnY: tc.y,
      maxDisplacement: 0,
      closestHomeLoaded: this.config.arenaSize,
      lastAttackTick: -999,
      lastGatherTick: -999,
      lastBuildTick: -999,
      sensed: { food: null, timber: null, stone: null, ally: null, threat: null },
    };
  }

  // ───────────────────────────── Day / night cycle ─────────────────────────────

  private startDay(): void {
    if (this.pendingConfig) {
      this.config = { ...this.config, ...this.pendingConfig };
      this.pendingConfig = null;
    }
    const cfg = this.config;

    this.blobs = this.blobs.filter((b) => b.state === 'active');
    if (this.blobs.length === 0 && cfg.mode === 'endless') this.maybeWanderers(true);
    if (this.blobs.length === 0) {
      this.phase = 'extinct';
      this.revision++;
      return;
    }

    this.day++;
    this.tick = 0;
    this.phase = 'day';
    this.dayBirths = 0;
    this.dayBackfilled = 0;
    this.dayFounded = 0;
    this.dayDeaths = { starved: 0, exhausted: 0, slain: 0, disease: 0, age: 0 };
    const doy = this.dayOfYear;

    if (this.season === 'winter' && this.winterStart === null) {
      this.winterStart = new Map(this.blobs.filter((b) => b.state === 'active').map((b) => [b.id, b.tribeId]));
    }

    for (const s of this.structures) {
      if (s.type === 'farm' && s.built && !this.tribes[s.tribeId].extinct) this.ensureFarmNode(s);
    }

    // Seasonal regrowth. Bushes regrow logistically: stripped bushes recover slowly, half-picked
    // ones fastest, and bushes left alone for a while grow lusher than they started.
    const growth = growthMultiplier(doy, cfg.yearLength);
    const bushRate = (cfg.foodPerDay / REFERENCE_BUSHES) * growth;
    for (const n of this.nodes) {
      if (n.type === 'food') {
        const f = n.amount / n.max;
        const fishMult = n.isFish ? Math.max(0.35, growth) : growth;
        const farmBonus = n.farmStructureId !== undefined ? 1.5 * growth : 0;
        const rate = n.isFish ? (cfg.foodPerDay / REFERENCE_BUSHES) * fishMult * 1.1 : bushRate;
        n.amount = Math.min(n.max, n.amount + rate * 1.6 * (0.5 + 2 * f) * (1 - f) + rate * 0.05 + farmBonus);
        const step = n.baseMax * 0.05;
        if (this.day - n.lastHarvestDay > LUSH_AFTER_DAYS) {
          if (growth > 0.5 && f > 0.95) n.max = Math.min(n.baseMax * LUSH_MAX, n.max + step);
        } else if (n.max > n.baseMax) {
          n.max = Math.max(n.baseMax, n.max - step);
          n.amount = Math.min(n.amount, n.max);
        }
      } else if (n.type === 'timber') n.amount = Math.min(n.max, n.amount + n.max * REGEN.timber * growth);
      else n.amount = Math.min(n.max, n.amount + n.max * REGEN.stone);
    }

    for (const t of this.tribes) t.deliveredToday = emptyStock();
    for (const s of this.structures) s.lastHitTick = -999;

    for (const b of this.blobs) {
      b.newborn = false;
      b.routeTargetTribeId = null;
      b.radius = b.genes.size * cfg.baseRadius;
      b.maxEnergy = cfg.startEnergy;
      b.energy = b.hunger > 0 ? cfg.startEnergy * 0.6 : cfg.startEnergy;
      b.cargo = { type: null, amount: 0 };
      b.velocity = 0;
      b.throttle = 0;
      b.turn = 0;
      b.harvested = 0;
      b.delivered = 0;
      b.deliveredByType = emptyStock();
      b.buildWork = 0;
      b.attacks = 0;
      b.kills = 0;
      b.coopSum = 0;
      b.activeTicks = 0;
      b.spawnX = b.x;
      b.spawnY = b.y;
      b.maxDisplacement = 0;
      b.closestHomeLoaded = cfg.arenaSize;
      b.sheltered = false;
      // Tick counters restart each morning.
      b.lastAttackTick = -999;
      b.lastGatherTick = -999;
      b.lastBuildTick = -999;
      const tc = this.tribes[b.tribeId].basePosition;
      b.angle = Math.atan2(b.y - tc.y, b.x - tc.x) + this.rng.range(-0.4, 0.4);
    }
    this.generationGenes = this.blobs.map((b) => ({ tribeId: b.tribeId, genes: b.genes }));
    this.revision++;
  }

  private endDay(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    const winter = this.season === 'winter';

    // Score and classify today's work before cargo is dropped.
    const fitness = new Map<Blob, number>();
    for (const b of this.blobs) {
      // Selection uses a running average so one lucky day doesn't decide who breeds.
      const today = this.fitness(b);
      b.fitnessAvg = b.daysSurvived === 0 ? today : b.fitnessAvg * 0.6 + today * 0.4;
      fitness.set(b, b.fitnessAvg);
      const meanCoop = b.activeTicks ? b.coopSum / b.activeTicks : 0;
      b.role =
        b.attacks > 0 && meanCoop < 0
          ? 'warrior'
          : b.buildWork > 20
            ? 'builder'
            : b.harvested > 0 || b.delivered > 0
              ? 'gatherer'
              : 'idle';
      b.cargo = { type: null, amount: 0 };
    }

    for (const tribe of this.tribes) {
      if (tribe.extinct) continue;
      const members = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active');
      const stock = tribe.stockpile;

      // Rations: the best contributors eat first; three hungry nights in a row is fatal.
      members.sort((a, b) => fitness.get(b)! - fitness.get(a)!);
      for (const b of members) {
        if (stock.food >= cfg.ration) {
          stock.food -= cfg.ration;
          b.hunger = 0;
        } else if (++b.hunger >= 3) {
          this.kill(b, 'starved');
        }
      }

      for (const b of members) {
        if (b.state === 'active' && b.daysSurvived + 1 >= b.maxAge) this.kill(b, 'age');
      }

      // Winter nights: anyone without a shelter bed risks disease (hospitals slash disease risk).
      const alive = members.filter((b) => b.state === 'active');
      if (winter) {
        const hasHospital = this.structures.some((s) => s.tribeId === tribe.id && s.type === 'hospital' && s.built);
        const diseaseChance = cfg.winterDiseaseChance * (hasHospital ? 0.2 : 1);
        const beds = this.housing(tribe.id) - cfg.housingBase;
        for (let i = beds; i < alive.length; i++) {
          if (this.rng.next() < diseaseChance) this.kill(alive[i], 'disease');
        }
      }

      // Modern industry & power grid output.
      const factories = this.structures.filter((s) => s.tribeId === tribe.id && s.type === 'factory' && s.built).length;
      const powered = this.structures.some((s) => s.tribeId === tribe.id && s.type === 'powerPlant' && s.built);
      if (factories > 0) {
        const mult = powered ? 1.6 : 1;
        stock.timber += factories * 2 * mult;
        stock.stone += factories * 2 * mult;
        stock.food += factories * 2.5 * mult;
      }

      // Spoilage of anything the granaries can't protect.
      const safe = this.safeFoodCapacity(tribe.id);
      if (stock.food > safe) stock.food = safe + (stock.food - safe) * (1 - cfg.spoilRate);

      const survivors = members.filter((b) => b.state === 'active');
      this.reproduce(tribe, survivors, fitness);
      this.backfill(tribe, fitness);
      this.planConstruction(tribe);

      const pop = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active').length;
      if (pop === 0 && (this.day > cfg.graceDays || tribe.origin !== 'founder')) {
        tribe.extinct = true;
        tribe.fallenDay = this.day;
        this.logEvent('fell', tribe.id, `${tribe.name} fell after ${this.day - tribe.foundedDay} days`);
      }
    }

    if (cfg.mode === 'endless') {
      this.trySplit();
      this.maybeWanderers();
      this.decayRuins();
      this.updateHallOfFame();
    }
    this.processRealms();

    // Camp for the night: survivors gather in rings around their Town Center, and tribes assign tomorrow's jobs.
    for (const tribe of this.tribes) {
      if (!tribe.extinct) this.assignJobs(tribe);
      const campers = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active');
      const tc = tribe.basePosition;
      let ring = 0;
      let placed = 0;
      for (const b of campers) {
        const r = STRUCTURE_SPECS.townCenter.radius + 12 + ring * 14;
        const slots = Math.max(6, Math.floor((2 * Math.PI * r) / 16));
        const a = (placed / slots) * Math.PI * 2 + ring * 0.3;
        b.x = clamp(tc.x + Math.cos(a) * r, 0, L);
        b.y = clamp(tc.y + Math.sin(a) * r, 0, L);
        b.angle = a;
        b.daysSurvived++;
        // Hunkered down for winter, blobs don't age; winter losses come from cold, hunger and raids.
        if (winter) b.maxAge++;
        if (++placed >= slots) {
          placed = 0;
          ring++;
        }
      }
    }

    if (winter && this.dayOfYear === cfg.yearLength - 1 && this.winterStart) {
      const end = this.tribePopulations();
      const startIds = this.winterStart;
      // Survival counts only blobs alive when winter began, so winter births and reseeds don't inflate it.
      const survivors = this.tribes.map(() => 0);
      for (const b of this.blobs) if (b.state === 'active' && startIds.has(b.id)) survivors[b.tribeId]++;
      const start = this.tribes.map(() => 0);
      for (const tribeId of startIds.values()) start[tribeId]++;
      this.winters.push({
        year: this.year,
        startPopulation: start.reduce((a, b) => a + b, 0),
        endPopulation: end.reduce((a, b) => a + b, 0),
        survived: survivors.reduce((a, b) => a + b, 0),
        tribeSurvival: start.map((s, i) => (s > 0 ? survivors[i] / s : null)),
      });
      this.winterStart = null;
    }

    this.history.push(this.computeStats());
    this.compactHistory();
    this.phase = 'night';
    this.nightCounter = 0;
    const standing = this.tribes.filter((t) => !t.extinct);
    if (standing.length === 0) this.phase = 'extinct';
    else if (cfg.mode === 'lastStanding' && standing.length === 1 && this.tribes.length > 1) {
      this.phase = 'won';
      this.winnerId = standing[0].id;
    }
    this.revision++;
  }

  private tribePopulations(): number[] {
    const pops = this.tribes.map(() => 0);
    for (const b of this.blobs) if (b.state === 'active') pops[b.tribeId]++;
    return pops;
  }

  private pickParent(pool: Blob[], fitness: Map<Blob, number>): Blob {
    let best = pool[Math.floor(this.rng.next() * pool.length)];
    for (let k = 0; k < 2; k++) {
      const c = pool[Math.floor(this.rng.next() * pool.length)];
      if ((fitness.get(c) ?? 0) > (fitness.get(best) ?? 0)) best = c;
    }
    return best;
  }

  private spawnChild(parent: Blob): Blob {
    const cfg = this.config;
    const m = cfg.mutationRate;
    const genes = {} as Genes;
    for (const key of Object.keys(parent.genes) as GeneKey[]) {
      genes[key] = parent.genes[key] * (1 + m * this.rng.gaussian());
    }
    const brain = parent.brain.cloneAndMutate(m > 0 ? cfg.brainMutationProb : 0, m * cfg.brainMutationScale, this.rng);
    const child = this.createBlob(parent.tribeId, clampGenes(genes), brain, parent);
    child.newborn = true;
    child.settledTick = this.tick;
    return child;
  }

  private reproduce(tribe: Tribe, survivors: Blob[], fitness: Map<Blob, number>): void {
    const cfg = this.config;
    if (survivors.length === 0) return;
    const winter = this.season === 'winter';
    const pop = survivors.length;
    // From midsummer on, tribes only breed out of food they won't need to see out the winter.
    const doy = this.dayOfYear;
    const daysToSpring = doy >= cfg.yearLength * 0.5 ? cfg.yearLength - doy : 0;
    const reserve = pop * cfg.ration * Math.max(3, daysToSpring * WINTER_RESERVE);
    const room = Math.min(
      this.housing(tribe.id) - pop,
      cfg.maxPopulation - this.blobs.filter((b) => b.state === 'active').length,
      Math.ceil(pop * (winter ? 0.04 : 0.25)),
    );
    const affordable = Math.floor((tribe.stockpile.food - reserve) / cfg.birthCost);
    const births = Math.min(room, affordable);
    for (let i = 0; i < births; i++) {
      tribe.stockpile.food -= cfg.birthCost;
      this.blobs.push(this.spawnChild(this.pickParent(survivors, fitness)));
      this.dayBirths++;
    }
  }

  /** Founding-era safety net: top up small tribes from their fittest members (alive or not). */
  private backfill(tribe: Tribe, fitness: Map<Blob, number>): void {
    const cfg = this.config;
    if (this.day > cfg.graceDays) return;
    const members = this.blobs.filter((b) => b.tribeId === tribe.id && !b.newborn);
    const alive = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active').length;
    const deficit = Math.min(cfg.minTribePopulation, cfg.blobsPerTribe) - alive;
    if (deficit <= 0 || members.length === 0) return;
    const ranked = [...members].sort((a, b) => (fitness.get(b) ?? 0) - (fitness.get(a) ?? 0));
    const pool = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.3)));
    for (let i = 0; i < deficit; i++) {
      this.blobs.push(this.spawnChild(this.pickParent(pool, fitness)));
      this.dayBackfilled++;
    }
  }

  /** Assign each living blob a job for the day based on the camp's current needs and the blob's build. */
  private assignJobs(tribe: Tribe): void {
    const members = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active');
    const n = members.length;
    if (n === 0) return;

    const cfg = this.config;
    const hasBlueprint = this.structures.some((s) => s.tribeId === tribe.id && !s.built);
    const raidedRecently = this.day - this.lastRaided[tribe.id] < 6 || cfg.aggressionBias < -0.2;
    const hungry = tribe.stockpile.food < n * cfg.ration * 8 || this.season === 'winter';
    const roadNeighbors = this.roads
      .filter((rd) => rd.built && (rd.fromTribeId === tribe.id || rd.toTribeId === tribe.id))
      .map((rd) => (rd.fromTribeId === tribe.id ? rd.toTribeId : rd.fromTribeId))
      .filter((id) => !this.tribes[id]?.extinct);

    let soldiers = n >= 6 ? Math.max(1, Math.round(n * (raidedRecently ? 0.25 : 0.1))) : 0;
    let builders = hasBlueprint ? Math.max(1, Math.round(n * 0.22)) : 0;
    let carriers = roadNeighbors.length > 0 && n >= 7 ? Math.min(2, Math.max(1, Math.floor(n * 0.1))) : 0;
    let scouts = n >= 9 ? 1 : 0;
    if (soldiers + builders + carriers + scouts > n - 1) {
      soldiers = Math.min(soldiers, Math.max(0, n - 1));
      builders = Math.min(builders, Math.max(0, n - 1 - soldiers));
      carriers = Math.min(carriers, Math.max(0, n - 1 - soldiers - builders));
      scouts = Math.min(scouts, Math.max(0, n - 1 - soldiers - builders - carriers));
    }
    const rest = n - soldiers - builders - carriers - scouts;
    const foragers = Math.max(1, Math.round(rest * (hungry ? 0.72 : 0.5)));
    const rem = Math.max(0, rest - foragers);
    const lumberjacks = Math.ceil(rem * 0.55);

    // Largest blobs take soldier duty; fastest/sharpest take scout & carrier; smartest take builder.
    const bySize = [...members].sort((a, b) => b.genes.size - a.genes.size);
    for (let i = 0; i < soldiers; i++) {
      bySize[i].job = 'soldier';
      bySize[i].routeTargetTribeId = null;
    }
    const afterSoldiers = bySize.slice(soldiers).sort((a, b) => b.genes.maxSpeed * b.genes.senseRadius - a.genes.maxSpeed * a.genes.senseRadius);
    for (let i = 0; i < scouts; i++) {
      afterSoldiers[i].job = 'scout';
      afterSoldiers[i].routeTargetTribeId = null;
    }
    for (let i = 0; i < carriers; i++) {
      const b = afterSoldiers[scouts + i];
      b.job = 'carrier';
      b.routeTargetTribeId = roadNeighbors[i % roadNeighbors.length];
    }
    const pool = afterSoldiers.slice(scouts + carriers).sort((a, b) => b.genes.intelligence - a.genes.intelligence);
    for (let i = 0; i < pool.length; i++) {
      pool[i].routeTargetTribeId = null;
      if (i < builders) pool[i].job = 'builder';
      else if (i < builders + foragers) pool[i].job = 'forager';
      else if (i < builders + foragers + lumberjacks) pool[i].job = 'lumberjack';
      else pool[i].job = 'miner';
    }
  }

  /** Tribe AI: when the stockpile covers a blueprint, reserve a slot and pay for it. */
  private planConstruction(tribe: Tribe): void {
    const cfg = this.config;
    const own = this.structures.filter((s) => s.tribeId === tribe.id);
    if (own.some((s) => !s.built)) return;
    const count = (t: StructureType) => own.filter((s) => s.type === t).length;
    const pop = this.blobs.filter((b) => b.tribeId === tribe.id && b.state === 'active').length;
    const tier = this.settlementTier(pop, tribe.id);
    const isModern = tier === 'town' || tier === 'city' || tier === 'metropolis';
    const realm = this.realms[tribe.realmId];
    const isMajorCapital = realm && realm.capitalId === tribe.id && realm.tier !== 'chiefdom';
    const raidedRecently = this.day - this.lastRaided[tribe.id] < 5;
    const nearRiver = this.distToRiver(tribe.basePosition.x, tribe.basePosition.y).dist < 320;
    const stock = tribe.stockpile;

    const wants: StructureType[] = [];
    if (count('shelter') < Math.min(STRUCTURE_SPECS.shelter.limit, Math.ceil(pop / cfg.shelterCapacity))) wants.push('shelter');
    if (count('granary') === 0 || (count('granary') < STRUCTURE_SPECS.granary.limit && stock.food > this.safeFoodCapacity(tribe.id) * 0.8)) {
      wants.push('granary');
    }
    if (tier !== 'camp' && count('farm') < STRUCTURE_SPECS.farm.limit) wants.push('farm');
    if (nearRiver && count('dock') < STRUCTURE_SPECS.dock.limit) wants.push('dock');
    if (nearRiver && count('bridge') < STRUCTURE_SPECS.bridge.limit) wants.push('bridge');
    if (tier !== 'camp' && count('workshop') < STRUCTURE_SPECS.workshop.limit) wants.push('workshop');
    if ((tier !== 'camp' || isMajorCapital) && count('market') < STRUCTURE_SPECS.market.limit) wants.push('market');
    if (count('barricade') < STRUCTURE_SPECS.barricade.limit && (raidedRecently || count('shelter') + count('granary') >= 2)) {
      wants.push('barricade');
    }
    if ((isModern || (tier === 'village' && raidedRecently)) && count('watchtower') < STRUCTURE_SPECS.watchtower.limit) {
      wants.push('watchtower');
    }
    if (isModern && count('powerPlant') < STRUCTURE_SPECS.powerPlant.limit) wants.push('powerPlant');
    if (isModern && count('factory') < STRUCTURE_SPECS.factory.limit) wants.push('factory');
    if (isModern && count('hospital') < STRUCTURE_SPECS.hospital.limit) wants.push('hospital');
    if (isModern && count('lab') < STRUCTURE_SPECS.lab.limit) wants.push('lab');
    if ((tier === 'city' || tier === 'metropolis') && count('skyscraper') < STRUCTURE_SPECS.skyscraper.limit) {
      wants.push('skyscraper');
    }
    if (isModern && count('monument') < STRUCTURE_SPECS.monument.limit) wants.push('monument');
    if (isMajorCapital && count('palace') < STRUCTURE_SPECS.palace.limit) wants.push('palace');

    for (const type of wants) {
      const cost = STRUCTURE_SPECS[type].cost;
      // Save up for the top priority rather than frittering materials on lesser builds.
      if (stock.timber < cost.timber || stock.stone < cost.stone) return;
      const slot = this.findSlot(tribe, type);
      if (!slot) continue;
      stock.timber -= cost.timber;
      stock.stone -= cost.stone;
      this.structures.push(this.makeStructure(tribe.id, type, slot[0], slot[1]));
      return;
    }
  }

  private findSlot(tribe: Tribe, type: StructureType): [number, number] | null {
    const L = this.config.arenaSize;
    const tc = tribe.basePosition;
    const toCenter = Math.atan2(L / 2 - tc.y, L / 2 - tc.x);
    const r = STRUCTURE_SPECS[type].radius;
    if (type === 'bridge') {
      const rv = this.distToRiver(tc.x, tc.y);
      if (rv.dist > 340) return null;
      const free = this.structures.every((s) => Math.hypot(s.x - rv.px, s.y - rv.py) > s.radius + r + 10);
      return free ? [clamp(rv.px, r + 4, L - r - 4), clamp(rv.py, r + 4, L - r - 4)] : null;
    }
    if (type === 'dock') {
      const rv = this.distToRiver(tc.x, tc.y);
      if (rv.dist > 340) return null;
      const ang = Math.atan2(tc.y - rv.py, tc.x - rv.px);
      for (const offset of [0, 0.35, -0.35, 0.7, -0.7]) {
        const dx = rv.px + Math.cos(ang + offset) * (rv.width * 0.5 + 4);
        const dy = rv.py + Math.sin(ang + offset) * (rv.width * 0.5 + 4);
        if (dx < r + 4 || dy < r + 4 || dx > L - r - 4 || dy > L - r - 4) continue;
        const free = this.structures.every((s) => Math.hypot(s.x - dx, s.y - dy) > s.radius + r + 6);
        if (free) return [dx, dy];
      }
      return null;
    }
    const candidates: [number, number][] = [];
    if (type === 'barricade' || type === 'watchtower') {
      // Defensive arc facing the contested centre.
      const dist = type === 'watchtower' ? 92 : 104;
      for (let i = 0; i < 8; i++) {
        const a = toCenter + (i - 3.5) * 0.36;
        candidates.push([tc.x + Math.cos(a) * dist, tc.y + Math.sin(a) * dist]);
      }
    } else if (type === 'farm') {
      for (let i = 0; i < 10; i++) {
        const a = toCenter + Math.PI + (i - 4.5) * 0.55;
        candidates.push([tc.x + Math.cos(a) * 84, tc.y + Math.sin(a) * 84]);
      }
    } else {
      for (const dist of [60, 82, 108]) {
        for (let i = 0; i < 12; i++) {
          const a = toCenter + Math.PI + (i - 5.5) * 0.52;
          candidates.push([tc.x + Math.cos(a) * dist, tc.y + Math.sin(a) * dist]);
        }
      }
    }
    for (const [x, y] of candidates) {
      if (x < r + 4 || y < r + 4 || x > L - r - 4 || y > L - r - 4) continue;
      const free = this.structures.every((s) => Math.hypot(s.x - x, s.y - y) > s.radius + r + 6);
      const clearOfNodes = this.nodes.every((n) => Math.hypot(n.x - x, n.y - y) > n.radius + r + 4);
      if (free && clearOfNodes) return [x, y];
    }
    return null;
  }

  private kill(b: Blob, cause: DeathCause): void {
    if (b.state === 'dead') return;
    b.state = 'dead';
    b.deathCause = cause;
    b.velocity = 0;
    b.settledTick = this.tick;
    this.dayDeaths[cause]++;
  }

  private computeStats(): GenerationStats {
    const alive = this.blobs.filter((b) => b.state === 'active');
    const n = alive.length;
    const mean = (k: GeneKey) => (n ? alive.reduce((s, b) => s + b.genes[k], 0) / n : 0);
    const roles: Record<BlobRole, number> = { gatherer: 0, builder: 0, warrior: 0, idle: 0 };
    const jobs: Record<BlobJob, number> = { forager: 0, lumberjack: 0, miner: 0, builder: 0, soldier: 0, carrier: 0, scout: 0 };
    for (const b of alive) {
      if (!b.newborn) {
        roles[b.role]++;
        jobs[b.job]++;
      }
    }
    const stockpile = emptyStock();
    const delivered = emptyStock();
    for (const t of this.tribes) {
      stockpile.food += t.stockpile.food;
      stockpile.timber += t.stockpile.timber;
      stockpile.stone += t.stockpile.stone;
      delivered.food += t.deliveredToday.food;
      delivered.timber += t.deliveredToday.timber;
      delivered.stone += t.deliveredToday.stone;
    }
    const builtNonTc = (tribeId?: number) =>
      this.structures.filter((s) => s.built && s.type !== 'townCenter' && (tribeId === undefined || s.tribeId === tribeId)).length;
    return {
      day: this.day,
      year: this.year,
      dayOfYear: this.dayOfYear,
      season: this.season,
      population: n,
      tribes: this.tribes.map((t) => ({
        population: alive.filter((b) => b.tribeId === t.id).length,
        stockpile: { ...t.stockpile },
        structures: builtNonTc(t.id),
        realmId: t.realmId,
      })),
      stockpile,
      structures: builtNonTc(),
      roles,
      jobs,
      deaths: { ...this.dayDeaths },
      born: this.dayBirths,
      backfilled: this.dayBackfilled,
      founded: this.dayFounded,
      livingTribes: this.livingTribeCount(),
      delivered,
      avgSpeed: mean('maxSpeed'),
      avgSize: mean('size'),
      avgSense: mean('senseRadius'),
      avgIntelligence: mean('intelligence'),
    };
  }

  // ───────────────────────────── Per-tick simulation ─────────────────────────────

  private simulateTick(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    const winter = this.season === 'winter';
    const envSeason = seasonIntensity(this.dayOfYear, cfg.yearLength);

    this.blobGrid.clear();
    for (const b of this.blobs) if (b.state === 'active') this.blobGrid.insert(b);

    this.structuresByTribe = this.tribes.map(() => []);
    this.barricades = [];
    for (const s of this.structures) {
      this.structuresByTribe[s.tribeId].push(s);
      if (s.type === 'barricade' && s.built) this.barricades.push(s);
    }

    if (winter) this.assignShelters();

    for (const b of this.blobs) {
      if (b.state !== 'active') continue;
      const tc = this.tribes[b.tribeId].basePosition;

      this.sense(b, tc.x, tc.y, envSeason);
      const out = b.brain.forward(this.inputs);
      b.turn = out[0] * cfg.maxTurn;
      b.throttle = (out[1] + 1) * 0.5;
      b.coop = clamp(out[2] + cfg.aggressionBias, -1, 1);
      b.coopSum += b.coop;
      b.activeTicks++;
      b.angle = wrapAngle(b.angle + b.turn);

      const speed = b.genes.maxSpeed * b.throttle;
      const roadBoost = this.roadBonus(b);
      b.velocity = speed * cfg.baseVelocity * roadBoost;
      const { size, senseRadius, intelligence } = b.genes;
      const baseDrain = cfg.cBase * (winter && !b.sheltered ? cfg.winterDrainMultiplier : 1);
      const moveDrain = size * size * size * speed * speed * cfg.cMove;
      b.energy -= moveDrain + senseRadius * cfg.cSense + intelligence * cfg.cBrain + baseDrain;
      if (b.energy <= 0) {
        b.energy = 0;
        this.kill(b, 'exhausted');
        continue;
      }

      const nx = clamp(b.x + Math.cos(b.angle) * b.velocity, 0, L);
      const ny = clamp(b.y + Math.sin(b.angle) * b.velocity, 0, L);
      const blocked = (x: number, y: number) => this.isInWater(x, y) && !this.onBuiltBridge(x, y);
      if (!blocked(nx, ny)) {
        b.x = nx;
        b.y = ny;
      } else if (!blocked(nx, b.y)) {
        b.x = nx;
      } else if (!blocked(b.x, ny)) {
        b.y = ny;
      } else {
        b.angle = wrapAngle(b.angle + Math.PI * 0.65);
      }
      this.blockByBarricades(b);

      const disp = Math.hypot(b.x - b.spawnX, b.y - b.spawnY);
      if (disp > b.maxDisplacement) b.maxDisplacement = disp;
      const dHome = Math.hypot(b.x - tc.x, b.y - tc.y);
      if (b.cargo.amount > 0 && dHome < b.closestHomeLoaded) b.closestHomeLoaded = dHome;

      this.interact(b, dHome);
    }

    if (this.tick % WATCHTOWER_COOLDOWN === 0) this.fireWatchtowers();
    if (this.towerShots.length > 0) {
      this.towerShots = this.towerShots.filter((sh) => this.tick - sh.tick <= 12);
    }
    if (this.visualFx.length > 0) {
      this.visualFx = this.visualFx.filter((fx) => {
        const age = (this.day - fx.day) * cfg.dayTicks + (this.tick - fx.tick);
        const maxAge = fx.kind === 'firework' ? 50 : fx.kind === 'popup' ? 28 : 18;
        return age >= 0 && age <= maxAge;
      });
    }

    for (const s of this.structures) {
      if (!s.built && s.health > 0) {
        s.progress += AUTO_BUILD_RATE;
        if (s.progress >= s.buildTicks) {
          s.built = true;
          if (s.type === 'farm') this.ensureFarmNode(s);
          if (s.type === 'dock') {
            const rv = this.distToRiver(s.x, s.y);
            const fish = this.addNode('food', rv.px, rv.py, 7, 9);
            fish.isFish = true;
          }
        }
      }
    }
    for (const rd of this.roads) {
      if (!rd.built) {
        rd.progress += AUTO_BUILD_RATE * 4;
        if (rd.progress >= rd.buildTicks) rd.built = true;
      }
    }
  }

  private roadBonus(b: Blob): number {
    const realmId = this.tribes[b.tribeId].realmId;
    for (const rd of this.roads) {
      if (!rd.built) continue;
      const rFrom = this.tribes[rd.fromTribeId].realmId;
      const rTo = this.tribes[rd.toTribeId].realmId;
      if (realmId !== rFrom && realmId !== rTo) continue;
      const a = this.tribes[rd.fromTribeId].basePosition;
      const c = this.tribes[rd.toTribeId].basePosition;
      const vx = c.x - a.x;
      const vy = c.y - a.y;
      const len2 = vx * vx + vy * vy;
      if (len2 === 0) continue;
      const t = clamp(((b.x - a.x) * vx + (b.y - a.y) * vy) / len2, 0, 1);
      const px = a.x + t * vx - b.x;
      const py = a.y + t * vy - b.y;
      if (px * px + py * py <= ROAD_HALF_WIDTH * ROAD_HALF_WIDTH) return rd.paved ? HIGHWAY_SPEED_BONUS : ROAD_SPEED_BONUS;
    }
    return 1;
  }

  private fireWatchtowers(): void {
    for (const s of this.structures) {
      if (s.type !== 'watchtower' || !s.built || this.tribes[s.tribeId].extinct) continue;
      let target: Blob | null = null;
      let bestD2 = WATCHTOWER_RANGE * WATCHTOWER_RANGE;
      this.blobGrid.query(s.x, s.y, WATCHTOWER_RANGE, (o, d2) => {
        if (o.state !== 'active' || this.isFriendlyRealm(o.tribeId, s.tribeId)) return;
        if (d2 < bestD2) {
          bestD2 = d2;
          target = o;
        }
      });
      const hit = target as Blob | null;
      if (!hit) continue;
      s.lastHitTick = this.tick;
      this.towerShots.push({ x1: s.x, y1: s.y, x2: hit.x, y2: hit.y, tick: this.tick, color: this.tribes[s.tribeId].color });
      hit.energy -= WATCHTOWER_DAMAGE;
      if (hit.energy <= 0) {
        hit.energy = 0;
        this.kill(hit, 'slain');
      }
    }
  }

  /** Fill `this.inputs` with the 13 normalised senses for blob `b`. */
  private sense(b: Blob, hx: number, hy: number, envSeason: number): void {
    const sense = b.genes.senseRadius;
    const inp = this.inputs;
    const nearest = this.nearestNode;
    const nearestD2 = this.nearestD2;
    for (const type of RESOURCE_TYPES) {
      nearest[type] = null;
      nearestD2[type] = Infinity;
    }
    const realmId = this.tribes[b.tribeId].realmId;
    this.nodeGrid.query(b.x, b.y, sense, (n, d2) => {
      if (n.amount < 1 || d2 >= nearestD2[n.type]) return;
      if (n.ownerRealmId !== undefined && n.ownerRealmId !== realmId) return;
      nearest[n.type] = n;
      nearestD2[n.type] = d2;
    });
    const angleTo = (x: number, y: number) => wrapAngle(Math.atan2(y - b.y, x - b.x) - b.angle) * INV_PI;
    // Higher intelligence sharpens perception; low intelligence adds slight sensory jitter.
    const noise = Math.max(0, 1.3 - b.genes.intelligence) * 0.14;
    const jitter = () => (noise > 0 ? this.rng.gaussian() * noise : 0);
    const types = RESOURCE_TYPES;
    // A full pack can't take more, so resources fade from attention until it's emptied.
    const packFull = b.cargo.amount >= this.carryCapacityFor(b.tribeId);
    for (let i = 0; i < 3; i++) {
      const n = packFull ? null : nearest[types[i]];
      b.sensed[types[i]] = n ? { x: n.x, y: n.y } : null;
      inp[i * 2] = n ? clamp(angleTo(n.x, n.y) + jitter(), -1, 1) : 0;
      inp[i * 2 + 1] = n ? clamp(1 - Math.min(1, Math.sqrt(nearestD2[types[i]]) / sense) + jitter(), 0, 1) : 0;
    }

    let ally: Blob | null = null;
    let allyD2 = Infinity;
    let threat: Blob | null = null;
    let threatD2 = Infinity;
    this.blobGrid.query(b.x, b.y, sense, (o, d2) => {
      if (o === b || o.state !== 'active') return;
      if (this.isFriendlyRealm(o.tribeId, b.tribeId)) {
        if (d2 < allyD2) {
          ally = o;
          allyD2 = d2;
        }
      } else if (d2 < threatD2) {
        threat = o;
        threatD2 = d2;
      }
    });
    const a = ally as Blob | null;
    const t = threat as Blob | null;
    b.sensed.ally = a ? { x: a.x, y: a.y } : null;
    b.sensed.threat = t ? { x: t.x, y: t.y } : null;
    inp[6] = a ? angleTo(a.x, a.y) : 0;
    inp[7] = t ? angleTo(t.x, t.y) : 0;

    const dHome = Math.hypot(hx - b.x, hy - b.y);
    // Carriers steer toward their road destination when loaded; scouts roam freely away from home.
    let steerX = hx;
    let steerY = hy;
    let steerDist = dHome;
    if (b.job === 'carrier' && b.routeTargetTribeId !== null && b.cargo.amount > 0) {
      const targetTribe = this.tribes[b.routeTargetTribeId];
      if (targetTribe && !targetTribe.extinct) {
        steerX = targetTribe.basePosition.x;
        steerY = targetTribe.basePosition.y;
        steerDist = Math.hypot(steerX - b.x, steerY - b.y);
      }
    }
    const homePull = b.job === 'scout' && b.cargo.amount === 0 ? 0.05 : b.cargo.amount > 0 ? 1 : EMPTY_HOME_PULL;
    inp[8] = steerDist < 1 ? 0 : angleTo(steerX, steerY) * homePull;
    inp[9] = 1 - Math.min(1, steerDist / HOME_SENSE_RANGE);
    inp[10] = envSeason;
    inp[11] = b.cargo.amount > 0 ? 1 : 0;
    inp[12] = clamp(b.energy / b.maxEnergy, 0, 1);
    inp[13] = 0;
    inp[14] = 0;
    inp[15] = 0;
    inp[16] = 0;
    inp[17] = 0;
    inp[18] = 0;
    inp[19] = 0;
    inp[JOB_INDEX[b.job]] = 1;

    // Scouts record rich wilderness sites for future expansion.
    if (b.job === 'scout' && dHome > 240 && this.tick % 40 === 0) {
      let score = 0;
      for (const type of RESOURCE_TYPES) if (nearest[type]) score += type === 'food' ? 3 : 2;
      if (score >= 4 && this.scoutedSites.every((sc) => Math.hypot(sc.x - b.x, sc.y - b.y) > 140)) {
        this.scoutedSites.push({ x: b.x, y: b.y, score, day: this.day });
        if (this.scoutedSites.length > 24) this.scoutedSites.shift();
      }
    }
  }

  private assignShelters(): void {
    const cap = this.config.shelterCapacity;
    for (const b of this.blobs) b.sheltered = false;
    for (const s of this.structures) {
      if (s.type !== 'shelter' || !s.built) continue;
      s.occupants = 0;
      this.blobGrid.query(s.x, s.y, s.radius + SHELTER_REACH, (b) => {
        if (s.occupants >= cap) return true;
        if (b.tribeId !== s.tribeId || b.sheltered || b.state !== 'active') return;
        b.sheltered = true;
        s.occupants++;
      });
    }
  }

  /** Hostile barricades are solid: push foreign blobs back out to their surface. */
  private blockByBarricades(b: Blob): void {
    for (const s of this.barricades) {
      if (this.sameRealm(s.tribeId, b.tribeId)) continue;
      const dx = b.x - s.x;
      const dy = b.y - s.y;
      const d = Math.hypot(dx, dy);
      const min = s.radius + b.radius;
      if (d >= min) continue;
      const nx = d > 0 ? dx / d : 1;
      const ny = d > 0 ? dy / d : 0;
      b.x = s.x + nx * min;
      b.y = s.y + ny * min;
    }
  }

  private interact(b: Blob, dHome: number): void {
    const cfg = this.config;
    const tribe = this.tribes[b.tribeId];
    const stock = tribe.stockpile;
    const own = this.structuresByTribe[b.tribeId];
    const tc = own.find((s) => s.type === 'townCenter')!;

    // Harvest whatever node we're touching (fish can be caught from the shoreline).
    const carryCap = this.carryCapacityFor(b.tribeId);
    if (b.cargo.amount < carryCap) {
      this.nodeGrid.query(b.x, b.y, b.radius + 26, (n, d2) => {
        if (n.amount < 1 || (b.cargo.type && b.cargo.type !== n.type)) return;
        if (n.ownerRealmId !== undefined && n.ownerRealmId !== tribe.realmId) return;
        const reach = b.radius + n.radius + (n.isFish ? 14 : 0);
        if (Math.sqrt(d2) > reach) return;
        const take = Math.min(carryCap - b.cargo.amount, Math.floor(n.amount));
        n.amount -= take;
        n.lastHarvestDay = this.day;
        // High intelligence gives a chance of efficient foraging (+1 bonus yield).
        const bonus =
          b.genes.intelligence > 1.1 && b.cargo.amount + take < carryCap && this.rng.next() < (b.genes.intelligence - 1) * 0.25 ? 1 : 0;
        b.cargo.type = n.type;
        b.cargo.amount += take + bonus;
        b.harvested += take + bonus;
        b.lastGatherTick = this.tick;
        if (n.isFish) this.addFx('splash', b.x, b.y, '#8ce0ff', { tx: n.x, ty: n.y });
        return true;
      });
    }

    // Carriers hauling along roads deliver to their destination camp.
    if (b.job === 'carrier' && b.routeTargetTribeId !== null && b.routeTargetTribeId !== b.tribeId) {
      const target = this.tribes[b.routeTargetTribeId];
      if (target && !target.extinct) {
        const dTarget = Math.hypot(b.x - target.basePosition.x, b.y - target.basePosition.y);
        if (dTarget <= STRUCTURE_SPECS.townCenter.radius + b.radius + DEPOSIT_REACH && b.cargo.type && b.cargo.amount > 0) {
          target.stockpile[b.cargo.type] += b.cargo.amount;
          target.deliveredToday[b.cargo.type] += b.cargo.amount;
          b.delivered += b.cargo.amount;
          b.deliveredByType[b.cargo.type] += b.cargo.amount;
          b.cargo = { type: null, amount: 0 };
          b.lastGatherTick = this.tick;
          b.routeTargetTribeId = null;
        }
      }
    }

    // Unload and refuel at our own Town Center.
    if (dHome <= tc.radius + b.radius + DEPOSIT_REACH) {
      if (b.cargo.type && b.cargo.amount > 0) {
        stock[b.cargo.type] += b.cargo.amount;
        tribe.deliveredToday[b.cargo.type] += b.cargo.amount;
        b.delivered += b.cargo.amount;
        b.deliveredByType[b.cargo.type] += b.cargo.amount;
        this.addFx('popup', tc.x + this.rng.range(-8, 8), tc.y - 16, RESOURCE_POPUP_COLOR[b.cargo.type], {
          text: `+${b.cargo.amount}`,
        });
        b.cargo = { type: null, amount: 0 };
        b.lastGatherTick = this.tick;
      } else if (b.job === 'carrier' && b.routeTargetTribeId !== null && b.routeTargetTribeId !== b.tribeId && stock.food >= 10) {
        // Load a courier parcel from home surplus to haul to a road neighbor.
        const take = Math.min(carryCap, 2);
        stock.food -= take;
        b.cargo = { type: 'food', amount: take };
        b.lastGatherTick = this.tick;
      }
      if (b.energy < b.maxEnergy * 0.5 && stock.food >= REFUEL_COST) {
        stock.food -= REFUEL_COST;
        b.energy = b.maxEnergy;
      }
    }

    if (b.coop >= cfg.cooperationThreshold) {
      // Builders: advance blueprints and repair damaged structures of our tribe (faster with intelligence + labs).
      const hasLab = own.some((s) => s.type === 'lab' && s.built);
      const workPower = (0.75 + b.genes.intelligence * 0.4) * (hasLab ? 1.25 : 1);
      for (const s of own) {
        if (Math.hypot(s.x - b.x, s.y - b.y) > s.radius + b.radius + BUILD_REACH) continue;
        if (!s.built) {
          s.progress += workPower;
          if (s.progress >= s.buildTicks) {
            s.built = true;
            if (s.type === 'farm') this.ensureFarmNode(s);
            if (s.type === 'dock') {
              const rv = this.distToRiver(s.x, s.y);
              const fish = this.addNode('food', rv.px, rv.py, 7, 9);
              fish.isFish = true;
            }
          }
        } else if (s.health < s.maxHealth) {
          s.health = Math.min(s.maxHealth, s.health + REPAIR_RATE * workPower);
        } else continue;
        b.buildWork += workPower;
        b.lastBuildTick = this.tick;
        if (this.tick % 4 === 0) this.addFx('spark', s.x, s.y, '#f5c451');
        break;
      }
    } else if (b.coop <= cfg.aggressionThreshold && this.tick - b.lastAttackTick >= cfg.attackCooldown) {
      this.attack(b);
    }
  }

  private attack(b: Blob): void {
    const cfg = this.config;
    let target: Blob | null = null;
    this.blobGrid.query(b.x, b.y, b.radius + GENE_RANGES.size.max * cfg.baseRadius, (o, d2) => {
      if (this.isFriendlyRealm(o.tribeId, b.tribeId) || o.state !== 'active') return;
      if (Math.sqrt(d2) > b.radius + o.radius + 2) return;
      target = o;
      return true;
    });

    const t = target as Blob | null;
    if (t) {
      b.lastAttackTick = this.tick;
      b.attacks++;
      this.lastRaided[t.tribeId] = this.day;
      const victim = this.tribes[t.tribeId];
      const attackerRealm = this.tribes[b.tribeId].realmId;
      victim.raidPressure = victim.lastRaiderRealmId === attackerRealm ? victim.raidPressure + 1 : 1;
      victim.lastRaiderRealmId = attackerRealm;
      this.recordHostility(attackerRealm, victim.realmId);
      this.addFx('clash', (b.x + t.x) / 2, (b.y + t.y) / 2, '#ff8a7a');
      this.directorFocus = { x: (b.x + t.x) / 2, y: (b.y + t.y) / 2, day: this.day, tick: this.tick };
      t.energy -= cfg.attackDamage * (b.genes.size / t.genes.size);
      // Steal their pack if ours is empty.
      if (t.cargo.amount > 0 && b.cargo.amount === 0) {
        b.cargo = { ...t.cargo };
        b.harvested += t.cargo.amount;
        t.cargo = { type: null, amount: 0 };
      }
      if (t.energy <= 0) {
        t.energy = 0;
        this.kill(t, 'slain');
        b.kills++;
      }
      return;
    }

    for (const s of this.structures) {
      if (this.isFriendlyRealm(s.tribeId, b.tribeId) || this.tribes[s.tribeId].extinct) continue;
      if (Math.hypot(s.x - b.x, s.y - b.y) > s.radius + b.radius + 2) continue;
      b.lastAttackTick = this.tick;
      b.attacks++;
      s.lastHitTick = this.tick;
      this.lastRaided[s.tribeId] = this.day;
      const victimTribe = this.tribes[s.tribeId];
      const attackerRealm = this.tribes[b.tribeId].realmId;
      victimTribe.raidPressure = victimTribe.lastRaiderRealmId === attackerRealm ? victimTribe.raidPressure + 2 : 2;
      victimTribe.lastRaiderRealmId = attackerRealm;
      this.recordHostility(attackerRealm, victimTribe.realmId);
      if (s.type === 'townCenter') {
        // Town Centers can't fall, but their stores can be looted.
        const victim = this.tribes[s.tribeId].stockpile;
        if (b.cargo.amount === 0 && victim.food >= 1) {
          const take = Math.min(this.config.carryCapacity, Math.floor(victim.food));
          victim.food -= take;
          b.cargo = { type: 'food', amount: take };
          b.harvested += take;
        }
        s.health = Math.max(1, s.health - cfg.attackDamage * 0.5);
      } else {
        s.health -= cfg.attackDamage * (b.genes.size / 1);
        if (s.health <= 0) {
          this.structures = this.structures.filter((x) => x !== s);
          if (s.type === 'farm') this.removeFarmNodes(new Set([s.id]));
        }
      }
      return;
    }
  }

  // ───────────────────────────── Save / Load ─────────────────────────────

  toJSON(): SavedSimulation {
    return {
      version: 1,
      config: { ...this.config },
      rngState: this.rng.getState(),
      day: this.day,
      tick: this.tick,
      phase: this.phase,
      winnerId: this.winnerId,
      nightCounter: this.nightCounter,
      nextId: this.nextId,
      lastWandererDay: this.lastWandererDay,
      lastRaided: [...this.lastRaided],
      dayBirths: this.dayBirths,
      dayBackfilled: this.dayBackfilled,
      dayFounded: this.dayFounded,
      dayDeaths: { ...this.dayDeaths },
      winterStart: this.winterStart ? [...this.winterStart.entries()] : null,
      tribes: this.tribes.map((t) => ({
        ...t,
        basePosition: { ...t.basePosition },
        stockpile: { ...t.stockpile },
        deliveredToday: { ...t.deliveredToday },
      })),
      realms: this.realms.map((r) => ({ ...r })),
      relations: [...this.relations.entries()].map(([k, v]) => [k, { ...v }]),
      roads: this.roads.map((rd) => ({ ...rd })),
      river: this.river.map((seg) => ({ ...seg })),
      lakes: this.lakes.map((lk) => ({ ...lk })),
      nodes: this.nodes.map((n) => ({ ...n })),
      structures: this.structures.map((s) => ({ ...s })),
      scoutedSites: this.scoutedSites.map((sc) => ({ ...sc })),
      history: this.history,
      winters: this.winters,
      events: this.events,
      blobs: this.blobs.map((b) => ({
        ...b,
        genes: { ...b.genes },
        cargo: { ...b.cargo },
        deliveredByType: { ...b.deliveredByType },
        sensed: { ...b.sensed },
        brainParams: Array.from(b.brain.params),
        brainShape: { ...b.brain.shape },
      })),
      hallOfFame: this.hallOfFame.map((h) => ({
        id: h.id,
        score: h.score,
        genes: { ...h.genes },
        brainParams: Array.from(h.brain.params),
        brainShape: { ...h.brain.shape },
      })),
    };
  }

  loadJSON(saved: SavedSimulation): void {
    if (!saved || saved.version !== 1 || !saved.config) throw new Error('Invalid save data');
    this.config = { ...DEFAULT_CONFIG, ...saved.config };
    this.pendingConfig = null;
    this.rng = new Random(this.config.seed);
    if (saved.rngState) this.rng.setState(saved.rngState);
    const L = this.config.arenaSize;
    this.blobGrid = new SpatialGrid(L, L, GRID_CELL);
    this.nodeGrid = new SpatialGrid(L, L, GRID_CELL);

    this.day = saved.day;
    this.tick = saved.tick;
    this.phase = saved.phase;
    this.winnerId = saved.winnerId;
    this.nightCounter = saved.nightCounter;
    this.nextId = saved.nextId;
    this.lastWandererDay = saved.lastWandererDay;
    this.lastRaided = [...saved.lastRaided];
    this.dayBirths = saved.dayBirths;
    this.dayBackfilled = saved.dayBackfilled;
    this.dayFounded = saved.dayFounded;
    this.dayDeaths = { ...saved.dayDeaths };
    this.winterStart = saved.winterStart ? new Map(saved.winterStart) : null;

    this.tribes = saved.tribes;
    this.realms = saved.realms;
    this.relations = new Map(saved.relations);
    this.roads = saved.roads;
    this.river = saved.river ?? [];
    this.lakes = saved.lakes ?? [];
    this.nodes = saved.nodes;
    for (const n of this.nodes) this.nodeGrid.insert(n);
    this.structures = saved.structures;
    this.scoutedSites = saved.scoutedSites ?? [];
    this.towerShots = [];
    this.history = saved.history;
    this.winters = saved.winters;
    this.events = saved.events;

    this.blobs = saved.blobs.map((raw) => {
      const { brainParams, brainShape, ...rest } = raw;
      const shape = brainShape?.inputs === BRAIN_SHAPE.inputs ? brainShape : BRAIN_SHAPE;
      const params =
        brainParams.length === shape.inputs * shape.hidden + shape.hidden + shape.outputs * shape.hidden + shape.outputs
          ? new Float32Array(brainParams)
          : undefined;
      const brain = new NeuralNet(shape, params);
      return { ...rest, brain };
    });

    this.hallOfFame = (saved.hallOfFame ?? []).map((h) => ({
      id: h.id,
      score: h.score,
      genes: h.genes,
      brain: new NeuralNet(h.brainShape ?? BRAIN_SHAPE, new Float32Array(h.brainParams)),
    }));
    this.generationGenes = this.blobs.filter((b) => b.state === 'active').map((b) => ({ tribeId: b.tribeId, genes: b.genes }));
    this.revision++;
  }
}

export interface SavedSimulation {
  version: 1;
  config: SimulationConfig;
  rngState: { state: number; spareGaussian: number | null };
  day: number;
  tick: number;
  phase: SimPhase;
  winnerId: number | null;
  nightCounter: number;
  nextId: number;
  lastWandererDay: number;
  lastRaided: number[];
  dayBirths: number;
  dayBackfilled: number;
  dayFounded: number;
  dayDeaths: Record<DeathCause, number>;
  winterStart: [number, number][] | null;
  tribes: Tribe[];
  realms: Realm[];
  relations: [string, RealmRelation][];
  roads: Road[];
  river: RiverSegment[];
  lakes: Lake[];
  nodes: ResourceNode[];
  structures: Structure[];
  scoutedSites: { x: number; y: number; score: number; day: number }[];
  history: GenerationStats[];
  winters: WinterRecord[];
  events: WorldEvent[];
  blobs: (Omit<Blob, 'brain'> & {
    brainParams: number[];
    brainShape: { inputs: number; hidden: number; outputs: number };
  })[];
  hallOfFame: {
    id: number;
    score: number;
    genes: Genes;
    brainParams: number[];
    brainShape: { inputs: number; hidden: number; outputs: number };
  }[];
}
