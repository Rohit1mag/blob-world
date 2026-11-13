import { GENE_RANGES, type Genes } from '../engine/types';

const cache = new WeakMap<Genes, { fill: string; stroke: string; rgb: [number, number, number] }>();

function channel(base: number, delta: number): number {
  const t = Math.min(1, Math.max(0, base + delta));
  return Math.round(40 + 215 * t);
}

/**
 * R = max speed, G = size, B = sense radius, each measured as log-ratio from the default
 * so the founding population reads as steel blue and drift in any trait shifts the hue.
 */
export function blobRGB(g: Genes): [number, number, number] {
  return [
    channel(0.35, Math.log(g.maxSpeed / GENE_RANGES.maxSpeed.default) * 1.1),
    channel(0.5, Math.log(g.size / GENE_RANGES.size.default) * 1.3),
    channel(0.78, Math.log(g.senseRadius / GENE_RANGES.senseRadius.default) * 0.8),
  ];
}

export function blobColors(g: Genes) {
  let c = cache.get(g);
  if (!c) {
    const rgb = blobRGB(g);
    const [r, gr, b] = rgb;
    c = {
      rgb,
      fill: `rgb(${r},${gr},${b})`,
      stroke: `rgb(${Math.round(r * 0.55)},${Math.round(gr * 0.55)},${Math.round(b * 0.55)})`,
    };
    cache.set(g, c);
  }
  return c;
}
