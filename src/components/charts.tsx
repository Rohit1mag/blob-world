import { useMemo, useState, type ReactNode } from 'react';
import { useElementSize } from './useElementSize';

export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const span = hi - lo;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Monotone cubic (Fritsch–Carlson) path: smooth without overshooting the data. */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  m[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + m[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - m[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Indices to plot so long histories stay ~1 point per 2px. Always keeps the last point. */
function sampleIndices(n: number, maxPoints: number): number[] {
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  const stride = n / maxPoints;
  const out: number[] = [];
  for (let k = 0; k < maxPoints - 1; k++) out.push(Math.floor(k * stride));
  out.push(n - 1);
  return out;
}

export interface Series {
  id: string;
  label: string;
  color: string;
  values: number[];
  area?: boolean;
  dashed?: boolean;
  format?: (v: number) => string;
}

interface LineChartProps {
  xs: number[];
  series: Series[];
  height: number;
  yMin?: number;
  baseline?: number;
  yFormat?: (v: number) => string;
  xLabel?: string;
}

const M = { l: 34, r: 10, t: 10, b: 22 };

export function LineChart({ xs, series, height, yMin, baseline, yFormat = (v) => String(v), xLabel }: LineChartProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = xs.length;
  const innerW = Math.max(1, width - M.l - M.r);
  const innerH = height - M.t - M.b;

  const geom = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const v of s.values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (baseline !== undefined) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (yMin !== undefined) lo = yMin;
    if (!isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    const pad = (hi - lo) * 0.08 || 0.5;
    const yTicks = niceTicks(yMin !== undefined ? lo : lo - pad, hi + pad, 4);
    const y0 = yTicks[0];
    const y1 = yTicks[yTicks.length - 1];
    const x0 = xs[0] ?? 0;
    const x1 = n > 1 ? xs[n - 1] : x0 + 1;
    const sx = (x: number) => M.l + ((x - x0) / (x1 - x0)) * innerW;
    const sy = (y: number) => M.t + (1 - (y - y0) / (y1 - y0)) * innerH;
    const idx = sampleIndices(n, Math.max(2, Math.floor(innerW / 2)));
    const paths = series.map((s) => {
      const pts = idx.map((i) => [sx(xs[i]), sy(s.values[i])] as [number, number]);
      const line = monotonePath(pts);
      const area =
        s.area && pts.length > 1
          ? `${line}L${pts[pts.length - 1][0].toFixed(1)},${sy(y0).toFixed(1)}L${pts[0][0].toFixed(1)},${sy(y0).toFixed(1)}Z`
          : null;
      return { id: s.id, line, area };
    });
    const xTicks = niceTicks(x0, x1, Math.max(2, Math.floor(innerW / 70))).filter(
      (t) => t >= x0 && t <= x1 && Number.isInteger(t),
    );
    return { yTicks, xTicks, sx, sy, paths };
  }, [xs, series, n, innerW, innerH, yMin, baseline]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left - M.l) / innerW;
    setHover(Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1)))));
  };

  const hx = hover !== null && hover < n ? geom.sx(xs[hover]) : null;
  const gradId = (id: string) => `grad-${id}`;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block">
          <defs>
            {series
              .filter((s) => s.area)
              .map((s) => (
                <linearGradient key={s.id} id={gradId(s.id)} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
          </defs>
          {geom.yTicks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={width - M.r} y1={geom.sy(t)} y2={geom.sy(t)} stroke="#263045" strokeWidth={1} />
              <text x={M.l - 6} y={geom.sy(t)} dy="0.32em" textAnchor="end" className="fill-ink-500 font-mono text-[9px]">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {geom.xTicks.map((t) => (
            <text
              key={t}
              x={geom.sx(t)}
              y={height - 6}
              textAnchor="middle"
              className="fill-ink-500 font-mono text-[9px]"
            >
              {t}
            </text>
          ))}
          {xLabel && (
            <text x={width - M.r} y={height - 6} textAnchor="end" className="fill-ink-600 text-[9px]">
              {xLabel}
            </text>
          )}
          {baseline !== undefined && (
            <line
              x1={M.l}
              x2={width - M.r}
              y1={geom.sy(baseline)}
              y2={geom.sy(baseline)}
              stroke="#7d89a3"
              strokeOpacity={0.5}
              strokeDasharray="3 4"
            />
          )}
          {geom.paths.map((p, i) => (
            <g key={p.id}>
              {p.area && <path d={p.area} fill={`url(#${gradId(p.id)})`} />}
              <path
                d={p.line}
                fill="none"
                stroke={series[i].color}
                strokeWidth={series[i].dashed ? 1.2 : 1.8}
                strokeDasharray={series[i].dashed ? '4 4' : undefined}
                strokeOpacity={series[i].dashed ? 0.6 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          ))}
          {hx !== null && hover !== null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={M.t} y2={M.t + innerH} stroke="#a7b1c6" strokeOpacity={0.35} />
              {series.map((s) => (
                <circle
                  key={s.id}
                  cx={hx}
                  cy={geom.sy(s.values[hover])}
                  r={3}
                  fill={s.color}
                  stroke="#111723"
                  strokeWidth={1.5}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      {hx !== null && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 rounded-md border border-ink-600/70 bg-ink-900/95 px-2 py-1.5 font-mono text-[10px] shadow-lg"
          style={hx > width / 2 ? { right: width - hx + 8 } : { left: hx + 8 }}
        >
          <div className="mb-0.5 text-ink-400">Day {xs[hover]}</div>
          {series.map((s) => (
            <div key={s.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              <span className="text-ink-400">{s.label}</span>
              <span className="ml-auto pl-2 text-ink-200 tabular-nums">
                {(s.format ?? yFormat)(s.values[hover])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface HistogramProps {
  values: number[];
  min: number;
  max: number;
  bins: number;
  color: string;
  height: number;
  label: ReactNode;
  format: (v: number) => string;
  reference?: number;
}

export function Histogram({ values, min, max, bins, color, height, label, format, reference }: HistogramProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const { counts, peak, mean } = useMemo(() => {
    const counts = new Array<number>(bins).fill(0);
    let sum = 0;
    for (const v of values) {
      const i = Math.min(bins - 1, Math.max(0, Math.floor(((v - min) / (max - min)) * bins)));
      counts[i]++;
      sum += v;
    }
    return { counts, peak: Math.max(1, ...counts), mean: values.length ? sum / values.length : NaN };
  }, [values, min, max, bins]);

  const l = 4;
  const r = 4;
  const t = 4;
  const b = 14;
  const innerW = Math.max(1, width - l - r);
  const innerH = height - t - b;
  const bw = innerW / bins;
  const sx = (v: number) => l + ((v - min) / (max - min)) * innerW;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-medium text-ink-300">{label}</span>
        <span className="font-mono text-ink-400 tabular-nums">
          μ <span style={{ color }}>{isNaN(mean) ? '–' : format(mean)}</span>
        </span>
      </div>
      <div ref={ref} style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="block">
            <line x1={l} x2={width - r} y1={t + innerH + 0.5} y2={t + innerH + 0.5} stroke="#364159" />
            {counts.map((c, i) =>
              c === 0 ? null : (
                <rect
                  key={i}
                  x={l + i * bw + 0.75}
                  y={t + innerH - (c / peak) * innerH}
                  width={Math.max(0.5, bw - 1.5)}
                  height={(c / peak) * innerH}
                  rx={1}
                  fill={color}
                  fillOpacity={0.78}
                />
              ),
            )}
            {reference !== undefined && (
              <line
                x1={sx(reference)}
                x2={sx(reference)}
                y1={t}
                y2={t + innerH}
                stroke="#a7b1c6"
                strokeOpacity={0.45}
                strokeDasharray="2 3"
              />
            )}
            {!isNaN(mean) && (
              <path
                d={`M${sx(mean) - 3.5},${t + innerH + 8} L${sx(mean) + 3.5},${t + innerH + 8} L${sx(mean)},${t + innerH + 3} Z`}
                fill={color}
              />
            )}
            <text x={l} y={height - 1} className="fill-ink-500 font-mono text-[8.5px]">
              {format(min)}
            </text>
            <text x={width - r} y={height - 1} textAnchor="end" className="fill-ink-500 font-mono text-[8.5px]">
              {format(max)}
            </text>
          </svg>
        )}
      </div>
    </div>
  );
}

interface ScatterProps {
  points: { x: number; y: number; color: string }[];
  xRange: [number, number];
  yRange: [number, number];
  height: number;
  xLabel: string;
  yLabel: string;
  reference?: [number, number];
}

export function ScatterPlot({ points, xRange, yRange, height, xLabel, yLabel, reference }: ScatterProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>();
  const l = 30;
  const r = 6;
  const t = 6;
  const b = 20;
  const innerW = Math.max(1, width - l - r);
  const innerH = height - t - b;
  const sx = (v: number) => l + ((v - xRange[0]) / (xRange[1] - xRange[0])) * innerW;
  const sy = (v: number) => t + (1 - (v - yRange[0]) / (yRange[1] - yRange[0])) * innerH;
  const xTicks = niceTicks(xRange[0], xRange[1], 5).filter((v) => v >= xRange[0] && v <= xRange[1]);
  const yTicks = niceTicks(yRange[0], yRange[1], 4).filter((v) => v >= yRange[0] && v <= yRange[1]);

  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="block">
          <rect x={l} y={t} width={innerW} height={innerH} fill="#121927" rx={3} />
          {xTicks.map((v) => (
            <g key={`x${v}`}>
              <line x1={sx(v)} x2={sx(v)} y1={t} y2={t + innerH} stroke="#1f2839" />
              <text x={sx(v)} y={height - 8} textAnchor="middle" className="fill-ink-500 font-mono text-[8.5px]">
                {v}
              </text>
            </g>
          ))}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={l} x2={l + innerW} y1={sy(v)} y2={sy(v)} stroke="#1f2839" />
              <text x={l - 4} y={sy(v)} dy="0.32em" textAnchor="end" className="fill-ink-500 font-mono text-[8.5px]">
                {v}
              </text>
            </g>
          ))}
          {reference && (
            <>
              <line x1={sx(reference[0])} x2={sx(reference[0])} y1={t} y2={t + innerH} stroke="#7d89a3" strokeOpacity={0.4} strokeDasharray="2 3" />
              <line x1={l} x2={l + innerW} y1={sy(reference[1])} y2={sy(reference[1])} stroke="#7d89a3" strokeOpacity={0.4} strokeDasharray="2 3" />
            </>
          )}
          {points.map((p, i) => (
            <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.6} fill={p.color} fillOpacity={0.85} />
          ))}
          <text x={l + innerW} y={height - 0.5} textAnchor="end" className="fill-ink-400 text-[9px]">
            {xLabel} →
          </text>
          <text
            x={8}
            y={t}
            transform={`rotate(-90 8 ${t})`}
            textAnchor="end"
            dy="0.32em"
            className="fill-ink-400 text-[9px]"
          >
            {yLabel} →
          </text>
        </svg>
      )}
    </div>
  );
}
