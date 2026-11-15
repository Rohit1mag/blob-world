import { NeuralNet, type NetShape } from './NeuralNet';
import { Random } from './random';
import { SpatialGrid } from './SpatialGrid';

/** Corporate brain: 10 senses → 7 hidden → utility of working, taking a break, networking. */
export const CORP_BRAIN_SHAPE: NetShape = { inputs: 10, hidden: 7, outputs: 3 };
export const CORP_INPUT_LABELS = [
  'energy',
  'burnout',
  'execution',
  'charisma',
  'politics',
  'resilience',
  'seniority',
  'bosses near',
  'clout share',
  'kpi share',
] as const;
export const CORP_OUTPUT_LABELS = ['work', 'break', 'network'] as const;

export const TRAIT_MIN = 0.1;
export const TRAIT_MAX = 1;
export const TRAITS = ['execution', 'charisma', 'politics', 'resilience'] as const;
export type Trait = (typeof TRAITS)[number];
export type CareerTraits = Record<Trait, number>;
/** Aura colour for the dominant of the three "style" traits; resilience is shown by posture, not colour. */
export const TRAIT_COLORS = { execution: '#4fe3f0', charisma: '#ff5fd2', politics: '#ffb347', resilience: '#8be3b0' } as const;

export type Activity = 'work' | 'break' | 'network';
export type DepartureCause = 'burnout' | 'layoff' | 'pip' | 'retired';
export type WorkTask = 'standard' | 'launch' | 'maintenance';

/** Promotion weights for one step, as [execution→KPI, charisma→Visibility, politics→PoliticalCredit]. */
export type PromotionWeights = readonly [number, number, number];

export type CultureId = 'bigtech' | 'startup' | 'megacorp' | 'quant';

export interface CultureMods {
  kpiMultiplier: number;
  burnoutMultiplier: number;
  /** Big Tech: desks hand out Greenfield Launch vs. Maintenance tasks. */
  greenfield: boolean;
  /** Startup: one product pivot per fiscal year wipes unbanked KPI. */
  pivots: boolean;
  /** Megacorp: IC output drops 40% without a Manager or Director nearby. */
  redTape: boolean;
  siphonMultiplier: number;
  /** Quant: mixers award no Visibility or PoliticalCredit. */
  noMeetings: boolean;
  /** Share of every floor demoted or cut at each review (0 = Floor 1 layoffs only). */
  cullPct: number;
}

export interface CulturePreset {
  id: CultureId;
  name: string;
  mechanic: string;
  description: string;
  /** Five steps: F1→F2 … F5→F6. */
  curve: readonly PromotionWeights[];
  mods: CultureMods;
}

const BASE_MODS: CultureMods = {
  kpiMultiplier: 1,
  burnoutMultiplier: 1,
  greenfield: false,
  pivots: false,
  redTape: false,
  siphonMultiplier: 1,
  noMeetings: false,
  cullPct: 0,
};

export const CULTURE_PRESETS: CulturePreset[] = [
  {
    id: 'bigtech',
    name: 'Big Tech',
    mechanic: 'Promo-Driven Development',
    description: 'Greenfield launches earn 2.5× visibility; maintenance earns 1.2× KPI but 0.1× visibility. Narrative overtakes output from Manager up.',
    curve: [
      [0.85, 0.1, 0.05],
      [0.65, 0.25, 0.1],
      [0.4, 0.35, 0.25],
      [0.2, 0.45, 0.35],
      [0.15, 0.45, 0.4],
    ],
    mods: { ...BASE_MODS, greenfield: true },
  },
  {
    id: 'startup',
    name: 'Hyper-Growth Startup',
    mechanic: 'Crunch & Pivots',
    description: '1.8× KPI speed, 1.7× burnout. Once a fiscal year a product pivot wipes 25% of unbanked KPI unless resilience or charisma is high.',
    curve: [
      [0.9, 0.1, 0],
      [0.85, 0.15, 0],
      [0.75, 0.2, 0.05],
      [0.65, 0.25, 0.1],
      [0.6, 0.3, 0.1],
    ],
    mods: { ...BASE_MODS, kpiMultiplier: 1.8, burnoutMultiplier: 1.7, pivots: true },
  },
  {
    id: 'megacorp',
    name: 'Legacy Megacorp',
    mechanic: 'Red Tape & Credit Siphoning',
    description: 'IC desks lose 40% output without a Manager or Director nearby, and credit siphoning at mixers is 2× as effective.',
    curve: [
      [0.5, 0.3, 0.2],
      [0.35, 0.35, 0.3],
      [0.2, 0.35, 0.45],
      [0.1, 0.35, 0.55],
      [0.05, 0.35, 0.6],
    ],
    mods: { ...BASE_MODS, redTape: true, siphonMultiplier: 2 },
  },
  {
    id: 'quant',
    name: 'Quant Meritocracy',
    mechanic: 'No-Meeting Culture',
    description: 'Mixers award nothing; promotions ride raw KPI, and the bottom 15% of every floor (VPs included) is demoted or cut each quarter.',
    curve: Array.from({ length: 5 }, () => [0.95, 0.05, 0] as const),
    mods: { ...BASE_MODS, noMeetings: true, cullPct: 0.15 },
  },
];

export const CULTURES = Object.fromEntries(CULTURE_PRESETS.map((c) => [c.id, c])) as Record<CultureId, CulturePreset>;

export interface CorporateConfig {
  seed: number;
  /** Ticks per quarter (one generation). */
  quarterTicks: number;
  culture: CultureId;
  /** Scales how far each floor's weights drift from the Floor 1 curve (0.5–2). */
  politicsSteepness: number;
  /** Share of Floor 1 laid off at each review. */
  layoffPct: number;
  /** Breakroom energy regen multiplier. */
  espressoPerk: number;
  /** σ of trait noise for new hires. */
  mutationRate: number;
  /** Weight of hand-tuned common sense added to the brain's raw outputs. */
  instinct: number;
}

export const DEFAULT_CORPORATE_CONFIG: CorporateConfig = {
  seed: 1,
  quarterTicks: 1200,
  culture: 'bigtech',
  politicsSteepness: 1,
  layoffPct: 0.1,
  espressoPerk: 1,
  mutationRate: 0.08,
  instinct: 0.7,
};

