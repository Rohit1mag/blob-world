import { DEFAULT_CONFIG } from './config';
import { NN_INPUTS, NeuralNet } from './NeuralNet';
import { Random } from './random';
import { SpatialGrid } from './SpatialGrid';
import {
  GENE_RANGES,
  type Blob,
  type DayStatus,
  type Food,
  type GeneKey,
  type Genes,
  type GenerationStats,
  type SimPhase,
  type SimulationConfig,
} from './types';

const GRID_CELL = 50;
const FOOD_RADIUS = 4;
const HOME_EPSILON = 1.5;
const INV_PI = 1 / Math.PI;
/**
 * Backfill fitness for blobs that didn't make it home. Only the first pellet counts, so a
 * population where nobody returns isn't selected toward greedy foraging, and fed blobs are
 * rewarded for how close they got to the border.
 */
const FED_FOOD_SCORE = 15;
const HOMING_SHAPING = 20;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Energy per tick at a given actual speed (`maxSpeed × throttle`). */
export function energyDrain(genes: Genes, currentSpeed: number, cfg: SimulationConfig): number {
  const { size, senseRadius } = genes;
  return size * size * size * currentSpeed * currentSpeed * cfg.cMove + senseRadius * cfg.cSense + cfg.cBase;
}

export function clampGenes(g: Genes): Genes {
  return {
    maxSpeed: clamp(g.maxSpeed, GENE_RANGES.maxSpeed.min, GENE_RANGES.maxSpeed.max),
    size: clamp(g.size, GENE_RANGES.size.min, GENE_RANGES.size.max),
    senseRadius: clamp(g.senseRadius, GENE_RANGES.senseRadius.min, GENE_RANGES.senseRadius.max),
  };
}

/**
 * Headless, deterministic simulation. Has no knowledge of React or rendering:
 * callers advance it with `step()` at whatever rate they like and read state directly.
 */
export class SimulationEngine {
  config: SimulationConfig;
  private pendingConfig: Partial<SimulationConfig> | null = null;
  private rng: Random;

  blobs: Blob[] = [];
  food: Food[] = [];
  history: GenerationStats[] = [];
  /** Genes of the population as it started the current day (for distribution charts). */
  generationGenes: Genes[] = [];

  day = 0;
  tick = 0;
  phase: SimPhase = 'day';
  /** Bumped whenever `history` changes, so UI can cheaply detect new data. */
  revision = 0;

  private duskCounter = 0;
  private nextBlobId = 1;
  private nextFoodId = 1;
  private foodRemaining = 0;
  private dayPopulation = 0;
  private readonly inputs = new Float32Array(NN_INPUTS);

