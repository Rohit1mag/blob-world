import type { GameMode, SimulationConfig, Stockpile, StructureType } from './types';

export const DEFAULT_CONFIG: SimulationConfig = {
  seed: 1,
  mode: 'endless',
  arenaSize: 2800,
  tribeCount: 4,
  maxTribes: 16,
  splitMinPopulation: 18,
  wandererCooldown: 25,

  foodPerDay: 100,
  mutationRate: 0.08,
  blobsPerTribe: 12,
  initialVariance: 0.0,
  instinct: 1,

  brainMutationProb: 0.3,
  brainMutationScale: 2.5,
  maxTurn: 0.3,

  minTribePopulation: 10,
  graceDays: 200,

  dayTicks: 400,
  nightTicks: 50,
  yearLength: 100,

  startEnergy: 100,
  baseVelocity: 2.5,
  baseRadius: 8,
  cMove: 0.15,
  cSense: 0.0005,
  cBrain: 0.015,
  cBase: 0.03,
  winterDrainMultiplier: 1.4,

  carryCapacity: 2,
  ration: 0.3,
  birthCost: 3,
  safeFoodBase: 150,
  spoilRate: 0.15,
  housingBase: 20,
  lifespan: 60,
  shelterCapacity: 10,
  winterDiseaseChance: 0.02,

  aggressionThreshold: -0.3,
  cooperationThreshold: 0.2,
  attackDamage: 22,
  attackCooldown: 20,
  aggressionBias: 0,

  startingStockpile: { food: 40, timber: 0, stone: 0 },
  maxPopulation: 1200,
};

type ModeSettings = Pick<SimulationConfig, 'arenaSize' | 'maxPopulation' | 'instinct' | 'lifespan' | 'winterDiseaseChance' | 'winterDrainMultiplier'>;

/**
 * Endless worlds are big, and founders are born able to forage so civilisation can get going.
 * Last standing is the classic harsh contest: a small map, blank brains and brutal winters.
 */
export const MODE_SETTINGS: Record<GameMode, ModeSettings> = {
  endless: { arenaSize: 2800, maxPopulation: 1200, instinct: 1, lifespan: 60, winterDiseaseChance: 0.02, winterDrainMultiplier: 1.4 },
  lastStanding: { arenaSize: 800, maxPopulation: 400, instinct: 0, lifespan: 45, winterDiseaseChance: 0.06, winterDrainMultiplier: 2.5 },
};

export interface TribeTemplate {
  name: string;
  color: string;
}

/** Founders take the first entries; splinter tribes and wanderers draw from the rest. */
export const TRIBE_TEMPLATES: TribeTemplate[] = [
  { name: 'Ember', color: '#ff7a6b' },
  { name: 'Tide', color: '#5aa9ff' },
  { name: 'Moss', color: '#6fe39a' },
  { name: 'Dune', color: '#f5c451' },
  { name: 'Iris', color: '#c99bff' },
  { name: 'Reef', color: '#5fe0e0' },
  { name: 'Flint', color: '#ffb067' },
  { name: 'Blossom', color: '#ff9fd0' },
  { name: 'Fern', color: '#a8e05f' },
  { name: 'Slate', color: '#8f9bff' },
  { name: 'Coral', color: '#ff6f91' },
  { name: 'Sage', color: '#7fd1b9' },
  { name: 'Amber', color: '#ffd36e' },
  { name: 'Frost', color: '#90e0ef' },
  { name: 'Clay', color: '#d4a373' },
  { name: 'Lilac', color: '#e0c3fc' },
];

/** Town Center positions (as fractions of the arena) for 3- and 4-tribe maps. */
export const BASE_LAYOUTS: Record<number, [number, number][]> = {
  3: [
    [0.5, 0.2],
    [0.8, 0.76],
    [0.2, 0.76],
  ],
  4: [
    [0.21, 0.21],
    [0.79, 0.21],
    [0.79, 0.79],
    [0.21, 0.79],
  ],
};

export interface StructureSpec {
  cost: Stockpile;
  buildTicks: number;
  maxHealth: number;
  radius: number;
  /** Per-tribe cap. */
  limit: number;
}