/** Floor-specific promotion weights for the step out of `step` (0 = F1→F2), after steepness. */
export function promotionWeights(config: Pick<CorporateConfig, 'culture' | 'politicsSteepness'>, step: number): PromotionWeights {
  const curve = CULTURES[config.culture].curve;
  const base = curve[0];
  const w = curve[Math.min(step, curve.length - 1)];
  const s = config.politicsSteepness;
  const raw = [0, 1, 2].map((i) => Math.max(0, base[i] + s * (w[i] - base[i])));
  const sum = raw[0] + raw[1] + raw[2] || 1;
  return [raw[0] / sum, raw[1] / sum, raw[2] / sum];
}

/** "85% merit" when output dominates, otherwise "20% merit / 80% politics". */
export function describeSplit(w: PromotionWeights): string {
  const merit = Math.round(w[0] * 100);
  return merit >= 75 ? `${merit}% merit` : `${merit}% merit / ${100 - merit}% politics`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorLayout {
  index: number;
  name: string;
  title: string;
  capacity: number;
  /** Interior, above the floor slab. */
  rect: Rect;
  /** Walking line used to reach the elevator walkways. */
  aisleY: number;
  /** One room/desk cell per seat. */
  cells: Rect[];
  seats: { x: number; y: number }[];
  breakroom: Rect;
  mixer: Rect;
  mixerName: string;
  radius: number;
}

export const ARENA_SIZE = 800;
export const SHAFT_X = [34, ARENA_SIZE - 34] as const;
export const SHAFT_W = 28;
export const GROUND_Y = 780;
const SLAB = 6;
const CEILING = 18;

const FLOOR_SPECS = [
  { name: 'Open Bullpen', title: 'Junior ICs', top: 595, bottom: 780, inset: 70, cols: 12, rows: 4, mixer: 'Watercooler', radius: 6.3 },
  { name: 'Senior ICs', title: 'Senior ICs', top: 455, bottom: 595, inset: 105, cols: 8, rows: 3, mixer: 'Watercooler', radius: 7 },
  { name: 'Management', title: 'Managers', top: 335, bottom: 455, inset: 145, cols: 6, rows: 2, mixer: 'Huddle Room', radius: 7.8 },
  { name: 'Directors', title: 'Directors', top: 230, bottom: 335, inset: 185, cols: 6, rows: 1, mixer: 'Exec Mixer', radius: 8.6 },
  { name: 'Executive Suites', title: 'VPs', top: 135, bottom: 230, inset: 225, cols: 4, rows: 1, mixer: 'Exec Mixer', radius: 9.4 },
  { name: 'Penthouse', title: 'C-Suite', top: 50, bottom: 135, inset: 262, cols: 2, rows: 1, mixer: 'Boardroom', radius: 10.2 },
];

function buildFloors(): FloorLayout[] {
  const top = FLOOR_SPECS.length - 1;
  return FLOOR_SPECS.map((s, index) => {
    const rect = { x: s.inset, y: s.top, w: ARENA_SIZE - s.inset * 2, h: s.bottom - s.top - SLAB };
    const aisleY = s.bottom - SLAB - 7;
    const capacity = s.cols * s.rows;
    const cells: Rect[] = [];
    let breakroom: Rect;
    let mixer: Rect;
    const zoneTop = rect.y + CEILING;
    const zoneH = rect.h - CEILING - 4;
    if (index === top) {
      // Corner offices flank a shared espresso bar and boardroom.
      const office = 70;
      cells.push({ x: rect.x + 2, y: zoneTop, w: office, h: zoneH }, { x: rect.x + rect.w - office - 2, y: zoneTop, w: office, h: zoneH });
      const mid = rect.w - office * 2 - 12;
      breakroom = { x: rect.x + office + 6, y: zoneTop, w: mid * 0.42, h: zoneH };
      mixer = { x: breakroom.x + breakroom.w + 4, y: zoneTop, w: mid - breakroom.w - 4, h: zoneH };
    } else {
      const zoneW = Math.max(54, rect.w * 0.14);
      breakroom = { x: rect.x + 4, y: zoneTop, w: zoneW, h: zoneH };
      mixer = { x: rect.x + rect.w - zoneW - 4, y: zoneTop, w: zoneW, h: zoneH };
      const ax = breakroom.x + breakroom.w + 8;
      const aw = mixer.x - 8 - ax;
      const cw = aw / s.cols;
      const ch = zoneH / s.rows;
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) cells.push({ x: ax + c * cw, y: zoneTop + r * ch, w: cw, h: ch });
      }
    }
    const seats = cells.map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h * 0.68 }));
    return { index, name: s.name, title: s.title, capacity, rect, aisleY, cells, seats, breakroom, mixer, mixerName: s.mixer, radius: s.radius };
  });
}

export const FLOORS: FloorLayout[] = buildFloors();
export const TOP_FLOOR = FLOORS.length - 1;
/** Floors that count as management for red tape and leadership quality. */
const MANAGER_FLOOR = 2;
const DIRECTOR_FLOOR = 3;

interface Waypoint {
  x: number;
  y: number;
  /** Physical floor once reached; -1 for elevator shafts and walkways. */
  floor: number;
}

export interface Employee {
  id: number;
  name: string;
  x: number;
  y: number;
  radius: number;
  /** Assigned floor (0 = Floor 1). */
  floor: number;
  /** Floor the employee is physically on; -1 while in an elevator. */
  locFloor: number;
  desk: number;
  traits: CareerTraits;
  brain: NeuralNet;
  energy: number;
  burnout: number;
  activity: Activity;
  /** Floor whose zone the current activity takes place on (managers network a floor or two down). */
  activityFloor: number;
  path: Waypoint[];
  /** Ticks left before the brain reconsiders, counted only once arrived. */
  dwell: number;
  facing: number;
  /** This quarter: direct work shipped at a workstation. */
  qKpi: number;
  /** This quarter: networking and launches. */
  qVis: number;
  /** This quarter: siphoned credit and presenting to Directors/VPs. */
  qPol: number;
  qProduced: number;
  careerKpi: number;
  score: number;
  task: WorkTask;
  taskProgress: number;
  /** Megacorp red tape: a Manager or Director is within sense radius. */
  supervised: boolean;
  generation: number;
  hiredQuarter: number;
  floorSince: number;
  allyId: number | null;
  stealing: boolean;
  bubble: { text: string; until: number } | null;
  bubbleReadyAt: number;
  promotedAt: number;
  demotedAt: number;
}

export interface Departure {
  x: number;
  y: number;
  radius: number;
  color: string;
  cause: DepartureCause;
  tick: number;
}

