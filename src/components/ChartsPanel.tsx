import { memo, useMemo, useState, type ReactNode } from 'react';
import { GENE_RANGES, type DayStatus, type GenerationStats, type Genes, type Realm, type Tribe, type WinterRecord, type WorldEvent } from '../engine/types';
import { RESOURCE_COLORS } from './blobColor';
import { GroupedBars, LineChart, ScatterPlot, StackedAreaChart, type Band, type Series } from './charts';

const SPEED = '#ff7a7a';
const SIZE = '#5fe39a';
const SENSE = '#6aa8ff';
const INTEL = '#c792ea';
const BUILT = '#e8edf6';
const ROLE_COLORS = { gatherer: '#5eead4', builder: '#f5c451', warrior: '#ff7a6b', idle: '#55617c' };
const WINTER_BAND = 'rgba(170,200,255,0.08)';
const SEASON_TONE = { summer: '#f5c451', fall: '#e08a4f', winter: '#b9d4ff' } as const;
const OTHERS = '#55617c';
const MAX_CHARTED_TRIBES = 6;
const WINTER_SERIES = { colors: ['#b9d4ff', '#6fe39a', '#ff7a6b'], names: ['World', 'Best tribe', 'Worst tribe'] };
const EVENT_ICON = {
  split: '⑂',
  wanderers: '➜',
  fell: '✕',
  realm: '♛',
  vassal: '⚑',
  rebel: '⚡',
  trade: '⚖',
  alliance: '🛡',
  war: '⚔',
  peace: '🕊',
  festival: '★',
  road: '═',
  invention: '✦',
  culture: '❖',
} as const;

interface ChartsPanelProps {
  history: GenerationStats[];
  genes: { tribeId: number; genes: Genes }[];
  tribes: Tribe[];
  realms: Realm[];
  winters: WinterRecord[];
  events: WorldEvent[];
  status: DayStatus;
  selectedTribeId?: number | null;
  onSelectTribe?: (id: number | null) => void;
  /** Changes whenever `history`/`genes` were mutated in place by the engine. */
  revision: number;
}

