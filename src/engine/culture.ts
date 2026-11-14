import type { Random } from './random';
import type {
  ArchStyle,
  Culture,
  CultureTrait,
  Invention,
  InventionDomain,
  ModKey,
  Mods,
  Pressures,
  ResourceType,
} from './types';

export const TRAITS: CultureTrait[] = ['martial', 'commerce', 'faith', 'craft'];

export const TRAIT_LABEL: Record<CultureTrait, string> = {
  martial: 'Warlike',
  commerce: 'Mercantile',
  faith: 'Devout',
  craft: 'Industrious',
};

export const TRAIT_COLOR: Record<CultureTrait, string> = {
  martial: '#ff7a6b',
  commerce: '#ffd166',
  faith: '#c99bff',
  craft: '#6fc3ff',
};

export const STYLE_OF_TRAIT: Record<CultureTrait, ArchStyle> = {
  martial: 'fortress',
  commerce: 'bazaar',
  faith: 'temple',
  craft: 'forge',
};

const HYBRID_ETHOS: Record<string, string> = {
  'martial+commerce': 'Corsair',
  'martial+faith': 'Crusader',
  'martial+craft': 'Ironclad',
  'commerce+faith': 'Pilgrim',
  'commerce+craft': 'Guild',
  'faith+craft': 'Temple-Builder',
};

/** Each trait's share in an even culture (the four traits always sum to 1). */
export const CULTURE_BASELINE = 0.25;

export function emptyPressures(): Pressures {
  return { war: 0, hunger: 0, cold: 0, water: 0, trade: 0, build: 0, wealth: 0, devotion: 0 };
}

/** Experiences that pull a culture toward each trait. */
export function traitSignals(p: Pressures): Culture {
  return {
    martial: p.war,
    commerce: p.trade + p.wealth * 0.3,
    faith: p.devotion + (p.cold + p.hunger) * 0.3,
    craft: p.build + p.wealth * 0.4,
  };
}

/**
 * Each tribe's pressures relative to the world average, so a culture is shaped by what sets it
 * apart (the camp that trades more than its neighbours turns mercantile even if everyone fights).
 */
export function relativePressures(all: Pressures[], mine: Pressures): Pressures {
  const out = emptyPressures();
  for (const k of Object.keys(out) as (keyof Pressures)[]) {
    let mean = 0;
    for (const p of all) mean += p[k];
    mean /= Math.max(1, all.length);
    out[k] = mine[k] / (mean + 0.5);
  }
  return out;
}

/** Nudge a culture toward the traits its experiences stand out in; traits always sum to 1. */
export function driftCulture(c: Culture, signals: Culture, worldMean: Culture, rate: number): void {
  const share = { ...c };
  let total = 0;
  for (const k of TRAITS) {
    share[k] = 0.6 + signals[k] / (worldMean[k] + 0.5);
    total += share[k];
  }
  for (const k of TRAITS) c[k] = c[k] * (1 - rate) + (share[k] / total) * rate;
  normalizeCulture(c);
}

export function normalizeCulture(c: Culture): void {
  let total = 0;
  for (const k of TRAITS) total += Math.max(0.01, c[k]);
  for (const k of TRAITS) c[k] = Math.max(0.01, c[k]) / total;
}

export function randomCulture(rng: Random): Culture {
  const c = {
    martial: rng.range(0.15, 0.4),
    commerce: rng.range(0.15, 0.4),
    faith: rng.range(0.15, 0.4),
    craft: rng.range(0.15, 0.4),
  };
  normalizeCulture(c);
  return c;
}

export function inheritCulture(parent: Culture, rng: Random): Culture {
  const c = { ...parent };
  for (const k of TRAITS) c[k] = Math.max(0.01, c[k] + rng.range(-0.06, 0.06));
  normalizeCulture(c);
  return c;
}

export function dominantTrait(c: Culture): CultureTrait {
  let best: CultureTrait = 'martial';
  for (const k of TRAITS) if (c[k] > c[best]) best = k;
  return best;
}

