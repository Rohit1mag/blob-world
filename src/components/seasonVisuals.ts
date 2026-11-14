export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface SeasonWeights {
  summer: number;
  fall: number;
  winter: number;
}

/** Visual blend weights for summer, fall and winter at a fractional point in the year. */
export function seasonWeights(f: number): SeasonWeights {
  const winter = smoothstep(0.76, 0.84, f) * (1 - smoothstep(0.97, 1, f));
  const fall = smoothstep(0.55, 0.65, f) * (1 - smoothstep(0.76, 0.84, f));
  return { summer: Math.max(0, 1 - winter - fall), fall, winter };
}
