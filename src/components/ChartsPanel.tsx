import { memo, useMemo, type ReactNode } from 'react';
import { GENE_RANGES, type Genes, type GenerationStats } from '../engine/types';
import { blobColors } from './blobColor';
import { Histogram, LineChart, ScatterPlot, type Series } from './charts';

const SPEED = '#ff7a7a';
const SIZE = '#5fe39a';
const SENSE = '#6aa8ff';
const POP = '#e8edf6';
const FOOD = '#b6f36b';
const HOME = '#5eead4';
/** Mean home-survival rate, sustained over a trailing window, at which homing counts as "learned". */
const EMERGENCE_THRESHOLD = 0.5;
const EMERGENCE_WINDOW = 5;

interface ChartsPanelProps {
  history: GenerationStats[];
  genes: Genes[];
  day: number;
  /** Changes whenever `history`/`genes` were mutated in place by the engine. */
  revision: number;
}

function Card({ title, subtitle, legend, children }: { title: string; subtitle?: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 pt-3 pb-3">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold tracking-wide text-ink-200">{title}</h2>
          {subtitle && <p className="text-[10.5px] text-ink-500">{subtitle}</p>}
        </div>
        {legend && <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px]">{legend}</div>}
      </header>
      {children}
    </section>
  );
}

function LegendItem({ color, label, value, dashed }: { color: string; label: string; value?: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-400">
      <span
        className="inline-block h-0.5 w-3 rounded-full"
        style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 50%, transparent 50%)`, backgroundSize: '4px 2px' } : { background: color }}
      />
      {label}
      {value && <span className="font-mono text-ink-200 tabular-nums">{value}</span>}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9.5px] font-medium tracking-wider text-ink-500 uppercase">{label}</span>
      <span className="font-mono text-[15px] font-medium text-ink-200 tabular-nums" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  );
}

export const ChartsPanel = memo(function ChartsPanel({ history, genes, day, revision }: ChartsPanelProps) {
  // `history` is appended in place, so derive everything from `revision`.
  const derived = useMemo(() => {
    const xs = history.map((h) => h.day);
    const population: Series[] = [
      { id: 'pop', label: 'Population', color: POP, values: history.map((h) => h.population), area: true },
      { id: 'food', label: 'Food / day', color: FOOD, values: history.map((h) => h.foodPerDay), dashed: true },
    ];
    const pct = (v: number) => `${v.toFixed(2)}×`;
    const traits: Series[] = [
      { id: 'speed', label: 'Max speed', color: SPEED, values: history.map((h) => h.avgSpeed / GENE_RANGES.maxSpeed.default), format: pct },
      { id: 'size', label: 'Size', color: SIZE, values: history.map((h) => h.avgSize / GENE_RANGES.size.default), format: pct },
      {
        id: 'sense',
        label: 'Sense',
        color: SENSE,
        values: history.map((h) => h.avgSense / GENE_RANGES.senseRadius.default),
        format: pct,
      },
    ];
    // Day 0 is the untested founding population, so behaviour series start at day 1.
    const days = history.slice(1);
    const behaviour: Series[] = [
      {
        id: 'home',
        label: 'Home survival',
        color: HOME,
        values: days.map((h) => h.homeRate),
        area: true,
        format: (v) => `${Math.round(v * 100)}%`,
      },
      {
        id: 'avgFood',
        label: 'Food / blob',
        color: FOOD,
        values: days.map((h) => h.avgFood),
        format: (v) => v.toFixed(2),
      },
    ];
    const emergenceIdx = days.findIndex((_, i) => {
      if (i < EMERGENCE_WINDOW - 1) return false;
      let sum = 0;
      for (let k = i - EMERGENCE_WINDOW + 1; k <= i; k++) sum += days[k].homeRate;
      return sum / EMERGENCE_WINDOW >= EMERGENCE_THRESHOLD;
    });
    const scatter = genes.map((g) => ({ x: g.maxSpeed, y: g.size, color: blobColors(g).fill }));
    return {
      xs,
      population,
      traits,
      behaviourXs: days.map((h) => h.day),
      behaviour,
      emergenceDay: emergenceIdx >= 0 ? days[emergenceIdx].day : null,
      backfilledTotal: days.reduce((s, h) => s + h.backfilled, 0),
      scatter,
      speeds: genes.map((g) => g.maxSpeed),
      sizes: genes.map((g) => g.size),
      senses: genes.map((g) => g.senseRadius),
    };
  }, [revision, history, genes]);

  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const delta = last && prev ? last.population - prev.population : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2 rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 py-3">
        <Stat label="Day" value={day} />
        <Stat
          label="Population"
          value={
            <>
              {last?.population ?? 0}
              {prev && (
                <span className={`ml-1 text-[11px] ${delta >= 0 ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>
                  {delta >= 0 ? '+' : ''}
                  {delta}
                </span>
              )}
            </>
          }
        />
        <Stat label="Home %" value={last && last.day > 0 ? `${Math.round(last.homeRate * 100)}` : '–'} tone={HOME} />
        <Stat label="Born" value={last?.born ?? 0} tone="#8be3b0" />
        <Stat label="Died" value={last ? `${last.starved + last.eaten}` : 0} tone="#f19aa6" />
      </div>

      <Card
        title="Behavioral emergence"
        subtitle={
          derived.emergenceDay !== null
            ? `Population learned to forage and return home by day ${derived.emergenceDay}`
            : 'Waiting for the population to learn to come home…'
        }
        legend={
          <>
            <LegendItem
              color={HOME}
              label="Home %"
              value={last && last.day > 0 ? `${Math.round(last.homeRate * 100)}%` : undefined}
            />
            <LegendItem color={FOOD} label="Food/blob" value={last && last.day > 0 ? last.avgFood.toFixed(2) : undefined} />
          </>
        }
      >
        <LineChart
          xs={derived.behaviourXs}
          series={derived.behaviour}
          height={120}
          yMin={0}
          yMax={1}
          xLabel="day"
          markers={
            derived.emergenceDay !== null ? [{ x: derived.emergenceDay, label: 'learned', color: HOME }] : undefined
          }
        />
        <p className="mt-1 text-[9.5px] text-ink-500">
          Home % = share of the day's blobs that ate and touched the border alive. Seeded from the fittest when below
          the population floor: {derived.backfilledTotal} so far.
        </p>
      </Card>

      <Card
        title="Population over generations"
        subtitle="Census at the end of each day"
        legend={
          <>
            <LegendItem color={POP} label="Blobs" />
            <LegendItem color={FOOD} label="Food" dashed />
          </>
        }
      >
        <LineChart xs={derived.xs} series={derived.population} height={128} yMin={0} xLabel="day" />
      </Card>

      <Card
        title="Trait evolution"
        subtitle="Population mean, relative to the founding default (1.0×)"
        legend={
          <>
            <LegendItem color={SPEED} label="Max speed" value={last ? last.avgSpeed.toFixed(2) : undefined} />
            <LegendItem color={SIZE} label="Size" value={last ? last.avgSize.toFixed(2) : undefined} />
            <LegendItem color={SENSE} label="Sense" value={last ? last.avgSense.toFixed(0) : undefined} />
          </>
        }
      >
        <LineChart
          xs={derived.xs}
          series={derived.traits}
          height={128}
          baseline={1}
          yFormat={(v) => `${v.toFixed(1)}×`}
          xLabel="day"
        />
      </Card>

      <Card title="Trait distribution" subtitle={`Generation alive on day ${day} · n = ${genes.length}`}>
        <div className="grid grid-cols-3 gap-3">
          <Histogram
            label={<span style={{ color: SPEED }}>Max speed</span>}
            values={derived.speeds}
            min={GENE_RANGES.maxSpeed.min}
            max={GENE_RANGES.maxSpeed.max}
            bins={18}
            color={SPEED}
            height={52}
            format={(v) => v.toFixed(1)}
            reference={GENE_RANGES.maxSpeed.default}
          />
          <Histogram
            label={<span style={{ color: SIZE }}>Size</span>}
            values={derived.sizes}
            min={GENE_RANGES.size.min}
            max={GENE_RANGES.size.max}
            bins={18}
            color={SIZE}
            height={52}
            format={(v) => v.toFixed(1)}
            reference={GENE_RANGES.size.default}
          />
          <Histogram
            label={<span style={{ color: SENSE }}>Sense</span>}
            values={derived.senses}
            min={GENE_RANGES.senseRadius.min}
            max={GENE_RANGES.senseRadius.max}
            bins={18}
            color={SENSE}
            height={52}
            format={(v) => v.toFixed(0)}
            reference={GENE_RANGES.senseRadius.default}
          />
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[10px]">
            <span className="font-medium text-ink-300">Max speed × Size</span>
            <span className="text-ink-500">clusters here are diverging species</span>
          </div>
          <ScatterPlot
            points={derived.scatter}
            xRange={[GENE_RANGES.maxSpeed.min, GENE_RANGES.maxSpeed.max]}
            yRange={[GENE_RANGES.size.min, GENE_RANGES.size.max]}
            height={128}
            xLabel="max speed"
            yLabel="size"
            reference={[GENE_RANGES.maxSpeed.default, GENE_RANGES.size.default]}
          />
        </div>
      </Card>
    </div>
  );
});