/** Share a trait needs before the culture is said to hold it. */
export const DEVOTED_SHARE = 0.32;

export function ethosOf(c: Culture): string {
  const ranked = [...TRAITS].sort((a, b) => c[b] - c[a]);
  const [top, second] = ranked;
  if (c[top] < 0.3) return 'Pragmatic';
  if (c[second] >= 0.28 && c[second] >= c[top] * 0.85) {
    const key = TRAITS.indexOf(top) < TRAITS.indexOf(second) ? `${top}+${second}` : `${second}+${top}`;
    return HYBRID_ETHOS[key];
  }
  return TRAIT_LABEL[top];
}

/** Traits a culture label stands for ("Crusader" → martial + faith). */
export function ethosTraits(ethos: string): CultureTrait[] {
  for (const k of TRAITS) if (TRAIT_LABEL[k] === ethos) return [k];
  for (const [key, label] of Object.entries(HYBRID_ETHOS)) if (label === ethos) return key.split('+') as CultureTrait[];
  return [];
}

export function withArticle(word: string): string {
  return /^[AEIOU]/i.test(word) ? `an ${word}` : `a ${word}`;
}

interface DomainSpec {
  trait: CultureTrait;
  effects: [ModKey, number][];
  /** Adjective used when this field flavours another, e.g. "Sacred" in "Sacred Spears". */
  adjective: string;
  /** Suffix form of the same flavour for multi-word names, e.g. "Signal Fires of the Gods". */
  of: string;
  /** Inventions by era: primitive, classical, industrial, modern. */
  names: [string[], string[], string[], string[]];
}