export const STRUCTURE_SPECS: Record<StructureType, StructureSpec> = {
  townCenter: { cost: { food: 0, timber: 0, stone: 0 }, buildTicks: 0, maxHealth: 600, radius: 24, limit: 1 },
  granary: { cost: { food: 0, timber: 50, stone: 50 }, buildTicks: 240, maxHealth: 220, radius: 13, limit: 3 },
  shelter: { cost: { food: 0, timber: 100, stone: 0 }, buildTicks: 240, maxHealth: 260, radius: 15, limit: 4 },
  barricade: { cost: { food: 0, timber: 20, stone: 20 }, buildTicks: 90, maxHealth: 120, radius: 9, limit: 6 },
  farm: { cost: { food: 0, timber: 40, stone: 10 }, buildTicks: 180, maxHealth: 140, radius: 14, limit: 3 },
  workshop: { cost: { food: 0, timber: 70, stone: 40 }, buildTicks: 260, maxHealth: 220, radius: 13, limit: 1 },
  market: { cost: { food: 0, timber: 60, stone: 60 }, buildTicks: 240, maxHealth: 240, radius: 14, limit: 1 },
  dock: { cost: { food: 0, timber: 35, stone: 10 }, buildTicks: 160, maxHealth: 180, radius: 13, limit: 2 },
  bridge: { cost: { food: 0, timber: 35, stone: 20 }, buildTicks: 150, maxHealth: 280, radius: 22, limit: 2 },
  watchtower: { cost: { food: 0, timber: 45, stone: 65 }, buildTicks: 240, maxHealth: 280, radius: 11, limit: 2 },
  monument: { cost: { food: 0, timber: 30, stone: 90 }, buildTicks: 300, maxHealth: 320, radius: 12, limit: 1 },
  palace: { cost: { food: 0, timber: 120, stone: 140 }, buildTicks: 400, maxHealth: 500, radius: 19, limit: 1 },
  factory: { cost: { food: 0, timber: 80, stone: 90 }, buildTicks: 280, maxHealth: 340, radius: 16, limit: 2 },
  powerPlant: { cost: { food: 0, timber: 50, stone: 110 }, buildTicks: 260, maxHealth: 300, radius: 15, limit: 1 },
  lab: { cost: { food: 0, timber: 60, stone: 100 }, buildTicks: 260, maxHealth: 280, radius: 14, limit: 1 },
  hospital: { cost: { food: 0, timber: 70, stone: 80 }, buildTicks: 240, maxHealth: 300, radius: 14, limit: 1 },
  skyscraper: { cost: { food: 0, timber: 90, stone: 150 }, buildTicks: 360, maxHealth: 600, radius: 17, limit: 3 },
};

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  config: Partial<SimulationConfig>;
}

export const PRESETS: ScenarioPreset[] = [
  {
    id: 'balanced',
    name: 'Balanced Ecosystem',
    description: 'Four tribes, ample summer harvests. Tribes must stockpile and build shelters to survive winter.',
    config: { foodPerDay: 100, mutationRate: 0.08, blobsPerTribe: 12, initialVariance: 0, aggressionBias: 0 },
  },
  {
    id: 'famine',
    name: 'Famine',
    description: 'Thin harvests. Only tribes that gather efficiently and conserve food last a winter.',
    config: { foodPerDay: 55, mutationRate: 0.08, blobsPerTribe: 12, initialVariance: 0, aggressionBias: 0 },
  },
  {
    id: 'arms-race',
    name: 'Tribal Warfare',
    description: 'Warlike founders with varied sizes. Raids, theft and barricades from the first season.',
    config: { foodPerDay: 100, mutationRate: 0.1, blobsPerTribe: 12, initialVariance: 0.18, aggressionBias: -0.45 },
  },
  {
    id: 'chaos',
    name: 'Hyper-Mutation Chaos',
    description: 'Maximum mutation. Offspring rarely behave like their parents.',
    config: { foodPerDay: 110, mutationRate: 0.3, blobsPerTribe: 12, initialVariance: 0.1, aggressionBias: 0 },
  },
];