export type CorporateEventKind = 'promotion' | 'ceo' | 'pip' | 'demotion' | 'burnout' | 'layoff' | 'retirement' | 'pivot' | 'culture';

export interface CorporateEvent {
  quarter: number;
  kind: CorporateEventKind;
  text: string;
  employeeId: number | null;
}

export interface QuarterStats {
  quarter: number;
  culture: CultureId;
  revenue: number;
  visibility: number;
  politicalCredit: number;
  stolen: number;
  /** Company mean burnout at review time, 0–1. */
  avgBurnout: number;
  promotions: number;
  demotions: number;
  pips: number;
  layoffs: number;
  medicalLeaves: number;
  hires: number;
  retirements: number;
  headcount: number;
  /** Mean traits of the top two floors (VPs & C-Suite). */
  topDna: CareerTraits;
  companyDna: CareerTraits;
}

export interface CorporateStatus {
  quarter: number;
  fiscalYear: number;
  quarterOfYear: number;
  week: number;
  quarterProgress: number;
  headcount: number;
  occupancy: number[];
  avgBurnout: number;
  revenueQtd: number;
  visibilityQtd: number;
  politicalQtd: number;
  stolenQtd: number;
  medicalQtd: number;
  activity: Record<Activity, number>;
  leadership: number;
}

export interface SavedCorporate {
  version: 2;
  config: CorporateConfig;
  tick: number;
  quarterTick: number;
  quarter: number;
  nextId: number;
  rng: ReturnType<Random['getState']>;
  employees: (Omit<Employee, 'brain'> & { brain: number[] })[];
  history: QuarterStats[];
  events: CorporateEvent[];
  leadership: number;
  pivot: { quarter: number; tick: number };
  qRevenue: number;
  qVisibility: number;
  qPolitical: number;
  qStolen: number;
  qMedical: number;
}

const FIRST_NAMES = [
  'Ava', 'Ben', 'Chloe', 'Dev', 'Elena', 'Finn', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kai', 'Lena', 'Milo', 'Nina', 'Omar', 'Priya',
  'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wren', 'Xavi', 'Yara', 'Zane', 'Aiden', 'Bianca', 'Carlos', 'Dana', 'Eli', 'Farah',
  'Gus', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Luca', 'Maya', 'Noor', 'Otto', 'Pia', 'Raj', 'Sofia', 'Theo', 'Vera', 'Wes', 'Zoe',
];
const LAST_NAMES = [
  'Synergy', 'Pivot', 'Leverage', 'Bandwidth', 'Paradigm', 'Holistic', 'Roadmap', 'Alignment', 'Stakeholder', 'Deckard', 'Offsite',
  'Quarterly', 'Scale', 'Velocity', 'Runway', 'Backlog', 'Sprint', 'Standup', 'Deliverable', 'Touchbase', 'Bluesky', 'Moonshot',
  'Deepdive', 'Lowhang', 'Northstar', 'Flywheel', 'Bizdev', 'Headcount', 'Okr', 'Kpi',
];
const SHIP_LINES = ['Shipped!', 'LGTM', 'Merged!', 'Deployed!'];
const LAUNCH_LINES = ['Launched!', 'v1.0 is live!', 'Big launch!'];
const MAINTENANCE_LINES = ['Patched.', 'Fixed a flaky test', 'Paid down tech debt'];
const NETWORK_LINES = ['Synergy!', 'Circle back?', 'Quick sync?', 'Love this!', 'Let\u2019s align'];
const STEAL_LINES = ['Per my last email...', 'As I proposed...', 'My initiative!', 'Building on my idea...'];

/** Promotion slots per step (F1→F2 … F5→F6). */
const PROMOTION_SLOTS = [3, 2, 2, 1, 1];
const WALK_SPEED = 1.5;
const ELEVATOR_SPEED = 3.6;
const STEAL_RADIUS = 130;
const SENSE_RADIUS = 110;
export const TASK_SIZE = 4;
/** Directors and up retire after this many quarters in their seat, so the top keeps turning over. */
const RETIREMENT_QUARTERS = 12;
/** Share of new hires recruited off the street rather than cloned from leadership. */
const EXTERNAL_HIRE_PCT = 0.3;
const DEPARTURE_TICKS = 150;
const MAX_EVENTS = 80;
const MAX_HISTORY = 2000;

const clampTrait = (v: number) => Math.min(TRAIT_MAX, Math.max(TRAIT_MIN, v));
/** Saturating ratio to the company mean: 0 → 0, mean → 1, far above → 2. */
const relative = (v: number, mean: number) => (2 * v) / (v + mean);

export function dominantStyle(t: CareerTraits): 'execution' | 'charisma' | 'politics' {
  if (t.execution >= t.charisma && t.execution >= t.politics) return 'execution';
  return t.charisma >= t.politics ? 'charisma' : 'politics';
}

function meanTraits(list: Employee[]): CareerTraits {
  const out: CareerTraits = { execution: 0, charisma: 0, politics: 0, resilience: 0 };
  if (list.length === 0) return out;
  for (const e of list) for (const k of TRAITS) out[k] += e.traits[k];
  for (const k of TRAITS) out[k] /= list.length;
  return out;
}

interface Means {
  k: number;
  v: number;
  p: number;
}

export class CorporateEngine {
  config: CorporateConfig;
  employees: Employee[] = [];
  history: QuarterStats[] = [];
  events: CorporateEvent[] = [];
  departures: Departure[] = [];
  tick = 0;
  quarterTick = 0;
  quarter = 0;
  /** Productivity multiplier from the mean execution of management (Floors 3–6). */
  leadership = 1;
  /** Bumped whenever charted data changes. */
  revision = 0;
  /** Ticks of the latest review and product pivot, for on-canvas banners. */
  lastReviewTick = -Infinity;
  lastPivotTick = -Infinity;

  private rng: Random;
  private nextId = 1;
  private grid = new SpatialGrid<Employee>(ARENA_SIZE, ARENA_SIZE, 60);
  private deskOwner: (number | null)[][] = [];
  private byId = new Map<number, Employee>();
  /** Per floor: employees from higher floors currently holding court at that floor's mixer. */
  private seniorsAtMixer: number[] = FLOORS.map(() => 0);
  /** Per floor: Directors and up holding court there. */
  private execsAtMixer: number[] = FLOORS.map(() => 0);
  private pivot = { quarter: 0, tick: 0 };
  private qRevenue = 0;
  private qVisibility = 0;
  private qPolitical = 0;
  private qStolen = 0;
  private qMedical = 0;

