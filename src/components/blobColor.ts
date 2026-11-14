import type { ResourceType } from '../engine/types';

export const RESOURCE_COLORS: Record<ResourceType, string> = {
  food: '#b6f36b',
  timber: '#c48a52',
  stone: '#aab3c5',
};

export interface TribePalette {
  fill: string;
  stroke: string;
  rgb: [number, number, number];
  /** `rgba()` of the tribe colour at the given opacity. */
  alpha: (a: number) => string;
}

const cache = new Map<string, TribePalette>();

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function tribePalette(color: string): TribePalette {
  let p = cache.get(color);
  if (!p) {
    const rgb = parseHex(color);
    const [r, g, b] = rgb;
    p = {
      rgb,
      fill: color,
      stroke: `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`,
      alpha: (a) => `rgba(${r},${g},${b},${a})`,
    };
    cache.set(color, p);
  }
  return p;
}