function Card({ title, subtitle, legend, children }: { title: ReactNode; subtitle?: string; legend?: ReactNode; children: ReactNode }) {
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

/** Contiguous winter stretches in the history, for shading chart backgrounds. */
function winterBands(history: GenerationStats[]): Band[] {
  const bands: Band[] = [];
  let start: number | null = null;
  for (let i = 0; i < history.length; i++) {
    const w = history[i].season === 'winter';
    if (w && start === null) start = history[i].day - 1;
    if (!w && start !== null) {
      bands.push({ from: start, to: history[i - 1].day, color: WINTER_BAND });
      start = null;
    }
  }
  if (start !== null) bands.push({ from: start, to: history[history.length - 1].day, color: WINTER_BAND });
  return bands;
}

export const ChartsPanel = memo(function ChartsPanel({
  history,
  genes,
  tribes,
  realms,
  winters,
  events,
  status,
  selectedTribeId = null,
  onSelectTribe,
  revision,
}: ChartsPanelProps) {
  const [popView, setPopView] = useState<'tribe' | 'realm'>('tribe');
  // `history` is appended in place, so derive everything from `revision`.
  const derived = useMemo(() => {
    const xs = history.map((h) => h.day);
    const bands = winterBands(history);
    // Chart the biggest tribes individually (living first, then fallen by peak); fold the rest together.
    const peak = tribes.map((t) => history.reduce((m, h) => Math.max(m, h.tribes[t.id]?.population ?? 0), 0));
    const current = (id: number) => history[history.length - 1]?.tribes[id]?.population ?? 0;
    const ranked = [...tribes].sort((a, b) => Number(a.extinct) - Number(b.extinct) || current(b.id) - current(a.id) || peak[b.id] - peak[a.id]);
    const charted = ranked.slice(0, MAX_CHARTED_TRIBES);
    const others = ranked.slice(MAX_CHARTED_TRIBES);
    const population: Series[] = charted.map((t) => ({
      id: `t${t.id}`,
      label: t.name,
      color: t.color,
      values: history.map((h) => h.tribes[t.id]?.population ?? 0),
    }));
    if (others.length > 0) {
      population.push({
        id: 'others',
        label: `${others.length} others`,
        color: OTHERS,
        values: history.map((h) => others.reduce((s, t) => s + (h.tribes[t.id]?.population ?? 0), 0)),
      });
    }
    const realmPopAt = (h: GenerationStats, realmId: number) =>
      h.tribes.reduce((s, td) => s + (td.realmId === realmId ? td.population : 0), 0);
    const realmPeak = realms.map((r) => history.reduce((m, h) => Math.max(m, realmPopAt(h, r.id)), 0));
    const lastHist = history[history.length - 1];
    const rankedRealms = [...realms].sort(
      (a, b) =>
        (lastHist ? realmPopAt(lastHist, b.id) : 0) - (lastHist ? realmPopAt(lastHist, a.id) : 0) || realmPeak[b.id] - realmPeak[a.id],
    );
    const chartedRealms = rankedRealms.slice(0, MAX_CHARTED_TRIBES);
    const otherRealms = rankedRealms.slice(MAX_CHARTED_TRIBES);
    const realmPopulation: Series[] = chartedRealms.map((r) => ({
      id: `r${r.id}`,
      label: r.tier === 'empire' ? `${r.name} Emp.` : r.tier === 'kingdom' ? `K. ${r.name}` : r.name,
      color: r.color,
      values: history.map((h) => realmPopAt(h, r.id)),
    }));
    if (otherRealms.length > 0) {
      realmPopulation.push({
        id: 'r-others',
        label: `${otherRealms.length} others`,
        color: OTHERS,
        values: history.map((h) => otherRealms.reduce((s, r) => s + realmPopAt(h, r.id), 0)),
      });
    }
    const stockpile: Series[] = [
      { id: 'food', label: 'Food', color: RESOURCE_COLORS.food, values: history.map((h) => Math.round(h.stockpile.food)) },
      { id: 'timber', label: 'Wood', color: RESOURCE_COLORS.timber, values: history.map((h) => h.stockpile.timber) },
      { id: 'stone', label: 'Stone', color: RESOURCE_COLORS.stone, values: history.map((h) => h.stockpile.stone) },
    ];
    const structures: Series[] = [
      { id: 'built', label: 'Structures', color: BUILT, values: history.map((h) => h.structures), area: true },
    ];
    // Day 0 is the founding census before anyone has worked.
    const worked = history.slice(1);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const roles: Series[] = (['gatherer', 'builder', 'warrior', 'idle'] as const).map((r) => ({
      id: r,
      label: r[0].toUpperCase() + r.slice(1) + 's',
      color: ROLE_COLORS[r],
      values: worked.map((h) => h.roles[r]),
      format: pct,
    }));
    const rel = (v: number) => `${v.toFixed(2)}×`;
    const traits: Series[] = [
      { id: 'speed', label: 'Max speed', color: SPEED, values: history.map((h) => h.avgSpeed / GENE_RANGES.maxSpeed.default), format: rel },
      { id: 'size', label: 'Size', color: SIZE, values: history.map((h) => h.avgSize / GENE_RANGES.size.default), format: rel },
      { id: 'sense', label: 'Sense', color: SENSE, values: history.map((h) => h.avgSense / GENE_RANGES.senseRadius.default), format: rel },
      { id: 'intel', label: 'Intel', color: INTEL, values: history.map((h) => h.avgIntelligence / GENE_RANGES.intelligence.default), format: rel },
    ];
    const winterGroups = winters.map((w) => {
      const rates = w.tribeSurvival.filter((r): r is number => r !== null);
      return {
        label: `Y${w.year}`,
        values: [
          w.startPopulation ? w.survived / w.startPopulation : null,
          rates.length ? Math.max(...rates) : null,
          rates.length ? Math.min(...rates) : null,
        ],
      };
    });
    const scatter = genes.map((g) => ({ x: g.genes.maxSpeed, y: g.genes.size, color: tribes[g.tribeId]?.color ?? '#fff' }));
    const backfilled = history.reduce((s, h) => s + h.backfilled, 0);
    return {
      xs,
      bands,
      population,
      realmPopulation,
      stockpile,
      structures,
      workedXs: worked.map((h) => h.day),
      roles,
      traits,
      winterGroups,
      scatter,
      backfilled,
    };
  }, [revision, history, genes, tribes, realms, winters]);

  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const delta = last && prev ? last.population - prev.population : 0;
  const died = last ? Object.values(last.deaths).reduce((a, b) => a + b, 0) : 0;
  const working = last ? last.roles.gatherer + last.roles.builder + last.roles.warrior + last.roles.idle : 0;
  const share = (n: number) => (working ? `${Math.round((n / working) * 100)}%` : '–');
  const lastWinter = winters[winters.length - 1];
  // Living tribes grouped by realm (capital first, then vassals), then fallen.
  const realmById = new Map(status.realms.map((r) => [r.id, r]));
  const roster = [...status.tribes].sort((a, b) => {
    if (a.extinct !== b.extinct) return Number(a.extinct) - Number(b.extinct);
    if (a.extinct) return b.fallenDay! - a.fallenDay!;
    const ra = realmById.get(a.realmId);
    const rb = realmById.get(b.realmId);
    if (ra && rb && ra.id !== rb.id) return rb.population - ra.population;
    if (ra && ra.capitalId === a.id && (!rb || rb.capitalId !== b.id)) return -1;
    if (rb && rb.capitalId === b.id && (!ra || ra.capitalId !== a.id)) return 1;
    return b.population - a.population;
  });
  const majorRealms = status.realms.filter((r) => r.tier !== 'chiefdom').length;
  const recentEvents = events.slice(-14).reverse();
  const popSeries = popView === 'realm' ? derived.realmPopulation : derived.population;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2 rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 py-3">
        <Stat label="Year · day" value={`${status.year} · ${status.dayOfYear + 1}`} />
        <Stat label="Season" value={status.season[0].toUpperCase() + status.season.slice(1)} tone={SEASON_TONE[status.season]} />
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
        <Stat
          label={majorRealms > 0 ? 'Tribes · realms' : 'Tribes'}
          value={
            majorRealms > 0 ? (
              <>
                {status.tribes.filter((t) => !t.extinct).length}
                <span className="ml-1 text-[11px] text-amber-300/80">· {majorRealms}</span>
              </>
            ) : (
              status.tribes.filter((t) => !t.extinct).length
            )
          }
        />
        <Stat
          label="Born / died"
          value={
            <>
              <span className="text-[#8be3b0]">{last?.born ?? 0}</span>
              <span className="text-ink-500"> / </span>
              <span className="text-[#f19aa6]">{died}</span>
            </>
          }
        />
      </div>

      <section className="max-h-[232px] overflow-y-auto rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 py-2.5">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
          <span />
          <span className="text-[9.5px] font-sans font-medium tracking-wider text-ink-500 uppercase">Tribe</span>
          <span className="text-right text-[9.5px] font-sans font-medium tracking-wider text-ink-500 uppercase">Pop</span>
          <span className="text-right text-[9.5px] font-sans font-medium tracking-wider uppercase" style={{ color: RESOURCE_COLORS.food }}>
            Food
          </span>
          <span className="text-right text-[9.5px] font-sans font-medium tracking-wider uppercase" style={{ color: RESOURCE_COLORS.timber }}>
            Wood
          </span>
          <span className="text-right text-[9.5px] font-sans font-medium tracking-wider uppercase" style={{ color: RESOURCE_COLORS.stone }}>
            Stone
          </span>
          {roster.map((t) => {
            const realm = realmById.get(t.realmId) ?? null;
            return (
              <TribeRow
                key={t.id}
                status={t}
                realm={realm}
                parent={t.parentId !== null ? status.tribes[t.parentId] : null}
                structures={last?.tribes[t.id]?.structures ?? 0}
                selected={selectedTribeId === t.id}
                onSelect={onSelectTribe ? () => onSelectTribe(selectedTribeId === t.id ? null : t.id) : undefined}
              />
            );
          })}
        </div>
        {status.diplomacy.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-ink-700/50 pt-2 text-[10px]">
            {status.diplomacy.map((d) => {
              const ra = realmById.get(d.realmA);
              const rb = realmById.get(d.realmB);
              if (!ra || !rb) return null;
              const cls =
                d.stance === 'alliance'
                  ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
                  : d.stance === 'trade'
                    ? 'border-amber-400/35 bg-amber-400/10 text-amber-200'
                    : 'border-rose-400/35 bg-rose-400/10 text-rose-200';
              const icon = d.stance === 'alliance' ? '🛡' : d.stance === 'trade' ? '⚖' : '⚔';
              return (
                <span key={`${d.realmA}-${d.realmB}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${cls}`}>
                  <span>{icon}</span>
                  <span style={{ color: ra.color }}>{ra.name}</span>
                  <span className="text-ink-500">·</span>
                  <span style={{ color: rb.color }}>{rb.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </section>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <span>Population by {popView}</span>
            <span className="inline-flex rounded-full border border-ink-700/70 bg-ink-950/60 p-0.5 text-[9.5px] font-normal">
              {(['tribe', 'realm'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPopView(m)}
                  className={`rounded-full px-1.5 py-0.25 capitalize transition ${
                    popView === m ? 'bg-ink-700 text-ink-200' : 'text-ink-500 hover:text-ink-300'
                  }`}
                >
                  {m}
                </button>
              ))}
            </span>
          </span>
        }
        subtitle={`Stacked census each night · winters shaded${derived.backfilled ? ` · ${derived.backfilled} founders reseeded` : ''}`}
        legend={popSeries.map((s) => (
          <LegendItem key={s.id} color={s.color} label={s.label} value={String(s.values[s.values.length - 1] ?? 0)} />
        ))}
      >
        <StackedAreaChart xs={derived.xs} series={popSeries} height={128} xLabel="day" bands={derived.bands} />
      </Card>

      <Card
        title="Stockpiles & construction"
        subtitle="All tribes combined, after rations and spoilage"
        legend={
          <>
            <LegendItem color={RESOURCE_COLORS.food} label="Food" value={last ? String(Math.round(last.stockpile.food)) : undefined} />
            <LegendItem color={RESOURCE_COLORS.timber} label="Wood" value={last ? String(Math.floor(last.stockpile.timber)) : undefined} />
            <LegendItem color={RESOURCE_COLORS.stone} label="Stone" value={last ? String(Math.floor(last.stockpile.stone)) : undefined} />
          </>
        }
      >
        <LineChart xs={derived.xs} series={derived.stockpile} height={112} yMin={0} xLabel="day" bands={derived.bands} />
        <div className="mt-1 mb-0.5 flex items-baseline justify-between text-[10px]">
          <span className="font-medium text-ink-300">Structures standing</span>
          <span className="font-mono text-ink-400 tabular-nums">farms · factories · labs · hospitals · skyscrapers</span>
        </div>
        <LineChart
          xs={derived.xs}
          series={derived.structures}
          height={72}
          yMin={0}
          yMax={4}
          yTickCount={2}
          yFormat={(v) => String(Math.round(v))}
          bands={derived.bands}
        />
      </Card>

      <Card
        title="Division of labor"
        subtitle="What each blob actually did today"
        legend={
          <>
            <LegendItem color={ROLE_COLORS.gatherer} label="Gather" value={last ? share(last.roles.gatherer) : undefined} />
            <LegendItem color={ROLE_COLORS.builder} label="Build" value={last ? share(last.roles.builder) : undefined} />
            <LegendItem color={ROLE_COLORS.warrior} label="War" value={last ? share(last.roles.warrior) : undefined} />
            <LegendItem color={ROLE_COLORS.idle} label="Idle" />
          </>
        }
      >
        <StackedAreaChart
          xs={derived.workedXs}
          series={derived.roles}
          height={112}
          normalize
          yFormat={(v) => `${Math.round(v * 100)}%`}
          xLabel="day"
          bands={derived.bands}
        />
      </Card>

      <Card
        title="Winter survival"
        subtitle={
          lastWinter
            ? `Share alive at winter's start that saw spring · last: ${lastWinter.survived} of ${lastWinter.startPopulation} survived`
            : 'Share alive at winter’s start that sees spring'
        }
      >
        <GroupedBars
          groups={derived.winterGroups}
          colors={WINTER_SERIES.colors}
          names={WINTER_SERIES.names}
          height={96}
          emptyLabel="No winters survived yet"
        />
      </Card>

      {events.length > 0 && (
        <Card title="Chronicle" subtitle="Splits, arrivals and falls, newest first">
          <ul className="space-y-0.5 text-[11px]">
            {recentEvents.map((e, i) => {
              const t = status.tribes[e.tribeId];
              return (
                <li key={`${e.day}-${i}`} className="flex items-baseline gap-2">
                  <span className="w-12 shrink-0 font-mono text-[10px] text-ink-500 tabular-nums">d{e.day}</span>
                  <span className="w-3 shrink-0 text-center" style={{ color: t?.color }}>
                    {EVENT_ICON[e.kind]}
                  </span>
                  <span className={e.kind === 'fell' ? 'text-ink-500' : 'text-ink-300'}>{e.text}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card
        title="Trait evolution"
        subtitle="Population mean, relative to the founding default (1.0×)"
        legend={
          <>
            <LegendItem color={SPEED} label="Max speed" value={last ? last.avgSpeed.toFixed(2) : undefined} />
            <LegendItem color={SIZE} label="Size" value={last ? last.avgSize.toFixed(2) : undefined} />
            <LegendItem color={SENSE} label="Sense" value={last ? last.avgSense.toFixed(0) : undefined} />
            <LegendItem color={INTEL} label="Intel" value={last ? last.avgIntelligence.toFixed(2) : undefined} />
          </>
        }
      >
        <LineChart xs={derived.xs} series={derived.traits} height={112} baseline={1} yFormat={(v) => `${v.toFixed(1)}×`} xLabel="day" />
        <div className="mt-3 mb-1 flex items-baseline justify-between text-[10px]">
          <span className="font-medium text-ink-300">Max speed × Size</span>
          <span className="text-ink-500">coloured by tribe · n = {genes.length}</span>
        </div>
        <ScatterPlot
          points={derived.scatter}
          xRange={[GENE_RANGES.maxSpeed.min, GENE_RANGES.maxSpeed.max]}
          yRange={[GENE_RANGES.size.min, GENE_RANGES.size.max]}
          height={120}
          xLabel="max speed"
          yLabel="size"
          reference={[GENE_RANGES.maxSpeed.default, GENE_RANGES.size.default]}
        />
      </Card>
    </div>
  );
});

function TribeRow({
  status: t,
  realm,
  parent,
  structures,
  selected,
  onSelect,
}: {
  status: DayStatus['tribes'][number];
  realm: DayStatus['realms'][number] | null;
  parent: DayStatus['tribes'][number] | null;
  structures: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const dim = t.extinct ? 'opacity-40' : '';
  const isCapital = !t.extinct && realm && realm.capitalId === t.id && realm.tier !== 'chiefdom';
  const isVassal = !t.extinct && realm && realm.capitalId !== t.id;
  const origin = isVassal ? (
    <>
      vassal of <span style={{ color: realm.color }}>{realm.name}</span> ({Math.round(t.loyalty * 100)}%) ·{' '}
    </>
  ) : parent ? (
    <>
      from <span style={{ color: parent.color }}>{parent.name}</span> ·{' '}
    </>
  ) : t.origin === 'wanderers' ? (
    'wanderers · '
  ) : null;
  return (
    <>
      <span className={`h-2.5 w-2.5 rounded-full ${dim}`} style={{ background: t.color }} />
      <button
        type="button"
        onClick={onSelect}
        className={`flex items-baseline gap-2 text-left font-sans ${dim} ${onSelect ? 'cursor-pointer hover:underline' : ''} ${
          selected ? 'underline decoration-ink-300' : ''
        }`}
      >
        <span className="font-semibold" style={{ color: t.color }}>
          {isCapital && <span className="mr-1 text-amber-300" title={`${realm.tier === 'empire' ? `${realm.name} Empire` : `Kingdom of ${realm.name}`}`}>♛</span>}
          {t.name}
        </span>
        <span className="truncate text-[10px] text-ink-500">
          {!t.extinct && t.tier !== 'camp' ? `${t.tier} · ` : ''}
          {origin}
          {t.extinct ? `fell d${t.fallenDay}` : `${structures} built`}
        </span>
      </button>
      <span className={`text-right text-ink-200 ${dim}`}>
        {t.population}
        <span className="text-ink-500">/{t.housing}</span>
      </span>
      <span className={`text-right text-ink-300 ${dim}`}>{Math.floor(t.stockpile.food)}</span>
      <span className={`text-right text-ink-300 ${dim}`}>{Math.floor(t.stockpile.timber)}</span>
      <span className={`text-right text-ink-300 ${dim}`}>{Math.floor(t.stockpile.stone)}</span>
    </>
  );
}