  constructor(config: Partial<CorporateConfig> = {}) {
    this.config = { ...DEFAULT_CORPORATE_CONFIG, ...config };
    this.rng = new Random(this.config.seed);
    this.reset();
  }

  get culture(): CulturePreset {
    return CULTURES[this.config.culture];
  }

  private get mods(): CultureMods {
    return CULTURES[this.config.culture].mods;
  }

  reset(config: Partial<CorporateConfig> = {}): void {
    this.config = { ...this.config, ...config };
    this.rng = new Random(this.config.seed);
    this.employees = [];
    this.byId.clear();
    this.history = [];
    this.events = [];
    this.departures = [];
    this.tick = 0;
    this.quarterTick = 0;
    this.quarter = 0;
    this.nextId = 1;
    this.lastReviewTick = -Infinity;
    this.lastPivotTick = -Infinity;
    this.resetQuarterTotals();
    this.schedulePivot();
    this.deskOwner = FLOORS.map((f) => new Array<number | null>(f.capacity).fill(null));
    for (const f of FLOORS) {
      for (let d = 0; d < f.capacity; d++) {
        const traits = { execution: 0, charisma: 0, politics: 0, resilience: 0 };
        for (const k of TRAITS) traits[k] = this.rng.range(TRAIT_MIN, TRAIT_MAX);
        const e = this.createEmployee(traits, NeuralNet.random(CORP_BRAIN_SHAPE, this.rng), 0, f.index, d);
        const seat = f.seats[d];
        e.x = seat.x;
        e.y = seat.y;
        e.locFloor = f.index;
        // Founders are mid-career, so the first quarter isn't an unrepresentative honeymoon.
        e.energy = this.rng.range(5, 60);
        e.burnout = this.rng.range(5, 40);
      }
    }
    this.updateLeadership();
    this.history.push(this.snapshot(0));
    this.revision++;
  }

  /** Live config: every corporate knob applies immediately. */
  setConfig(partial: Partial<CorporateConfig>): void {
    const before = this.config.culture;
    this.config = { ...this.config, ...partial };
    if (this.config.culture !== before) {
      this.pushEvent('culture', `Culture overhaul: the company is now run like ${this.culture.name}`, null);
      for (const e of this.employees) this.rollTask(e);
    }
    // Steepness and culture both change the live promo badges / charts.
    this.revision++;
  }

  promotionWeights(step: number): PromotionWeights {
    return promotionWeights(this.config, step);
  }

  get finished(): boolean {
    return false;
  }

  get fiscalYear(): number {
    return Math.floor(this.quarter / 4) + 1;
  }

  get nextFiscalYearQuarter(): number {
    return (Math.floor(this.quarter / 4) + 1) * 4;
  }

  floorOccupancy(floor: number): number {
    let n = 0;
    for (const o of this.deskOwner[floor]) if (o !== null) n++;
    return n;
  }

  getEmployee(id: number): Employee | undefined {
    return this.byId.get(id);
  }

