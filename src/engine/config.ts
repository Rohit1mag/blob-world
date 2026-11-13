import type { SimulationConfig } from './types';

export const DEFAULT_CONFIG: SimulationConfig = {
  seed: 1,
  arenaSize: 800,
  foodMargin: 50,

  foodPerDay: 60,
  mutationRate: 0.08,
  initialPopulation: 30,
  initialVariance: 0.0,

  brainMutationProb: 0.3,
  brainMutationScale: 2.5,
  maxTurn: 0.3,
  minPopulation: 20,

  startEnergy: 100,
  baseVelocity: 2.5,
  baseRadius: 8,
  cMove: 0.15,
  cSense: 0.0005,
  cBase: 0.03,

  predationEnabled: true,
  predationRatio: 1.2,
  preyFoodValue: 2,
  preyEnergyGain: 40,

  maxDayTicks: 1000,
  duskTicks: 50,
  maxPopulation: 600,
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
    description: 'Moderate food and mutation. Population settles near carrying capacity while traits drift toward efficiency.',
    config: { foodPerDay: 60, mutationRate: 0.08, initialPopulation: 30, initialVariance: 0 },
  },
  {
    id: 'famine',
    name: 'Famine',
    description: 'Scarce food. Brains take longer to learn, and only efficient foragers make it home.',
    config: { foodPerDay: 30, mutationRate: 0.08, initialPopulation: 40, initialVariance: 0 },
  },
  {
    id: 'arms-race',
    name: 'Predator Arms Race',
    description: 'A diverse founding population with size gaps large enough for predation from day one.',
    config: { foodPerDay: 90, mutationRate: 0.1, initialPopulation: 50, initialVariance: 0.18 },
  },
  {
    id: 'chaos',
    name: 'Hyper-Mutation Chaos',
    description: 'Maximum mutation. Offspring rarely resemble their parents.',
    config: { foodPerDay: 100, mutationRate: 0.3, initialPopulation: 50, initialVariance: 0.1 },
  },
];