export const DOMAINS: Record<InventionDomain, DomainSpec> = {
  warfare: {
    trait: 'martial',
    effects: [
      ['attack', 0.16],
      ['armor', 0.05],
    ],
    adjective: 'War',
    of: 'of War',
    names: [
      ['Spears', 'Slings', 'War Clubs', 'Hunting Bows'],
      ['Bronze Swords', 'Chariots', 'Pikes', 'Longbows'],
      ['Muskets', 'Cannons', 'Crossbows', 'Cavalry'],
      ['Rifles', 'Tanks', 'Rocket Artillery', 'Drones'],
    ],
  },
  defense: {
    trait: 'martial',
    effects: [
      ['fortify', 0.28],
      ['armor', 0.08],
      ['towers', 0.18],
    ],
    adjective: 'Armored',
    of: 'of the Wall',
    names: [
      ['Hide Shields', 'Palisades', 'Ditches', 'Signal Fires'],
      ['Bronze Armor', 'Stone Walls', 'Moats', 'Gatehouses'],
      ['Plate Armor', 'Star Forts', 'Bastions', 'Garrisons'],
      ['Kevlar', 'Bunkers', 'Radar', 'Missile Shields'],
    ],
  },
  agriculture: {
    trait: 'craft',
    effects: [
      ['farming', 0.35],
      ['harvest', 0.07],
    ],
    adjective: 'Harvest',
    of: 'of the Harvest',
    names: [
      ['Seed Saving', 'Digging Sticks', 'Berry Terraces', 'Gathering Baskets'],
      ['Irrigation', 'Plows', 'Crop Rotation', 'Orchards'],
      ['Seed Drills', 'Windmills', 'Greenhouses', 'Selective Breeding'],
      ['Fertilizer', 'Tractors', 'Hydroponics', 'Vertical Farms'],
    ],
  },
  medicine: {
    trait: 'faith',
    effects: [
      ['medicine', 0.22],
      ['warmth', 0.12],
    ],
    adjective: 'Healing',
    of: 'of Healing',
    names: [
      ['Herbal Poultices', 'Fur Cloaks', 'Bone Setting', 'Sweat Lodges'],
      ['Bathhouses', 'Wool Weaving', 'Surgery', 'Aqueducts'],
      ['Vaccines', 'Sanitation', 'Quarantine', 'Anesthesia'],
      ['Antibiotics', 'Central Heating', 'Gene Therapy', 'Nanomedicine'],
    ],
  },
  construction: {
    trait: 'craft',
    effects: [
      ['build', 0.2],
      ['thrift', 0.07],
    ],
    adjective: 'Engineered',
    of: 'of the Builders',
    names: [
      ['Mud Bricks', 'Rope Lashing', 'Stone Tools', 'Thatch'],
      ['Arches', 'Mortar', 'Cranes', 'Pulleys'],
      ['Steel Beams', 'Concrete', 'Steam Hammers', 'Blueprints'],
      ['Prefab Towers', 'Power Tools', '3D Printing', 'Smart Cranes'],
    ],
  },
  travel: {
    trait: 'commerce',
    effects: [
      ['speed', 0.07],
      ['carry', 1],
    ],
    adjective: 'Swift',
    of: 'of the Road',
    names: [
      ['Sledges', 'Trail Markers', 'Carrying Poles', 'Footwraps'],
      ['Wheels', 'Pack Saddles', 'Maps', 'Milestones'],
      ['Railways', 'Compasses', 'Wagons', 'Bicycles'],
      ['Automobiles', 'GPS', 'Maglev', 'Cargo Drones'],
    ],
  },
  seafaring: {
    trait: 'commerce',
    effects: [
      ['swim', 0.3],
      ['harvest', 0.05],
    ],
    adjective: 'Sea',
    of: 'of the Sea',
    names: [
      ['Rafts', 'Reed Boats', 'Fishing Nets', 'Dugouts'],
      ['Canoes', 'Sailboats', 'Harpoons', 'Rowing Galleys'],
      ['Galleons', 'Lighthouses', 'Trawlers', 'Paddle Steamers'],
      ['Steamships', 'Hovercraft', 'Submarines', 'Container Ships'],
    ],
  },
  commerce: {
    trait: 'commerce',
    effects: [
      ['trade', 0.45],
      ['preserve', 0.14],
    ],
    adjective: 'Merchant',
    of: 'of the Market',
    names: [
      ['Barter Tokens', 'Salted Meat', 'Tally Sticks', 'Clay Pots'],
      ['Coinage', 'Caravans', 'Amphorae', 'Weights & Measures'],
      ['Banking', 'Canning', 'Stock Exchanges', 'Paper Money'],
      ['Refrigeration', 'Credit', 'E-Commerce', 'Crypto Ledgers'],
    ],
  },
  knowledge: {
    trait: 'craft',
    effects: [
      ['insight', 0.3],
      ['sense', 0.06],
    ],
    adjective: 'Scholar',
    of: 'of the Sages',
    names: [
      ['Cave Paintings', 'Counting', 'Star Lore', 'Knot Records'],
      ['Writing', 'Geometry', 'Calendars', 'Libraries'],
      ['Printing Press', 'Telescopes', 'Universities', 'Encyclopedias'],
      ['Computers', 'Satellites', 'Internet', 'Quantum Labs'],
    ],
  },
  faith: {
    trait: 'faith',
    effects: [
      ['loyalty', 0.012],
      ['warmth', 0.06],
      ['medicine', 0.06],
    ],
    adjective: 'Sacred',
    of: 'of the Gods',
    names: [
      ['Ancestor Shrines', 'Totems', 'Rain Dances', 'Burial Mounds'],
      ['Temples', 'Oracles', 'Scripture', 'Holy Days'],
      ['Cathedrals', 'Pilgrimages', 'Monasteries', 'Missionaries'],
      ['Megachurches', 'Broadcast Sermons', 'Mindfulness', 'Space Prophets'],
    ],
  },
};

const DOMAIN_KEYS = Object.keys(DOMAINS) as InventionDomain[];

const MOD_CAP: Record<ModKey, number> = {
  attack: 1.2,
  armor: 0.6,
  fortify: 1.6,
  towers: 0.8,
  build: 1.5,
  thrift: 0.45,
  harvest: 0.6,
  carry: 4,
  speed: 0.45,
  warmth: 0.6,
  medicine: 0.85,
  preserve: 0.8,
  farming: 2.5,
  loyalty: 0.06,
  insight: 2,
  swim: 0.85,
  sense: 0.4,
  trade: 2.5,
};

