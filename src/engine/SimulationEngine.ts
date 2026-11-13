import { DEFAULT_CONFIG } from './config';
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
const TURN_RATE = 0.28;
const WANDER_JITTER = 0.14;
const WALL_AVOID_DIST = 45;
const RETURN_SAFETY = 1.15;
const RETURN_BUFFER = 1.5;
const HOME_EPSILON = 1.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function energyDrain(genes: Genes, cfg: SimulationConfig): number {
  const { size, speed, senseRadius } = genes;
  return size * size * size * speed * speed * cfg.cMove + senseRadius * cfg.cSense + cfg.cBase;
}

export function clampGenes(g: Genes): Genes {
  return {
    speed: clamp(g.speed, GENE_RANGES.speed.min, GENE_RANGES.speed.max),
    size: clamp(g.size, GENE_RANGES.size.min, GENE_RANGES.size.max),
    senseRadius: clamp(g.senseRadius, GENE_RANGES.senseRadius.min, GENE_RANGES.senseRadius.max),
  };
}

/**
 * Headless, deterministic simulation. Has no knowledge of React or rendering:
 * callers advance it with `tick()` at whatever rate they like and read state directly.
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

  private blobGrid: SpatialGrid<Blob>;
  private foodGrid: SpatialGrid<Food>;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = new Random(this.config.seed);
    this.blobGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.foodGrid = new SpatialGrid(this.config.arenaSize, this.config.arenaSize, GRID_CELL);
    this.reset();
  }

  /** Restart from day 1 with a fresh founding population. */
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
        speed: GENE_RANGES.speed.default * (1 + v * this.rng.gaussian()),
        size: GENE_RANGES.size.default * (1 + v * this.rng.gaussian()),
        senseRadius: GENE_RANGES.senseRadius.default * (1 + v * this.rng.gaussian()),
      });
      const blob = this.createBlob(genes, null, 0);
      blob.lineageId = blob.id;
      this.blobs.push(blob);
    }

    this.history.push(this.computeStats(this.blobs, 0, { survived: 0, replicated: 0, starved: 0, eaten: 0, born: 0 }));
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
      else if (b.state === 'starved' || b.state === 'eaten') dead++;
      else active++;
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
    const guard = this.config.maxDayTicks + this.config.duskTicks + 10;
    for (let i = 0; i < guard * 2 && this.day < target && this.phase !== 'extinct'; i++) this.step();
  }

  // ───────────────────────────── Day lifecycle ─────────────────────────────

  private createBlob(genes: Genes, parent: Blob | null, generation: number): Blob {
    const id = this.nextBlobId++;
    return {
      id,
      lineageId: parent ? parent.lineageId : id,
      parentId: parent ? parent.id : null,
      generation,
      genes,
      x: parent ? parent.x : 0,
      y: parent ? parent.y : 0,
      heading: 0,
      radius: genes.size * this.config.baseRadius,
      energy: this.config.startEnergy,
      maxEnergy: this.config.startEnergy,
      drain: energyDrain(genes, this.config),
      foodEaten: 0,
      kills: 0,
      daysSurvived: 0,
      state: 'home',
      mode: 'idle',
      targetX: 0,
      targetY: 0,
      outcome: 'pending',
      settledTick: 0,
    };
  }

  private startDay(): void {
    if (this.pendingConfig) {
      this.config = { ...this.config, ...this.pendingConfig };
      this.pendingConfig = null;
    }
    const cfg = this.config;
    const L = cfg.arenaSize;

    this.blobs = this.blobs.filter(
      (b) => b.outcome === 'pending' || b.outcome === 'survived' || b.outcome === 'replicated' || b.outcome === 'newborn',
    );
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
      const t = (((i + offset) / n) * perimeter) % perimeter;
      const side = Math.floor(t / L);
      const s = t - side * L;
      if (side === 0) { b.x = s; b.y = 0; }
      else if (side === 1) { b.x = L; b.y = s; }
      else if (side === 2) { b.x = L - s; b.y = L; }
      else { b.x = 0; b.y = L - s; }
      b.heading = Math.atan2(L / 2 - b.y, L / 2 - b.x) + this.rng.range(-0.6, 0.6);
      b.radius = b.genes.size * cfg.baseRadius;
      b.drain = energyDrain(b.genes, cfg);
      b.energy = cfg.startEnergy;
      b.maxEnergy = cfg.startEnergy;
      b.foodEaten = 0;
      b.kills = 0;
      b.state = 'foraging';
      b.mode = 'wander';
      b.targetX = b.x;
      b.targetY = b.y;
      b.outcome = 'pending';
      b.settledTick = 0;
    }
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

  private endDay(): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    let survived = 0;
    let replicated = 0;
    const offspring: Blob[] = [];
    const nextGen: Blob[] = [];

    for (const b of this.blobs) {
      if (b.state === 'home' && b.foodEaten >= 1) {
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
        if (b.state === 'home' || b.state === 'foraging' || b.state === 'returning') {
          b.state = 'starved';
          b.settledTick = this.tick;
        }
      }
    }

    let room = cfg.maxPopulation - nextGen.length;
    for (const parent of this.blobs) {
      if (parent.outcome !== 'replicated' || room <= 0) continue;
      room--;
      const child = this.createBlob(this.mutate(parent.genes), parent, parent.generation + 1);
      // Place the child beside its parent along the home edge.
      const along = parent.radius + child.radius + 2;
      const onVertical = parent.x <= HOME_EPSILON || parent.x >= L - HOME_EPSILON;
      child.x = clamp(parent.x + (onVertical ? 0 : along), 0, L);
      child.y = clamp(parent.y + (onVertical ? along : 0), 0, L);
      child.heading = parent.heading;
      child.outcome = 'newborn';
      child.settledTick = this.tick;
      offspring.push(child);
    }
    this.blobs.push(...offspring);
    nextGen.push(...offspring);

    let starved = 0;
    let eaten = 0;
    for (const b of this.blobs) {
      if (b.outcome !== 'died') continue;
      if (b.state === 'eaten') eaten++;
      else starved++;
    }
    this.history.push(
      this.computeStats(nextGen, this.day, { survived, replicated, starved, eaten, born: offspring.length }),
    );
    this.phase = 'dusk';
    this.duskCounter = 0;
    this.revision++;
  }

  private mutate(g: Genes): Genes {
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
    counts: Pick<GenerationStats, 'survived' | 'replicated' | 'starved' | 'eaten' | 'born'>,
  ): GenerationStats {
    const n = pop.length;
    const mean = (k: GeneKey) => (n ? pop.reduce((s, b) => s + b.genes[k], 0) / n : 0);
    const sd = (k: GeneKey, mu: number) =>
      n ? Math.sqrt(pop.reduce((s, b) => s + (b.genes[k] - mu) ** 2, 0) / n) : 0;
    const avgSpeed = mean('speed');
    const avgSize = mean('size');
    const avgSense = mean('senseRadius');
    return {
      day,
      population: n,
      foodPerDay: this.config.foodPerDay,
      avgSpeed,
      avgSize,
      avgSense,
      sdSpeed: sd('speed', avgSpeed),
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
      if (b.state === 'foraging' || b.state === 'returning') this.blobGrid.insert(b);
    }

    for (const b of this.blobs) {
      if (b.state !== 'foraging' && b.state !== 'returning') continue;

      b.energy -= b.drain;
      if (b.energy <= 0) {
        b.energy = 0;
        this.kill(b, 'starved');
        continue;
      }

      const distEdge = Math.min(b.x, L - b.x, b.y, L - b.y);
      const velocity = b.genes.speed * cfg.baseVelocity;

      if (b.state === 'foraging') {
        if (b.foodEaten >= 2) {
          b.state = 'returning';
        } else if (b.foodEaten >= 1) {
          const ticksHome = distEdge / velocity;
          if (b.energy <= ticksHome * b.drain * RETURN_SAFETY + RETURN_BUFFER) b.state = 'returning';
        }
      }

      if (b.state === 'returning') this.steerHome(b);
      else this.steerForage(b, velocity);

      b.x = clamp(b.x + Math.cos(b.heading) * velocity, 0, L);
      b.y = clamp(b.y + Math.sin(b.heading) * velocity, 0, L);

      if (b.state === 'returning') {
        if (Math.min(b.x, L - b.x, b.y, L - b.y) <= HOME_EPSILON) {
          this.snapToEdge(b);
          b.state = 'home';
          b.mode = 'idle';
          b.settledTick = this.tick;
        }
        continue;
      }

      this.tryEat(b);
    }

    this.checkDayEnd();
  }

  private kill(b: Blob, how: 'starved' | 'eaten'): void {
    b.state = how;
    b.mode = 'idle';
    b.settledTick = this.tick;
  }

  private turnToward(b: Blob, angle: number, instant: boolean): void {
    if (instant) {
      b.heading = angle;
      return;
    }
    const diff = wrapAngle(angle - b.heading);
    b.heading = wrapAngle(b.heading + clamp(diff, -TURN_RATE, TURN_RATE));
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

  private snapToEdge(b: Blob): void {
    const [x, y] = this.nearestEdgePoint(b);
    b.x = x;
    b.y = y;
  }

  private steerHome(b: Blob): void {
    const [tx, ty] = this.nearestEdgePoint(b);
    b.mode = 'home';
    b.targetX = tx;
    b.targetY = ty;
    this.turnToward(b, Math.atan2(ty - b.y, tx - b.x), true);
  }

  private steerForage(b: Blob, velocity: number): void {
    const cfg = this.config;
    const L = cfg.arenaSize;
    const sense = b.genes.senseRadius;
    const ratio = cfg.predationRatio;

    let fleeX = 0;
    let fleeY = 0;
    let threatened = false;
    let prey: Blob | null = null;
    let preyD2 = Infinity;

    if (cfg.predationEnabled) {
      this.blobGrid.query(b.x, b.y, sense, (o, d2) => {
        if (o === b || (o.state !== 'foraging' && o.state !== 'returning')) return;
        if (o.genes.size >= b.genes.size * ratio) {
          const d = Math.sqrt(d2) || 1;
          fleeX += (b.x - o.x) / (d * d);
          fleeY += (b.y - o.y) / (d * d);
          threatened = true;
        } else if (b.genes.size >= o.genes.size * ratio && d2 < preyD2) {
          prey = o;
          preyD2 = d2;
        }
      });
    }

    if (threatened) {
      // A blob that already has a meal heads for safety rather than running blind.
      if (b.foodEaten >= 1) {
        b.state = 'returning';
        this.steerHome(b);
        return;
      }
      b.mode = 'flee';
      b.targetX = b.x + fleeX * 4000;
      b.targetY = b.y + fleeY * 4000;
      let ang = Math.atan2(fleeY, fleeX);
      const nearWall = Math.min(b.x, L - b.x, b.y, L - b.y) < WALL_AVOID_DIST;
      if (nearWall) {
        // Slide along the wall instead of pinning against it.
        const toCenter = Math.atan2(L / 2 - b.y, L / 2 - b.x);
        ang = Math.atan2(Math.sin(ang) + Math.sin(toCenter) * 0.6, Math.cos(ang) + Math.cos(toCenter) * 0.6);
      }
      this.turnToward(b, ang, false);
      return;
    }

    const food = this.foodGrid.nearest(b.x, b.y, sense, (f) => !f.eaten);
    let tx = 0;
    let ty = 0;
    let targetD2 = Infinity;
    if (food) {
      targetD2 = (food.x - b.x) ** 2 + (food.y - b.y) ** 2;
      tx = food.x;
      ty = food.y;
      b.mode = 'food';
    }
    // Prey is worth more than a pellet, so it wins unless it is much further away.
    const p = prey as Blob | null;
    if (p && preyD2 / (cfg.preyFoodValue * cfg.preyFoodValue) < targetD2) {
      targetD2 = preyD2;
      tx = p.x;
      ty = p.y;
      b.mode = 'hunt';
    }

    if (targetD2 < Infinity) {
      b.targetX = tx;
      b.targetY = ty;
      const close = targetD2 < (velocity * 5) ** 2;
      this.turnToward(b, Math.atan2(ty - b.y, tx - b.x), close);
      return;
    }

    b.mode = 'wander';
    let ang = b.heading + this.rng.gaussian() * WANDER_JITTER;
    const distEdge = Math.min(b.x, L - b.x, b.y, L - b.y);
    if (distEdge < WALL_AVOID_DIST + b.radius) {
      const toCenter = Math.atan2(L / 2 - b.y, L / 2 - b.x);
      this.turnToward(b, toCenter + this.rng.range(-0.8, 0.8), false);
    } else {
      b.heading = wrapAngle(ang);
    }
    b.targetX = b.x + Math.cos(b.heading) * Math.min(sense, 60);
    b.targetY = b.y + Math.sin(b.heading) * Math.min(sense, 60);
  }

  private tryEat(b: Blob): void {
    const cfg = this.config;
    const reach = b.radius + FOOD_RADIUS;
    this.foodGrid.query(b.x, b.y, reach, (f) => {
      if (f.eaten) return;
      f.eaten = true;
      this.foodRemaining--;
      b.foodEaten++;
      return b.foodEaten >= 2;
    });

    if (cfg.predationEnabled) {
      this.blobGrid.query(b.x, b.y, b.radius, (o) => {
        if (o === b || (o.state !== 'foraging' && o.state !== 'returning')) return;
        if (b.genes.size < o.genes.size * cfg.predationRatio) return;
        this.kill(o, 'eaten');
        b.foodEaten += cfg.preyFoodValue;
        b.kills++;
        b.energy = Math.min(b.energy + cfg.preyEnergyGain, b.maxEnergy * 1.5);
        return true;
      });
    }

    if (b.foodEaten >= 2) b.state = 'returning';
  }

  private checkDayEnd(): void {
    let active = 0;
    let fed = 0;
    for (const b of this.blobs) {
      if (b.state === 'foraging' || b.state === 'returning') {
        active++;
        if (b.foodEaten > 0) fed++;
      }
    }

    if (active > 0 && this.foodRemaining === 0) {
      // Field is empty: anyone with a meal heads home; the unfed can only win by predation.
      for (const b of this.blobs) {
        if (b.state === 'foraging' && b.foodEaten > 0) b.state = 'returning';
      }
      if (fed === 0 && !this.anyPredationPossible()) {
        for (const b of this.blobs) {
          if (b.state === 'foraging' || b.state === 'returning') this.kill(b, 'starved');
        }
        active = 0;
      }
    }

    if (active > 0 && this.tick >= this.config.maxDayTicks) {
      for (const b of this.blobs) {
        if (b.state === 'foraging' || b.state === 'returning') this.kill(b, 'starved');
      }
      active = 0;
    }

    if (active === 0) this.endDay();
  }

  private anyPredationPossible(): boolean {
    if (!this.config.predationEnabled) return false;
    const r = this.config.predationRatio;
    let minSize = Infinity;
    let maxSize = 0;
    for (const b of this.blobs) {
      if (b.state !== 'foraging') continue;
      if (b.genes.size < minSize) minSize = b.genes.size;
      if (b.genes.size > maxSize) maxSize = b.genes.size;
    }
    return maxSize >= minSize * r;
  }
}