  runTicks(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** Run straight to the next quarterly review. */
  advanceQuarter(): void {
    const target = this.quarter + 1;
    while (this.quarter < target) this.step();
  }

  /** Employee with the strongest live case for promotion off their floor (C-Suite first). */
  topPerformer(): Employee | null {
    const means = this.quarterMeans();
    let best: Employee | null = null;
    let bestScore = -Infinity;
    for (const e of this.employees) {
      const s = this.scoreFor(e, Math.min(e.floor, TOP_FLOOR - 1), means) + e.floor * 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  getStatus(): CorporateStatus {
    let burn = 0;
    const activity: Record<Activity, number> = { work: 0, break: 0, network: 0 };
    for (const e of this.employees) {
      burn += e.burnout;
      activity[e.activity]++;
    }
    const n = this.employees.length;
    const progress = this.quarterTick / this.config.quarterTicks;
    return {
      quarter: this.quarter,
      fiscalYear: this.fiscalYear,
      quarterOfYear: (this.quarter % 4) + 1,
      week: Math.min(13, Math.floor(progress * 13) + 1),
      quarterProgress: progress,
      headcount: n,
      occupancy: FLOORS.map((f) => this.floorOccupancy(f.index)),
      avgBurnout: n ? burn / n / 100 : 0,
      revenueQtd: this.qRevenue,
      visibilityQtd: this.qVisibility,
      politicalQtd: this.qPolitical,
      stolenQtd: this.qStolen,
      medicalQtd: this.qMedical,
      activity,
      leadership: this.leadership,
    };
  }

  private resetQuarterTotals(): void {
    this.qRevenue = 0;
    this.qVisibility = 0;
    this.qPolitical = 0;
    this.qStolen = 0;
    this.qMedical = 0;
  }

  /** One product pivot per fiscal year, at a random point in a random quarter. */
  private schedulePivot(): void {
    const fyStart = Math.floor(this.quarter / 4) * 4;
    this.pivot = {
      quarter: fyStart + Math.floor(this.rng.next() * 4),
      tick: Math.floor(this.rng.range(0.25, 0.85) * this.config.quarterTicks),
    };
  }

  private rollTask(e: Employee): void {
    // Charismatic employees chase launches; heads-down shippers get handed maintenance.
    e.task = this.mods.greenfield ? (this.rng.next() < 0.1 + 0.6 * e.traits.charisma ? 'launch' : 'maintenance') : 'standard';
    e.taskProgress = 0;
  }

  private createEmployee(traits: CareerTraits, brain: NeuralNet, generation: number, floor: number, desk: number): Employee {
    const f = FLOORS[floor];
    const e: Employee = {
      id: this.nextId++,
      name: `${FIRST_NAMES[Math.floor(this.rng.next() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(this.rng.next() * LAST_NAMES.length)]}`,
      x: SHAFT_X[0],
      y: GROUND_Y + 10,
      radius: f.radius,
      floor,
      locFloor: -1,
      desk,
      traits,
      brain,
      energy: 100,
      burnout: 0,
      activity: 'work',
      activityFloor: floor,
      path: [],
      dwell: Math.floor(this.rng.next() * 40),
      facing: 1,
      qKpi: 0,
      qVis: 0,
      qPol: 0,
      qProduced: 0,
      careerKpi: 0,
      score: 0,
      task: 'standard',
      taskProgress: 0,
      supervised: false,
      generation,
      hiredQuarter: this.quarter,
      floorSince: this.quarter,
      allyId: null,
      stealing: false,
      bubble: null,
      bubbleReadyAt: 0,
      promotedAt: -Infinity,
      demotedAt: -Infinity,
    };
    this.rollTask(e);
    this.deskOwner[floor][desk] = e.id;
    this.employees.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  private step(): void {
    this.tick++;
    this.quarterTick++;

    this.grid.clear();
    this.seniorsAtMixer.fill(0);
    this.execsAtMixer.fill(0);
    for (const e of this.employees) {
      if (e.locFloor < 0) continue;
      this.grid.insert(e);
      if (e.activity === 'network' && e.path.length === 0 && e.floor > e.locFloor) {
        this.seniorsAtMixer[e.locFloor]++;
        if (e.floor >= DIRECTOR_FLOOR) this.execsAtMixer[e.locFloor]++;
      }
    }

    const redTape = this.mods.redTape;
    const burnedOut: Employee[] = [];
    for (const e of this.employees) {
      if (redTape && (this.tick + e.id) % 20 === 0) this.updateSupervision(e);
      if (e.path.length === 0 && e.dwell-- <= 0) this.think(e);
      this.move(e);
      if (e.path.length === 0 && e.locFloor === e.activityFloor) this.act(e);
      if (e.bubble && e.bubble.until <= this.tick) e.bubble = null;
      if (e.burnout >= 100) burnedOut.push(e);
    }
    for (const e of burnedOut) {
      this.qMedical++;
      this.pushEvent('burnout', `${e.name} (${FLOORS[e.floor].title}) burned out \u2014 medical leave`, e.id);
      this.depart(e, 'burnout');
    }
    if (this.departures.length && this.tick - this.departures[0].tick > DEPARTURE_TICKS) {
      this.departures = this.departures.filter((d) => this.tick - d.tick <= DEPARTURE_TICKS);
    }
    if (this.mods.pivots && this.quarter === this.pivot.quarter && this.quarterTick === this.pivot.tick) this.productPivot();

    if (this.quarterTick >= this.config.quarterTicks) this.review();
  }

  private updateSupervision(e: Employee): void {
    if (e.floor >= MANAGER_FLOOR || e.locFloor < 0) {
      e.supervised = true;
      return;
    }
    let found = false;
    this.grid.query(e.x, e.y, SENSE_RADIUS, (o) => {
      if (o.locFloor === e.locFloor && (o.floor === MANAGER_FLOOR || o.floor === DIRECTOR_FLOOR)) {
        found = true;
        return true;
      }
    });
    e.supervised = found;
  }

  private productPivot(): void {
    let wiped = 0;
    let spared = 0;
    for (const e of this.employees) {
      if (Math.max(e.traits.resilience, e.traits.charisma) >= 0.65) {
        spared++;
        continue;
      }
      const loss = e.qKpi * 0.25;
      e.qKpi -= loss;
      wiped += loss;
      if (this.rng.next() < 0.25) e.bubble = { text: 'Wait, we\u2019re pivoting?!', until: this.tick + 120 };
    }
    this.lastPivotTick = this.tick;
    this.pushEvent('pivot', `Product pivot! ${Math.round(wiped)} unbanked KPI scrapped (${spared} adaptable employees kept theirs)`, null);
  }

  private think(e: Employee): void {
    const seniors = this.seniorsAtMixer[e.floor];
    const means = this.quarterMeans();
    const t = e.traits;
    const energy = e.energy / 100;
    const burnout = e.burnout / 100;
    const inputs = [
      energy * 2 - 1,
      burnout * 2 - 1,
      t.execution * 2 - 1,
      t.charisma * 2 - 1,
      t.politics * 2 - 1,
      t.resilience * 2 - 1,
      (e.floor / TOP_FLOOR) * 2 - 1,
      Math.min(1, seniors / 2),
      relative(e.qVis + e.qPol, means.v + means.p) - 1,
      relative(e.qKpi, means.k) - 1,
    ];
    const out = e.brain.forward(inputs);
    const k = this.config.instinct;
    // Everyone reads the room: how much does the next rung reward face time over output?
    const ambition = 1 - this.promotionWeights(Math.min(e.floor, TOP_FLOOR - 1))[0];
    const work = out[0] + k * (0.9 * energy - 1.0 * burnout + 0.2 * t.execution + 0.3 * (1 - ambition));
    const rest = out[1] + k * (0.9 * (1 - energy) + 1.2 * burnout - 0.6);
    const network =
      out[2] +
      k * (0.6 * Math.max(t.charisma, t.politics) - 0.55 + 0.9 * ambition + (seniors > 0 ? 0.25 : 0) - (this.mods.noMeetings ? 0.6 : 0));
    const choice: Activity = work >= rest && work >= network ? 'work' : rest >= network ? 'break' : 'network';
    e.dwell = 80 + Math.floor(this.rng.next() * 80);
    if (choice === e.activity && e.locFloor === e.activityFloor) return;
    e.activity = choice;
    if (choice === 'work') {
      e.activityFloor = e.floor;
      const seat = FLOORS[e.floor].seats[e.desk];
      this.routeTo(e, e.floor, seat.x, seat.y);
    } else {
      // Bosses sometimes hold court at a mixer one or two floors down.
      let floor = e.floor;
      if (choice === 'network' && e.floor > 0 && this.rng.next() < 0.45) floor -= e.floor >= 2 && this.rng.next() < 0.5 ? 2 : 1;
      const zone = choice === 'break' ? FLOORS[floor].breakroom : FLOORS[floor].mixer;
      e.activityFloor = floor;
      this.routeTo(e, floor, this.rng.range(zone.x + 8, zone.x + zone.w - 8), this.rng.range(zone.y + 10, zone.y + zone.h - 8));
    }
  }

  private routeTo(e: Employee, floor: number, x: number, y: number): void {
    const path: Waypoint[] = [];
    if (e.locFloor !== floor) {
      const side = e.x < ARENA_SIZE / 2 ? 0 : 1;
      const sx = SHAFT_X[side];
      if (e.locFloor >= 0) {
        const from = FLOORS[e.locFloor];
        path.push({ x: side === 0 ? from.rect.x + 6 : from.rect.x + from.rect.w - 6, y: from.aisleY, floor: e.locFloor });
        path.push({ x: sx, y: from.aisleY, floor: -1 });
      } else {
        path.push({ x: sx, y: e.y, floor: -1 });
      }
      const to = FLOORS[floor];
      path.push({ x: sx, y: to.aisleY, floor: -1 });
      path.push({ x: side === 0 ? to.rect.x + 6 : to.rect.x + to.rect.w - 6, y: to.aisleY, floor });
    }
    path.push({ x, y, floor });
    e.path = path;
  }

  private move(e: Employee): void {
    const wp = e.path[0];
    if (!wp) return;
    const riding = e.locFloor === -1 && wp.floor === -1 && Math.abs(wp.x - e.x) < 1;
    const speed = riding ? ELEVATOR_SPEED : WALK_SPEED * (0.6 + 0.4 * (e.energy / 100));
    const dx = wp.x - e.x;
    const dy = wp.y - e.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.3) e.facing = dx > 0 ? 1 : -1;
    if (d <= speed) {
      e.x = wp.x;
      e.y = wp.y;
      e.locFloor = wp.floor;
      e.path.shift();
    } else {
      e.x += (dx / d) * speed;
      e.y += (dy / d) * speed;
    }
  }

  private act(e: Employee): void {
    if (e.activity === 'work') this.work(e);
    else if (e.activity === 'break') {
      e.energy = Math.min(100, e.energy + 0.45 * this.config.espressoPerk);
      e.burnout = Math.max(0, e.burnout - 0.09);
    } else this.network(e);
  }

  private work(e: Employee): void {
    const mods = this.mods;
    const t = e.traits;
    let produced = t.execution * 0.05 * (0.3 + 0.7 * (e.energy / 100)) * this.leadership * mods.kpiMultiplier;
    if (mods.redTape && !e.supervised) produced *= 0.6;
    if (e.task === 'maintenance') produced *= 1.2;
    e.qKpi += produced;
    e.qProduced += produced;
    e.careerKpi += produced;
    this.qRevenue += produced;
    e.energy = Math.max(0, e.energy - 0.075);
    const crunch = e.energy < 20 ? 2.5 : 1;
    e.burnout += 0.045 * (1.15 - t.resilience) * mods.burnoutMultiplier * (1 + 0.1 * e.floor) * crunch;

    e.taskProgress += produced;
    if (e.taskProgress < TASK_SIZE) return;
    if (e.task === 'standard') {
      this.say(e, SHIP_LINES);
    } else {
      // A finished task gets noticed: launches loudly, maintenance barely.
      const vis = TASK_SIZE * 0.25 * (e.task === 'launch' ? 2.5 : 0.1);
      e.qVis += vis;
      this.qVisibility += vis;
      if (e.task === 'launch') {
        // The launch demo is pitched straight to leadership; savvy operators spin it into credit.
        const pol = TASK_SIZE * 0.3 * t.politics;
        e.qPol += pol;
        this.qPolitical += pol;
      }
      this.say(e, e.task === 'launch' ? LAUNCH_LINES : MAINTENANCE_LINES, e.task === 'launch');
    }
    this.rollTask(e);
  }

  private network(e: Employee): void {
    const t = e.traits;
    const mods = this.mods;
    const floor = e.locFloor;
    e.energy = Math.max(0, e.energy - 0.03);
    e.burnout += 0.004 * mods.burnoutMultiplier;
    const wasStealing = e.stealing;
    e.stealing = false;
    if (mods.noMeetings) return;
    if (e.floor > floor) {
      // Holding court downstairs: a little visibility for being seen mentoring.
      const vis = t.charisma * 0.012;
      e.qVis += vis;
      this.qVisibility += vis;
      return;
    }
    const seniors = this.seniorsAtMixer[floor];
    const execs = this.execsAtMixer[floor];
    const vis = t.charisma * 0.03 * (1 + 0.9 * Math.min(3, seniors));
    e.qVis += vis;
    this.qVisibility += vis;
    if (execs > 0) {
      // Presenting to Directors and VPs.
      const pol = t.politics * 0.02 * Math.min(2, execs);
      e.qPol += pol;
      this.qPolitical += pol;
    }

    if (seniors > 0 && t.politics > 0.35) {
      let victim: Employee | null = null;
      let best = 1;
      this.grid.query(e.x, e.y, STEAL_RADIUS, (o) => {
        if (o === e || o.locFloor !== floor || o.floor > floor) return;
        const worth = o.qKpi * o.traits.execution;
        if (worth > best) {
          best = worth;
          victim = o;
        }
      });
      if (victim) {
        const v = victim as Employee;
        const amount = Math.min(v.qKpi, t.politics * t.politics * 0.035 * mods.siphonMultiplier);
        v.qKpi -= amount;
        v.burnout += amount * 2;
        const credit = amount * 3;
        e.qPol += credit;
        this.qPolitical += credit;
        this.qStolen += amount;
        if (!wasStealing) this.say(e, STEAL_LINES, true);
        e.stealing = true;
      }
    }

    if (e.allyId === null && t.charisma > 0.55) {
      this.grid.query(e.x, e.y, 40, (o) => {
        if (o === e || o.allyId !== null || o.traits.charisma <= 0.55 || o.activity !== 'network' || o.path.length) return;
        e.allyId = o.id;
        o.allyId = e.id;
        this.say(e, NETWORK_LINES, true);
        this.say(o, NETWORK_LINES, true);
        return true;
      });
    } else if (seniors > 0 && this.rng.next() < 0.004) {
      this.say(e, NETWORK_LINES);
    }
  }

  private say(e: Employee, lines: string[], force = false): void {
    if (!force && this.tick < e.bubbleReadyAt) return;
    e.bubble = { text: lines[Math.floor(this.rng.next() * lines.length)], until: this.tick + 90 };
    e.bubbleReadyAt = this.tick + 300;
  }

  private quarterMeans(): Means {
    let k = 0;
    let v = 0;
    let p = 0;
    for (const e of this.employees) {
      k += e.qKpi;
      v += e.qVis;
      p += e.qPol;
    }
    const n = Math.max(1, this.employees.length);
    return { k: Math.max(0.5, k / n), v: Math.max(0.5, v / n), p: Math.max(0.5, p / n) };
  }

  /** Promotion score under the weights for `step` (the step out of Floor `step + 1`). */
  private scoreFor(e: Employee, step: number, means: Means): number {
    const [we, wc, wp] = this.promotionWeights(step);
    let s = we * relative(e.qKpi, means.k) + wc * relative(e.qVis, means.v) + wp * relative(e.qPol, means.p);
    if (e.allyId !== null) {
      const ally = this.byId.get(e.allyId);
      if (ally && ally.floor > e.floor) s += 0.1 * (wc + wp);
    }
    return s;
  }

  private depart(e: Employee, cause: DepartureCause): void {
    this.deskOwner[e.floor][e.desk] = null;
    this.byId.delete(e.id);
    const i = this.employees.indexOf(e);
    if (i >= 0) this.employees.splice(i, 1);
    if (e.allyId !== null) {
      const ally = this.byId.get(e.allyId);
      if (ally) ally.allyId = null;
    }
    this.departures.push({ x: e.x, y: e.y, radius: e.radius, color: TRAIT_COLORS[dominantStyle(e.traits)], cause, tick: this.tick });
  }

  private moveToFloor(e: Employee, floor: number): void {
    const desk = this.deskOwner[floor].indexOf(null);
    if (desk < 0) return;
    const up = floor > e.floor;
    this.deskOwner[e.floor][e.desk] = null;
    this.deskOwner[floor][desk] = e.id;
    e.floor = floor;
    e.desk = desk;
    e.radius = FLOORS[floor].radius;
    e.floorSince = this.quarter;
    if (up) e.promotedAt = this.tick;
    else e.demotedAt = this.tick;
    e.activity = 'work';
    e.activityFloor = floor;
    e.dwell = 120;
    const seat = FLOORS[floor].seats[desk];
    this.routeTo(e, floor, seat.x, seat.y);
    e.bubble = { text: !up ? 'Demoted...' : floor === TOP_FLOOR ? 'Corner office!' : 'Promoted!', until: this.tick + 140 };
  }

  private review(): void {
    const cfg = this.config;
    const mods = this.mods;
    this.quarterTick = 0;
    this.lastReviewTick = this.tick;
    const means = this.quarterMeans();
    for (const e of this.employees) e.score = this.scoreFor(e, Math.min(e.floor, TOP_FLOOR - 1), means);

    let retirements = 0;
    for (const e of [...this.employees]) {
      if (e.floor >= DIRECTOR_FLOOR && this.quarter - e.floorSince >= RETIREMENT_QUARTERS) {
        this.pushEvent('retirement', `${e.name} retires from ${FLOORS[e.floor].title}`, e.id);
        this.depart(e, 'retired');
        retirements++;
      }
    }

    let promotions = 0;
    let pips = 0;
    // Top-down, so nobody climbs two floors in one review. Candidates and the incumbents
    // they'd displace are both judged on the criteria for the seat in question.
    for (let f = TOP_FLOOR - 1; f >= 0; f--) {
      const upper = f + 1;
      const ranked = (floor: number) =>
        this.employees
          .filter((e) => e.floor === floor && e.floorSince < this.quarter)
          .map((e) => ({ e, s: this.scoreFor(e, f, means) }))
          .sort((a, b) => b.s - a.s);
      const candidates = ranked(f);
      // Vacancies always fill with the best candidate; beyond that, a few may unseat incumbents.
      let challenges = 0;
      for (const { e: c, s } of candidates) {
        const full = this.floorOccupancy(upper) >= FLOORS[upper].capacity;
        if (full && (challenges >= PROMOTION_SLOTS[f] || s < 0.9)) break;
        if (full) {
          challenges++;
          const incumbents = ranked(upper);
          const lowest = incumbents[incumbents.length - 1];
          if (!lowest || s <= lowest.s * 1.1) break;
          this.pushEvent('pip', `${lowest.e.name} PIP\u2019d off ${FLOORS[upper].title} by ${c.name}`, lowest.e.id);
          this.depart(lowest.e, 'pip');
          pips++;
        }
        this.moveToFloor(c, upper);
        promotions++;
        if (upper === TOP_FLOOR) {
          const style = dominantStyle(c.traits);
          this.pushEvent('ceo', `${c.name} reaches the C-Suite (${style === 'execution' ? 'shipper' : style === 'charisma' ? 'networker' : 'politician'})`, c.id);
        } else if (upper >= MANAGER_FLOOR) {
          this.pushEvent('promotion', `${c.name} promoted to ${FLOORS[upper].title.replace(/s$/, '')}`, c.id);
        }
      }
    }

    // Quant culture: the bottom of every floor above the bullpen is demoted, or cut if there's no room below.
    let demotions = 0;
    if (mods.cullPct > 0) {
      for (let f = TOP_FLOOR; f >= 1; f--) {
        const step = Math.min(f, TOP_FLOOR - 1);
        const ranked = this.employees.filter((e) => e.floor === f && e.floorSince < this.quarter).sort((a, b) => this.scoreFor(a, step, means) - this.scoreFor(b, step, means));
        const n = Math.round(ranked.length * mods.cullPct);
        for (let i = 0; i < n; i++) {
          const e = ranked[i];
          if (this.floorOccupancy(f - 1) < FLOORS[f - 1].capacity) {
            this.moveToFloor(e, f - 1);
            demotions++;
            if (f >= DIRECTOR_FLOOR) this.pushEvent('demotion', `${e.name} demoted from ${FLOORS[f].title}`, e.id);
          } else {
            this.pushEvent('pip', `${e.name} cut from ${FLOORS[f].title} (bottom ${Math.round(mods.cullPct * 100)}%)`, e.id);
            this.depart(e, 'pip');
            pips++;
          }
        }
      }
    }

    const juniors = this.employees.filter((e) => e.floor === 0 && e.floorSince < this.quarter).sort((a, b) => a.score - b.score);
    const layoffs = Math.round(juniors.length * Math.max(cfg.layoffPct, mods.cullPct));
    for (let i = 0; i < layoffs; i++) this.depart(juniors[i], 'layoff');
    if (layoffs > 0) this.pushEvent('layoff', `Q${this.quarterLabel(this.quarter)} review: ${layoffs} junior${layoffs === 1 ? '' : 's'} laid off`, null);

    const hires = this.hire();
    this.quarter++;
    if (this.quarter % 4 === 0) this.schedulePivot();
    const record = this.snapshot(this.quarter);
    record.revenue = this.qRevenue;
    record.visibility = this.qVisibility;
    record.politicalCredit = this.qPolitical;
    record.stolen = this.qStolen;
    record.medicalLeaves = this.qMedical;
    record.promotions = promotions;
    record.demotions = demotions;
    record.pips = pips;
    record.layoffs = layoffs;
    record.hires = hires;
    record.retirements = retirements;
    this.history.push(record);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.noteLeadershipShift();

    for (const e of this.employees) {
      e.qKpi = 0;
      e.qVis = 0;
      e.qPol = 0;
      e.qProduced = 0;
    }
    this.resetQuarterTotals();
    this.updateLeadership();
    this.revision++;
  }

  /** Fill empty Floor 1 desks, mostly with mutated clones of the VPs and C-Suite. */
  private hire(): number {
    let parents = this.employees.filter((e) => e.floor >= TOP_FLOOR - 1);
    if (parents.length === 0) parents = [...this.employees].sort((a, b) => b.floor - a.floor || b.score - a.score).slice(0, 4);
    const weights = parents.map((p) => (p.floor === TOP_FLOOR ? 2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const sigma = this.config.mutationRate;
    let hires = 0;
    const desks = this.deskOwner[0];
    for (let d = 0; d < desks.length; d++) {
      if (desks[d] !== null) continue;
      let traits: CareerTraits;
      let brain: NeuralNet;
      let generation = 0;
      if (parents.length && this.rng.next() >= EXTERNAL_HIRE_PCT) {
        let r = this.rng.next() * total;
        let parent = parents[0];
        for (let i = 0; i < parents.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            parent = parents[i];
            break;
          }
        }
        traits = { ...parent.traits };
        for (const k of TRAITS) traits[k] = clampTrait(traits[k] + this.rng.gaussian() * sigma);
        brain = parent.brain.cloneAndMutate(0.2, 0.35, this.rng);
        generation = parent.generation + 1;
      } else {
        traits = { execution: 0, charisma: 0, politics: 0, resilience: 0 };
        for (const k of TRAITS) traits[k] = this.rng.range(TRAIT_MIN, TRAIT_MAX);
        brain = NeuralNet.random(CORP_BRAIN_SHAPE, this.rng);
      }
      const e = this.createEmployee(traits, brain, generation, 0, d);
      e.x = SHAFT_X[d % 2];
      e.dwell = 0;
      const seat = FLOORS[0].seats[d];
      this.routeTo(e, 0, seat.x, seat.y);
      hires++;
    }
    return hires;
  }

  private noteLeadershipShift(): void {
    const n = this.history.length;
    if (n < 2) return;
    const style = (d: CareerTraits) => (d.execution >= d.charisma && d.execution >= d.politics ? 'shippers' : d.charisma >= d.politics ? 'networkers' : 'politicians');
    const now = style(this.history[n - 1].topDna);
    const before = style(this.history[n - 2].topDna);
    if (now !== before) this.pushEvent('culture', `Leadership is now dominated by ${now}`, null);
  }

  private updateLeadership(): void {
    const mgmt = this.employees.filter((e) => e.floor >= MANAGER_FLOOR);
    const avg = mgmt.length ? mgmt.reduce((s, e) => s + e.traits.execution, 0) / mgmt.length : 0.5;
    this.leadership = 0.55 + 0.9 * avg;
  }

  private snapshot(quarter: number): QuarterStats {
    const n = this.employees.length;
    return {
      quarter,
      culture: this.config.culture,
      revenue: 0,
      visibility: 0,
      politicalCredit: 0,
      stolen: 0,
      avgBurnout: n ? this.employees.reduce((s, e) => s + e.burnout, 0) / n / 100 : 0,
      promotions: 0,
      demotions: 0,
      pips: 0,
      layoffs: 0,
      medicalLeaves: 0,
      hires: 0,
      retirements: 0,
      headcount: n,
      topDna: meanTraits(this.employees.filter((e) => e.floor >= TOP_FLOOR - 1)),
      companyDna: meanTraits(this.employees),
    };
  }

  /** Mean traits of each floor right now, Floor 1 first. */
  floorDna(): (CareerTraits & { count: number })[] {
    return FLOORS.map((f) => {
      const list = this.employees.filter((e) => e.floor === f.index);
      return { ...meanTraits(list), count: list.length };
    });
  }

  quarterLabel(quarter: number): string {
    return `${(quarter % 4) + 1} FY${Math.floor(quarter / 4) + 1}`;
  }

  private pushEvent(kind: CorporateEventKind, text: string, employeeId: number | null): void {
    this.events.push({ quarter: this.quarter, kind, text, employeeId });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  toJSON(): SavedCorporate {
    return {
      version: 2,
      config: { ...this.config },
      tick: this.tick,
      quarterTick: this.quarterTick,
      quarter: this.quarter,
      nextId: this.nextId,
      rng: this.rng.getState(),
      employees: this.employees.map((e) => ({ ...e, path: e.path.map((p) => ({ ...p })), brain: Array.from(e.brain.params) })),
      history: this.history,
      events: this.events,
      leadership: this.leadership,
      pivot: { ...this.pivot },
      qRevenue: this.qRevenue,
      qVisibility: this.qVisibility,
      qPolitical: this.qPolitical,
      qStolen: this.qStolen,
      qMedical: this.qMedical,
    };
  }

  loadJSON(saved: SavedCorporate): void {
    if (!saved || saved.version !== 2 || !saved.config || !CULTURES[saved.config.culture]) throw new Error('Invalid corporate save');
    this.config = { ...DEFAULT_CORPORATE_CONFIG, ...saved.config };
    this.rng = new Random(this.config.seed);
    this.rng.setState(saved.rng);
    this.tick = saved.tick;
    this.quarterTick = saved.quarterTick;
    this.quarter = saved.quarter;
    this.nextId = saved.nextId;
    this.history = saved.history;
    this.events = saved.events;
    this.leadership = saved.leadership;
    this.pivot = { ...saved.pivot };
    this.qRevenue = saved.qRevenue;
    this.qVisibility = saved.qVisibility;
    this.qPolitical = saved.qPolitical;
    this.qStolen = saved.qStolen;
    this.qMedical = saved.qMedical;
    this.departures = [];
    this.lastReviewTick = -Infinity;
    this.lastPivotTick = -Infinity;
    this.deskOwner = FLOORS.map((f) => new Array<number | null>(f.capacity).fill(null));
    this.byId.clear();
    this.employees = saved.employees.map((s) => {
      const e: Employee = {
        ...s,
        brain: new NeuralNet(CORP_BRAIN_SHAPE, Float32Array.from(s.brain)),
        bubble: null,
        bubbleReadyAt: 0,
        promotedAt: -Infinity,
        demotedAt: -Infinity,
      };
      this.deskOwner[e.floor][e.desk] = e.id;
      this.byId.set(e.id, e);
      return e;
    });
    this.revision++;
  }
}