export function computeMods(inventions: Invention[]): Mods {
  const mods: Mods = {};
  for (const inv of inventions) {
    for (const [k, v] of Object.entries(inv.effects) as [ModKey, number][]) mods[k] = (mods[k] ?? 0) + v;
  }
  for (const k of Object.keys(mods) as ModKey[]) mods[k] = Math.min(MOD_CAP[k], mods[k]!);
  return mods;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function describeEffects(effects: Mods, firstSwim = false): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(effects) as [ModKey, number][]) {
    if (k === 'attack') parts.push(`+${pct(v)} attack`);
    else if (k === 'armor') parts.push(`+${pct(v)} armor`);
    else if (k === 'fortify') parts.push(`+${pct(v)} wall strength`);
    else if (k === 'towers') parts.push(`+${pct(v)} tower range`);
    else if (k === 'build') parts.push(`+${pct(v)} build speed`);
    else if (k === 'thrift') parts.push(`−${pct(v)} building costs`);
    else if (k === 'harvest') parts.push(`+${pct(v)} food per haul`);
    else if (k === 'carry') parts.push(`+${Math.round(v)} carry`);
    else if (k === 'speed') parts.push(`+${pct(v)} speed`);
    else if (k === 'warmth') parts.push(`−${pct(v)} winter chill`);
    else if (k === 'medicine') parts.push(`−${pct(v)} disease`);
    else if (k === 'preserve') parts.push(`−${pct(v)} spoilage`);
    else if (k === 'farming') parts.push(`+${pct(v)} farm yield`);
    else if (k === 'loyalty') parts.push('steadier loyalty');
    else if (k === 'insight') parts.push(`+${pct(v)} research`);
    else if (k === 'swim') parts.push(firstSwim ? 'can cross water' : `+${pct(v)} swim speed`);
    else if (k === 'sense') parts.push(`+${pct(v)} senses`);
    else if (k === 'trade') parts.push(`+${pct(v)} trade income`);
  }
  return parts.join(', ');
}

export interface InventionContext {
  culture: Culture;
  pressure: Pressures;
  nearWater: boolean;
  hasLab: boolean;
  winter: boolean;
  richest: ResourceType;
  tribeName: string;
  known: Invention[];
  maxTier: number;
  day: number;
  inventorId: number;
}

/** `ctx.pressure` is relative to the world average (1 = typical). */
function domainWeights(ctx: InventionContext): Record<InventionDomain, number> {
  const p = ctx.pressure;
  const c = ctx.culture;
  const w: Record<InventionDomain, number> = {
    warfare: p.war + c.martial * 4,
    defense: p.war * 0.7 + p.wealth * 0.3 + c.martial * 3,
    agriculture: 0.3 + p.hunger + c.craft * 2,
    medicine: p.cold + p.hunger * 0.3 + c.faith * 3,
    construction: p.build + p.wealth * 0.5 + c.craft * 3,
    travel: p.trade * 0.7 + c.commerce * 3,
    seafaring: p.water * 0.8 + c.commerce * 2,
    commerce: p.trade + p.wealth * 0.4 + c.commerce * 4,
    knowledge: 0.5 + c.craft * 2 + (ctx.hasLab ? 1 : 0),
    faith: p.devotion + c.faith * 4,
  };
  // Fields already explored grow stale, so a long history wanders into new territory.
  const explored = new Map<InventionDomain, number>();
  for (const inv of ctx.known) explored.set(inv.domain, (explored.get(inv.domain) ?? 0) + 1);
  for (const k of DOMAIN_KEYS) w[k] = (0.3 + Math.max(0, w[k])) * 0.85 ** (explored.get(k) ?? 0);
  if (!ctx.nearWater) w.seafaring = 0;
  return w;
}

