import type { SimulationEngine } from '../engine/SimulationEngine';
import type { Tribe } from '../engine/types';

const POINTS = 56;
/** Land claimed past a building's edge so outlying districts sit inside the border. */
const STRUCTURE_MARGIN = 34;
/** Angular reach (radians) of the bulge each outlying building pushes into the border. */
const BULGE_SPREAD = 0.55;

/**
 * Irregular border around a camp: a lumpy outline at the tribe's territory radius,
 * stretched outward wherever its buildings have spread.
 */
export function territoryOutline(engine: SimulationEngine, t: Tribe, scale = 1, followBuildings = true): [number, number][] {
  const { x, y } = t.basePosition;
  const base = t.territory * scale;
  const p1 = t.id * 1.7 + 0.4;
  const p2 = t.id * 2.9 + 1.3;
  const p3 = t.id * 4.1 + 2.2;
  const radii = new Float32Array(POINTS);
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    radii[i] = base * (1 + 0.08 * Math.sin(3 * a + p1) + 0.05 * Math.sin(5 * a + p2) + 0.035 * Math.sin(8 * a + p3));
  }
  if (followBuildings) {
    for (const s of engine.structures) {
      if (s.tribeId !== t.id || s.type === 'townCenter') continue;
      const d = Math.hypot(s.x - x, s.y - y);
      const reach = (d + s.radius + STRUCTURE_MARGIN) * scale;
      if (reach <= base * 0.8) continue;
      const sa = Math.atan2(s.y - y, s.x - x);
      for (let i = 0; i < POINTS; i++) {
        const a = (i / POINTS) * Math.PI * 2;
        let diff = Math.abs(a - sa) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff >= BULGE_SPREAD) continue;
        const w = 0.5 + 0.5 * Math.cos((diff / BULGE_SPREAD) * Math.PI);
        radii[i] = Math.max(radii[i], radii[i] + (reach - radii[i]) * w);
      }
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * Math.PI * 2;
    out.push([x + Math.cos(a) * radii[i], y + Math.sin(a) * radii[i]]);
  }
  return out;
}

export function traceOutline(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  const n = pts.length;
  // Midpoint quadratic smoothing keeps the border organic instead of faceted.
  const mid = (i: number): [number, number] => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const start = mid(n - 1);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}