  private blobGrid: SpatialGrid<Blob>;
  private foodGrid: SpatialGrid<Food>;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new Random(this.config.seed);
    this.blobGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.foodGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.reset();
  }

  /** Restart from day 1 with a fresh founding population of random brains. */
  reset(config: Partial<SimulationConfig> = {}): void {
    this.config = { ...this.config, ...(this.pendingConfig ?? {}), ...config };
    this.pendingConfig = null;
    const size = this.config.arenaSize;
    this.blobGrid = new SpatialGrid(size, size, GRID_CELL);
    this.foodGrid = new SpatialGrid(size, size, GRID_CELL);
    this.rng = new Random(this.config.seed);
    this.nextBlobId = 1;
    this.nextFoodId = 1;
    this.day = 0;
    this.tick = 0;
    this.history = [];
    this.blobs = [];

    const v = this.config.initialVariance;
    for (let i = 0; i < this.config.initialPopulation; i++) {
      const genes = clampGenes({
        maxSpeed: GENE_RANGES.maxSpeed.default * (1 + v * this.rng.gaussian()),
        size: GENE_RANGES.size.default * (1 + v * this.rng.gaussian()),
        senseRadius: GENE_RANGES.senseRadius.default * (1 + v * this.rng.gaussian()),
      });
      this.blobs.push(this.createBlob(genes, NeuralNet.random(this.rng), null, 0));
    }

    this.history.push(
      this.computeStats(this.blobs, 0, {
        survived: 0,
        replicated: 0,
        starved: 0,
        eaten: 0,
        born: 0,
        homeRate: 0,
        avgFood: 0,
        backfilled: 0,
      }),
    );
    this.startDay();
  }

  /** Queue parameter changes; they are applied when the next day begins. */
  setConfig(partial: Partial<SimulationConfig>): void {
    this.pendingConfig = { ...(this.pendingConfig ?? {}), ...partial };
  }

  get pending(): Partial<SimulationConfig> | null {
    return this.pendingConfig;
  }

  /** 0 → 1 through the end-of-day pause; 0 during the day. */
  get duskProgress(): number {
    return this.phase === 'dusk' ? Math.min(1, this.duskCounter / Math.max(1, this.config.duskTicks)) : 0;
  }

  getStatus(): DayStatus {
    let active = 0;
    let home = 0;
    let dead = 0;
    for (const b of this.blobs) {
      if (b.outcome === 'newborn') continue;
      if (b.state === 'home') home++;
      else if (b.state === 'active') active++;
      else dead++;
    }
    return {
      day: this.day,
      phase: this.phase,
      tick: this.tick,
      total: active + home + dead,
      active,
      home,
      dead,
      foodRemaining: this.foodRemaining,
      foodTotal: this.food.length,
    };
  }

  /** Live score used by "Select Fittest": food dominates, energy breaks ties. */
  liveFitness(b: Blob): number {
    return b.foodEaten * 10 + b.kills * 5 + (b.energy / b.maxEnergy) * 2;
  }

  /** Highest-scoring blob still moving, falling back to the best survivor. */
  fittestBlob(): Blob | null {
    let best: Blob | null = null;
    let bestScore = -Infinity;
    for (const pass of ['active', 'home'] as const) {
      for (const b of this.blobs) {
        if (b.state !== pass || b.outcome === 'newborn') continue;
        const s = this.liveFitness(b);
        if (s > bestScore) {
          bestScore = s;
          best = b;
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Advance one fixed simulation step. */
  step(): void {
    if (this.phase === 'extinct') return;
    if (this.phase === 'dusk') {
      if (++this.duskCounter >= this.config.duskTicks) this.startDay();
      return;
    }
    this.tick++;
    this.simulateTick();
  }

  runTicks(n: number): void {
    for (let i = 0; i < n && this.phase !== 'extinct'; i++) this.step();
  }

  /** Run until the next day has begun (or the population is extinct). */
  advanceDay(): void {
    const target = this.day + 1;
    const guard = (this.config.maxDayTicks + this.config.duskTicks + 10) * 2;
    for (let i = 0; i < guard && this.day < target && this.phase !== 'extinct'; i++) this.step();
  }

  // ───────────────────────────── Day lifecycle ─────────────────────────────

  private createBlob(genes: Genes, brain: NeuralNet, parent: Blob | null, generation: number): Blob {
    const id = this.nextBlobId++;
    return {
      id,
      lineageId: parent ? parent.lineageId : id,
      parentId: parent ? parent.id : null,
      generation,
      genes,
      brain,
      x: parent ? parent.x : 0,
      y: parent ? parent.y : 0,
      angle: parent ? parent.angle : 0,
      velocity: 0,
      throttle: 0,
      turn: 0,
      radius: genes.size * this.config.baseRadius,
      energy: this.config.startEnergy,
      maxEnergy: this.config.startEnergy,
      foodEaten: 0,
      kills: 0,
      daysSurvived: 0,
      spawnX: 0,
      spawnY: 0,
      maxDisplacement: 0,
      closestEdgeFed: this.config.arenaSize / 2,
      seesFood: false,
      foodX: 0,
      foodY: 0,
      seesThreat: false,
      threatX: 0,
      threatY: 0,
      seesPrey: false,
      preyX: 0,
      preyY: 0,
      state: 'home',
      outcome: 'pending',
      settledTick: 0,
    };
  }

  private perimeterPoint(t: number): [number, number] {
    const L = this.config.arenaSize;
    const side = Math.floor(t / L) % 4;
    const s = t - Math.floor(t / L) * L;
    if (side === 0) return [s, 0];
    if (side === 1) return [L, s];
    if (side === 2) return [L - s, L];
    return [0, L - s];
  }

  private startDay(): void {
    if (this.pendingConfig) {
      this.config = { ...this.config, ...this.pendingConfig };
      this.pendingConfig = null;
    }
    const cfg = this.config;
    const L = cfg.arenaSize;

    this.blobs = this.blobs.filter((b) => b.outcome !== 'died');
    if (this.blobs.length === 0) {
      this.phase = 'extinct';
      this.revision++;
      return;
    }

    this.day++;
    this.tick = 0;
    this.phase = 'day';

    // Spread the population evenly around the perimeter, in shuffled order so
    // parents and offspring don't always start side by side.
    this.rng.shuffle(this.blobs);
    const perimeter = 4 * L;
    const offset = this.rng.next();
    const n = this.blobs.length;
    for (let i = 0; i < n; i++) {
      const b = this.blobs[i];
      const [x, y] = this.perimeterPoint((((i + offset) / n) * perimeter) % perimeter);
      b.x = b.spawnX = x;
      b.y = b.spawnY = y;
      b.angle = Math.atan2(L / 2 - y, L / 2 - x) + this.rng.range(-0.6, 0.6);
      b.velocity = 0;
      b.throttle = 0;
      b.turn = 0;
      b.radius = b.genes.size * cfg.baseRadius;
      b.energy = cfg.startEnergy;
      b.maxEnergy = cfg.startEnergy;
      b.foodEaten = 0;
      b.kills = 0;
      b.maxDisplacement = 0;
      b.closestEdgeFed = L / 2;
      b.seesFood = b.seesThreat = b.seesPrey = false;
      b.state = 'active';
      b.outcome = 'pending';
      b.settledTick = 0;
    }
    this.dayPopulation = n;
    this.generationGenes = this.blobs.map((b) => b.genes);

    this.food = [];
    this.foodGrid.clear();
    const lo = cfg.foodMargin;
    const hi = L - cfg.foodMargin;
    for (let i = 0; i < cfg.foodPerDay; i++) {
      const f: Food = { id: this.nextFoodId++, x: this.rng.range(lo, hi), y: this.rng.range(lo, hi), eaten: false };
      this.food.push(f);
      this.foodGrid.insert(f);
    }
    this.foodRemaining = this.food.length;
    this.revision++;
  }

  /** End-of-day score for ranking backfill parents; rewards progress even in failure. */
  private dayFitness(b: Blob): number {
    const L = this.config.arenaSize;
    if (b.state === 'home') return 100 + 20 * b.foodEaten;
    let score = FED_FOOD_SCORE * Math.min(b.foodEaten, 1) + 5 * (b.maxDisplacement / L);
    if (b.foodEaten > 0) score += HOMING_SHAPING * (1 - b.closestEdgeFed / (L / 2));
    return score;
  }

  private endDay(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    let survived = 0;
    let replicated = 0;
    let totalFood = 0;
    const nextGen: Blob[] = [];
    const fitness = new Map<Blob, number>();

    for (const b of this.blobs) {
      totalFood += b.foodEaten;
      fitness.set(b, this.dayFitness(b));
      if (b.state === 'home') {
        b.daysSurvived++;
        nextGen.push(b);
        if (b.foodEaten >= 2) {
          b.outcome = 'replicated';
          replicated++;
        } else {
          b.outcome = 'survived';
          survived++;
        }
      } else {
        b.outcome = 'died';
        if (b.state === 'active') {
          b.state = 'starved';
          b.settledTick = this.tick;
        }
      }
    }

    let starved = 0;
    let eaten = 0;
    for (const b of this.blobs) {
      if (b.outcome !== 'died') continue;
      if (b.state === 'eaten') eaten++;
      else starved++;
    }

    const offspring: Blob[] = [];
    let room = cfg.maxPopulation - nextGen.length;
    for (const parent of this.blobs) {
      if (parent.outcome !== 'replicated' || room <= 0) continue;
      room--;
      const child = this.spawnChild(parent);
      // Place the child beside its parent along the home edge.
      const along = parent.radius + child.radius + 2;
      const onVertical = parent.x <= HOME_EPSILON || parent.x >= L - HOME_EPSILON;
      child.x = clamp(parent.x + (onVertical ? 0 : along), 0, L);
      child.y = clamp(parent.y + (onVertical ? along : 0), 0, L);
      offspring.push(child);
    }

    // Population floor: refill from the day's fittest via tournament selection.
    const backfill: Blob[] = [];
    const deficit = cfg.minPopulation - (nextGen.length + offspring.length);
    if (deficit > 0) {
      const ranked = [...this.blobs].sort((a, b) => fitness.get(b)! - fitness.get(a)!);
      const pool = ranked.slice(0, Math.max(2, Math.ceil(ranked.length * 0.25)));
      for (let i = 0; i < deficit; i++) {
        const a = pool[Math.floor(this.rng.next() * pool.length)];
        const c = pool[Math.floor(this.rng.next() * pool.length)];
        const parent = fitness.get(a)! >= fitness.get(c)! ? a : c;
        const child = this.spawnChild(parent);
        const [x, y] = this.perimeterPoint(this.rng.next() * 4 * L);
        child.x = x;
        child.y = y;
        backfill.push(child);
      }
    }

    this.blobs.push(...offspring, ...backfill);
    nextGen.push(...offspring, ...backfill);

    const pop = Math.max(1, this.dayPopulation);
    this.history.push(
      this.computeStats(nextGen, this.day, {
        survived,
        replicated,
        starved,
        eaten,
        born: offspring.length,
        homeRate: (survived + replicated) / pop,
        avgFood: totalFood / pop,
        backfilled: backfill.length,
      }),
    );
    this.phase = 'dusk';
    this.duskCounter = 0;
    this.revision++;
  }

  private spawnChild(parent: Blob): Blob {
    const cfg = this.config;
    const strength = cfg.mutationRate * cfg.brainMutationScale;
    const prob = cfg.mutationRate > 0 ? cfg.brainMutationProb : 0;
    const child = this.createBlob(
      this.mutateGenes(parent.genes),
      parent.brain.cloneAndMutate(prob, strength, this.rng),
      parent,
      parent.generation + 1,
    );
    child.outcome = 'newborn';
    child.settledTick = this.tick;
    return child;
  }

  private mutateGenes(g: Genes): Genes {
    const m = this.config.mutationRate;
    const out = {} as Genes;
    for (const key of Object.keys(g) as GeneKey[]) {
      out[key] = g[key] * (1 + m * this.rng.gaussian());
    }
    return clampGenes(out);
  }

  private computeStats(
    pop: Blob[],
    day: number,
    counts: Pick<
      GenerationStats,
      'survived' | 'replicated' | 'starved' | 'eaten' | 'born' | 'homeRate' | 'avgFood' | 'backfilled'
    >,
  ): GenerationStats {
    const n = pop.length;
    const mean = (k: GeneKey) => (n ? pop.reduce((s, b) => s + b.genes[k], 0) / n : 0);
    const sd = (k: GeneKey, mu: number) =>
      n ? Math.sqrt(pop.reduce((s, b) => s + (b.genes[k] - mu) ** 2, 0) / n) : 0;
    const avgSpeed = mean('maxSpeed');
    const avgSize = mean('size');
    const avgSense = mean('senseRadius');
    return {
      day,
      population: n,
      foodPerDay: this.config.foodPerDay,
      avgSpeed,
      avgSize,
      avgSense,
      sdSpeed: sd('maxSpeed', avgSpeed),
      sdSize: sd('size', avgSize),
      sdSense: sd('senseRadius', avgSense),
      ...counts,
      dayTicks: this.tick,
    };
  }

  // ───────────────────────────── Per-tick physics ─────────────────────────────

  private simulateTick(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;

    this.blobGrid.clear();
    for (const b of this.blobs) {
      if (b.state === 'active') this.blobGrid.insert(b);
    }

    for (const b of this.blobs) {
      if (b.state !== 'active') continue;

      this.sense(b);
      const out = b.brain.forward(this.inputs);
      b.turn = out[0] * cfg.maxTurn;
      b.throttle = (out[1] + 1) * 0.5;
      b.angle = wrapAngle(b.angle + b.turn);

      const currentSpeed = b.genes.maxSpeed * b.throttle;
      b.velocity = currentSpeed * cfg.baseVelocity;
      b.energy -= energyDrain(b.genes, currentSpeed, cfg);
      if (b.energy <= 0) {
        b.energy = 0;
        this.kill(b, 'starved');
        continue;
      }

      b.x = clamp(b.x + Math.cos(b.angle) * b.velocity, 0, L);
      b.y = clamp(b.y + Math.sin(b.angle) * b.velocity, 0, L);
      const disp = Math.hypot(b.x - b.spawnX, b.y - b.spawnY);
      if (disp > b.maxDisplacement) b.maxDisplacement = disp;

      this.tryEat(b);

      const distEdge = Math.min(b.x, L - b.x, b.y, L - b.y);
      if (b.foodEaten > 0 && distEdge < b.closestEdgeFed) b.closestEdgeFed = distEdge;
      if (b.foodEaten > 0 && distEdge <= HOME_EPSILON) {
        b.state = 'home';
        b.velocity = 0;
        b.settledTick = this.tick;
      }
    }

    this.checkDayEnd();
  }

  /** Fill `this.inputs` with the 8 normalised senses for blob `b`. */
  private sense(b: Blob): void {
    const cfg = this.config;
    const sense = b.genes.senseRadius;
    const ratio = cfg.predationRatio;
    const inp = this.inputs;

    const food = this.foodGrid.nearest(b.x, b.y, sense, (f) => !f.eaten);
    b.seesFood = food !== null;
    if (food) {
      b.foodX = food.x;
      b.foodY = food.y;
      const d = Math.hypot(food.x - b.x, food.y - b.y);
      inp[0] = wrapAngle(Math.atan2(food.y - b.y, food.x - b.x) - b.angle) * INV_PI;
      inp[1] = 1 - Math.min(1, d / sense);
    } else {
      inp[0] = 0;
      inp[1] = 0;
    }

    let threat: Blob | null = null;
    let threatD2 = Infinity;
    let prey: Blob | null = null;
    let preyD2 = Infinity;
    if (cfg.predationEnabled) {
      this.blobGrid.query(b.x, b.y, sense, (o, d2) => {
        if (o === b || o.state !== 'active') return;
        if (o.genes.size >= b.genes.size * ratio) {
          if (d2 < threatD2) {
            threat = o;
            threatD2 = d2;
          }
        } else if (b.genes.size >= o.genes.size * ratio && d2 < preyD2) {
          prey = o;
          preyD2 = d2;
        }
      });
    }

    const t = threat as Blob | null;
    b.seesThreat = t !== null;
    if (t) {
      b.threatX = t.x;
      b.threatY = t.y;
      inp[2] = wrapAngle(Math.atan2(t.y - b.y, t.x - b.x) - b.angle) * INV_PI;
      inp[3] = 1 - Math.min(1, Math.sqrt(threatD2) / sense);
    } else {
      inp[2] = 0;
      inp[3] = 0;
    }

    const p = prey as Blob | null;
    b.seesPrey = p !== null;
    if (p) {
      b.preyX = p.x;
      b.preyY = p.y;
      inp[4] = wrapAngle(Math.atan2(p.y - b.y, p.x - b.x) - b.angle) * INV_PI;
    } else {
      inp[4] = 0;
    }

    const [hx, hy] = this.nearestEdgePoint(b);
    inp[5] = hx === b.x && hy === b.y ? 0 : wrapAngle(Math.atan2(hy - b.y, hx - b.x) - b.angle) * INV_PI;
    inp[6] = clamp(b.energy / b.maxEnergy, 0, 1);
    inp[7] = b.foodEaten >= 2 ? 1 : 0;
  }

  private kill(b: Blob, how: 'starved' | 'eaten'): void {
    b.state = how;
    b.velocity = 0;
    b.settledTick = this.tick;
  }

  private nearestEdgePoint(b: Blob): [number, number] {
    const L = this.config.arenaSize;
    const dl = b.x;
    const dr = L - b.x;
    const dt = b.y;
    const db = L - b.y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) return [0, b.y];
    if (m === dr) return [L, b.y];
    if (m === dt) return [b.x, 0];
    return [b.x, L];
  }

  private tryEat(b: Blob): void {
    const cfg = this.config;
    this.foodGrid.query(b.x, b.y, b.radius + FOOD_RADIUS, (f) => {
      if (f.eaten) return;
      f.eaten = true;
      this.foodRemaining--;
      b.foodEaten++;
    });

    if (cfg.predationEnabled) {
      this.blobGrid.query(b.x, b.y, b.radius, (o) => {
        if (o === b || o.state !== 'active') return;
        if (b.genes.size < o.genes.size * cfg.predationRatio) return;
        this.kill(o, 'eaten');
        b.foodEaten += cfg.preyFoodValue;
        b.kills++;
        b.energy = Math.min(b.energy + cfg.preyEnergyGain, b.maxEnergy * 1.5);
        return true;
      });
    }
  }

  private checkDayEnd(): void {
    let active = 0;
    for (const b of this.blobs) if (b.state === 'active') active++;

    // With the field empty and no predation possible, unfed blobs are already doomed.
    if (active > 0 && this.foodRemaining === 0 && !this.anyPredationPossible()) {
      for (const b of this.blobs) {
        if (b.state === 'active' && b.foodEaten === 0) {
          this.kill(b, 'starved');
          active--;
        }
      }
    }

    if (active > 0 && this.tick >= this.config.maxDayTicks) {
      for (const b of this.blobs) if (b.state === 'active') this.kill(b, 'starved');
      active = 0;
    }

    if (active === 0) this.endDay();
  }

  private anyPredationPossible(): boolean {
    if (!this.config.predationEnabled) return false;
    let minSize = Infinity;
    let maxSize = 0;
    for (const b of this.blobs) {
      if (b.state !== 'active') continue;
      if (b.genes.size < minSize) minSize = b.genes.size;
      if (b.genes.size > maxSize) maxSize = b.genes.size;
    }
    return maxSize >= minSize * this.config.predationRatio;
  }
}