function weightedPick(rng: Random, weights: Record<InventionDomain, number>, exclude?: InventionDomain): InventionDomain {
  let total = 0;
  for (const k of DOMAIN_KEYS) if (k !== exclude) total += weights[k] ** 1.5;
  let r = rng.next() * total;
  for (const k of DOMAIN_KEYS) {
    if (k === exclude) continue;
    r -= weights[k] ** 1.5;
    if (r <= 0) return k;
  }
  return DOMAIN_KEYS[0];
}

function demonym(name: string): string {
  const base = name.split(' ')[0];
  return base.endsWith('e') ? `${base.slice(0, -1)}ian` : `${base}ian`;
}

/**
 * Invent something shaped by what the tribe has lived through: its hardships pick the field,
 * its culture flavours it, and its land and history name it.
 */
export function createInvention(rng: Random, ctx: InventionContext): Invention {
  const weights = domainWeights(ctx);
  const domain = weightedPick(rng, weights);
  const runnerUp = weightedPick(rng, weights, domain);
  const hybrid = weights[runnerUp] >= weights[domain] * 0.5 && rng.next() < 0.35 ? runnerUp : undefined;

  const byCount = 1 + Math.floor(ctx.known.length / 4);
  const tier = Math.max(1, Math.min(4, byCount, ctx.maxTier));
  const spec = DOMAINS[domain];
  const takenNames = new Set(ctx.known.map((k) => k.name));
  const usedNoun = (noun: string) => ctx.known.some((k) => k.name === noun || k.name.endsWith(` ${noun}`));

  let pool = spec.names[tier - 1].filter((n) => !usedNoun(n));
  for (let t = tier - 1; pool.length === 0 && t >= 1; t--) pool = spec.names[t - 1].filter((n) => !usedNoun(n));
  if (pool.length === 0) pool = spec.names[tier - 1];
  const noun = pool[Math.floor(rng.next() * pool.length)];

  // Only one-word nouns take a prefix, so names stay readable ("Sacred Spears", not "Iron Bronze Swords").
  const simple = !noun.includes(' ');
  let name: string;
  if (hybrid) {
    name = simple ? `${DOMAINS[hybrid].adjective} ${noun}` : `${noun} ${DOMAINS[hybrid].of}`;
  } else {
    const roll = rng.next();
    if (roll < 0.18) {
      name = `${demonym(ctx.tribeName)} ${noun}`;
    } else if (roll < 0.5 && simple) {
      const prefixes: string[] = [];
      if (ctx.winter) prefixes.push('Frost', 'Winter');
      if (ctx.nearWater) prefixes.push('River', 'Tide');
      if (ctx.richest === 'stone') prefixes.push(tier >= 3 ? 'Steel' : 'Granite', 'Flint');
      else if (ctx.richest === 'timber') prefixes.push('Oaken', 'Cedar');
      else prefixes.push('Golden', 'Meadow');
      if (ctx.pressure.war > 1.5) prefixes.push('Blood', 'Iron');
      name = `${prefixes[Math.floor(rng.next() * prefixes.length)]} ${noun}`;
    } else {
      name = noun;
    }
  }
  if (takenNames.has(name)) name = `${demonym(ctx.tribeName)} ${noun}`;
  if (takenNames.has(name)) name = `${noun} ${['II', 'III', 'IV', 'V'][Math.min(3, ctx.known.length % 4)]}`;

  const strength = (0.8 + 0.2 * tier) * rng.range(0.85, 1.15);
  const effects: Mods = {};
  for (const [k, v] of spec.effects) effects[k] = k === 'carry' ? (tier >= 3 ? 2 : 1) : v * strength;
  if (hybrid) {
    const [hk, hv] = DOMAINS[hybrid].effects[0];
    effects[hk] = (effects[hk] ?? 0) + (hk === 'carry' ? 1 : hv * strength * 0.5);
  }
  return { name, domain, hybrid, tier, effects, day: ctx.day, inventorId: ctx.inventorId };
}
