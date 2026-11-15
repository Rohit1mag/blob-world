import { memo, useMemo } from 'react';
import {
  CULTURES,
  FLOORS,
  TRAIT_COLORS,
  TRAIT_MAX,
  TRAIT_MIN,
  TOP_FLOOR,
  describeSplit,
  dominantStyle,
  type CorporateEngine,
  type CorporateEvent,
  type CorporateStatus,
} from '../engine/CorporateEngine';
import { Card, LegendItem, Stat } from './ChartsPanel';
import { LineChart, ScatterPlot, type Series } from './charts';

const REVENUE = '#6fe39a';
const VISIBILITY = '#c99bff';
const POLITICAL = '#ffb347';
const BURNOUT = '#ff6b6b';
export const FLOOR_COLORS = ['#7d89a3', '#6aa8ff', '#5fe0e0', '#8be3b0', '#c99bff', '#f5c451'];
const EVENT_ICON: Record<CorporateEvent['kind'], string> = {
  promotion: '▲',
  ceo: '♛',
  pip: '✕',
  demotion: '▼',
  burnout: '♨',
  layoff: '📦',
  retirement: '⛳',
  pivot: '↻',
  culture: '❖',
};
const EVENT_TONE: Record<CorporateEvent['kind'], string> = {
  promotion: '#8be3b0',
  ceo: '#f5c451',
  pip: '#ff9b8a',
  demotion: '#ffb347',
  burnout: '#ff6b6b',
  layoff: '#a7b1c6',
  retirement: '#c8d0df',
  pivot: '#ff5fd2',
  culture: '#c99bff',
};
const BAR_TRAITS = ['execution', 'charisma', 'politics'] as const;

const qName = (q: number) => `Q${(q % 4) + 1} FY${Math.floor(q / 4) + 1}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

interface CorporateChartsPanelProps {
  engine: CorporateEngine;
  status: CorporateStatus;
  revision: number;
}

export const CorporateChartsPanel = memo(function CorporateChartsPanel({ engine, status, revision }: CorporateChartsPanelProps) {
  const { history, events, employees } = engine;
  const derived = useMemo(() => {
    const xs = history.map((h) => h.quarter);
    const dna: Series[] = [
      { id: 'exe', label: 'Execution', color: TRAIT_COLORS.execution, values: history.map((h) => h.topDna.execution), format: (v) => v.toFixed(2) },
      { id: 'pol', label: 'Politics', color: TRAIT_COLORS.politics, values: history.map((h) => h.topDna.politics), format: (v) => v.toFixed(2) },
      { id: 'cha', label: 'Charisma', color: TRAIT_COLORS.charisma, values: history.map((h) => h.topDna.charisma), format: (v) => v.toFixed(2) },
      {
        id: 'co-exe',
        label: 'Company exec.',
        color: TRAIT_COLORS.execution,
        values: history.map((h) => h.companyDna.execution),
        dashed: true,
        format: (v) => v.toFixed(2),
      },
    ];
    // Quarter 0 is the founding snapshot before anyone has worked.
    const worked = history.slice(1);
    const workedXs = worked.map((h) => h.quarter);
    const revenue: Series[] = [
      { id: 'rev', label: 'Revenue', color: REVENUE, values: worked.map((h) => Math.round(h.revenue)), area: true },
      { id: 'vis', label: 'Visibility', color: VISIBILITY, values: worked.map((h) => Math.round(h.visibility)), dashed: true },
      { id: 'pol', label: 'Political credit', color: POLITICAL, values: worked.map((h) => Math.round(h.politicalCredit)), dashed: true },
    ];
    const burnout: Series[] = [
      { id: 'burn', label: 'Avg burnout', color: BURNOUT, values: worked.map((h) => h.avgBurnout), area: true, format: pct },
      {
        id: 'turnover',
        label: 'Medical leave',
        color: '#ffb347',
        values: worked.map((h) => h.medicalLeaves / Math.max(1, h.headcount)),
        format: pct,
      },
    ];
    const scatter = employees.map((e) => ({ x: e.traits.execution, y: e.traits.politics, color: FLOOR_COLORS[e.floor] }));
    const cultureShifts: { quarter: number; name: string }[] = [];
    for (let i = 1; i < history.length; i++) {
      if (history[i].culture !== history[i - 1].culture) cultureShifts.push({ quarter: history[i].quarter, name: CULTURES[history[i].culture].name });
    }
    return { xs, dna, workedXs, revenue, burnout, scatter, floorDna: engine.floorDna(), cultureShifts };
  }, [revision, engine, history, employees]);

  const last = history[history.length - 1];
  const prevRevenue = history.length > 2 ? history[history.length - 2].revenue : null;
  const revDelta = last && prevRevenue ? (last.revenue - prevRevenue) / Math.max(1, prevRevenue) : null;
  const leaders = employees.filter((e) => e.floor >= FLOORS.length - 2).sort((a, b) => b.floor - a.floor);
  const recent = events.slice(-14).reverse();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2 rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 py-3">
        <Stat label="Quarter" value={`Q${status.quarterOfYear} · FY${status.fiscalYear}`} />
        <Stat label="Headcount" value={status.headcount} />
        <Stat
          label="Last revenue"
          value={
            <>
              {last && history.length > 1 ? Math.round(last.revenue) : '–'}
              {revDelta !== null && (
                <span className={`ml-1 text-[11px] ${revDelta >= 0 ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>
                  {revDelta >= 0 ? '+' : ''}
                  {Math.round(revDelta * 100)}%
                </span>
              )}
            </>
          }
          tone={REVENUE}
        />
        <Stat label="Burnout" value={pct(status.avgBurnout)} tone={status.avgBurnout > 0.5 ? BURNOUT : undefined} />
        <Stat label="Leadership" value={`${status.leadership.toFixed(2)}×`} tone={status.leadership >= 1 ? '#8be3b0' : '#ff9b8a'} />
      </div>

      <Card
        title="Traits by floor"
        subtitle={`Average execution, charisma & politics per floor · thin bar: what ${engine.culture.name} rewards for the next promotion`}
        legend={
          <>
            <LegendItem color={TRAIT_COLORS.execution} label="Exec" />
            <LegendItem color={TRAIT_COLORS.charisma} label="Charisma" />
            <LegendItem color={TRAIT_COLORS.politics} label="Politics" />
          </>
        }
      >
        <div className="flex flex-col gap-1.5 text-[11px]">
          {[...FLOORS].reverse().map((f) => {
            const d = derived.floorDna[f.index];
            const w = f.index < TOP_FLOOR ? engine.promotionWeights(f.index) : null;
            return (
              <div key={f.index} className="grid grid-cols-[22px_96px_1fr_40px] items-center gap-x-2">
                <span className="font-mono text-[10px] text-ink-500">F{f.index + 1}</span>
                <span className="truncate font-medium" style={{ color: FLOOR_COLORS[f.index] }} title={f.title}>
                  {f.title}
                </span>
                <div className="flex flex-col gap-[3px]">
                  <div
                    className="flex h-2.5 overflow-hidden rounded-sm bg-ink-800"
                    title={d.count ? BAR_TRAITS.map((t) => `${t} ${d[t].toFixed(2)}`).join(' · ') : 'empty'}
                  >
                    {d.count > 0 &&
                      (() => {
                        const total = BAR_TRAITS.reduce((s, t) => s + d[t], 0) || 1;
                        return BAR_TRAITS.map((t) => (
                          <div key={t} style={{ width: `${(d[t] / total) * 100}%`, background: TRAIT_COLORS[t] }} />
                        ));
                      })()}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-ink-800">
                      {w && w.map((v, i) => <div key={i} style={{ width: `${v * 100}%`, background: TRAIT_COLORS[BAR_TRAITS[i]], opacity: 0.55 }} />)}
                    </div>
                    <span className="w-[150px] shrink-0 truncate text-right font-mono text-[9.5px] text-ink-500">{w ? `\u25b2 ${describeSplit(w)}` : 'top of the ladder'}</span>
                  </div>
                </div>
                <span className="text-right font-mono text-ink-200 tabular-nums">
                  {status.occupancy[f.index]}
                  <span className="text-ink-500">/{f.capacity}</span>
                </span>
              </div>
            );
          })}
        </div>
        {leaders.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink-700/50 pt-2 text-[10px]">
            {leaders.map((e) => {
              const style = dominantStyle(e.traits);
              return (
                <span key={e.id} className="inline-flex items-center gap-1 rounded-full border border-ink-700/70 px-2 py-0.5 text-ink-300">
                  <span className={e.floor === FLOORS.length - 1 ? 'text-amber-300' : 'text-ink-400'}>{e.floor === FLOORS.length - 1 ? '♛' : '◆'}</span>
                  <span style={{ color: TRAIT_COLORS[style] }}>{e.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="C-Suite DNA over time"
        subtitle={`Mean traits of VPs & C-Suite after each review · dashed: whole company${
          derived.cultureShifts.length ? ` · culture shifts: ${derived.cultureShifts.slice(-3).map((c) => `${qName(c.quarter)} → ${c.name}`).join(', ')}` : ''
        }`}
        legend={
          <>
            <LegendItem color={TRAIT_COLORS.execution} label="Exec" value={last?.topDna.execution.toFixed(2)} />
            <LegendItem color={TRAIT_COLORS.politics} label="Politics" value={last?.topDna.politics.toFixed(2)} />
            <LegendItem color={TRAIT_COLORS.charisma} label="Charisma" value={last?.topDna.charisma.toFixed(2)} />
          </>
        }
      >
        <LineChart xs={derived.xs} series={derived.dna} height={140} yMin={0} yMax={1} yFormat={(v) => v.toFixed(1)} xLabel="quarter" xName={qName} />
      </Card>

      <Card
        title="Company revenue vs burnout"
        subtitle="KPI shipped per quarter, with the visibility & political credit generated alongside it"
        legend={
          <>
            <LegendItem color={REVENUE} label="Revenue" value={last && history.length > 1 ? String(Math.round(last.revenue)) : undefined} />
            <LegendItem color={VISIBILITY} label="Visibility" dashed value={last && history.length > 1 ? String(Math.round(last.visibility)) : undefined} />
            <LegendItem color={POLITICAL} label="Politics" dashed value={last && history.length > 1 ? String(Math.round(last.politicalCredit)) : undefined} />
          </>
        }
      >
        <LineChart xs={derived.workedXs} series={derived.revenue} height={116} yMin={0} xLabel="quarter" xName={qName} />
        <div className="mt-1 mb-0.5 flex items-baseline justify-between text-[10px]">
          <span className="font-medium" style={{ color: BURNOUT }}>
            Burnout rate
          </span>
          <span className="font-mono text-ink-400 tabular-nums">
            avg burnout · medical leave share{last && history.length > 1 ? ` · ${Math.round(last.stolen)} KPI credit stolen last Q` : ''}
          </span>
        </div>
        <LineChart xs={derived.workedXs} series={derived.burnout} height={84} yMin={0} yMax={0.5} yTickCount={2} yFormat={pct} xName={qName} />
      </Card>

      <Card
        title="Execution × Politics"
        subtitle="Every employee, coloured by floor"
        legend={FLOORS.map((f) => (
          <LegendItem key={f.index} color={FLOOR_COLORS[f.index]} label={`F${f.index + 1}`} />
        ))}
      >
        <ScatterPlot
          points={derived.scatter}
          xRange={[TRAIT_MIN, TRAIT_MAX]}
          yRange={[TRAIT_MIN, TRAIT_MAX]}
          height={130}
          xLabel="execution"
          yLabel="politics"
          reference={[0.55, 0.55]}
        />
      </Card>

      {events.length > 0 && (
        <Card title="Org chart chatter" subtitle="Promotions, demotions, pivots, burnouts and layoffs, newest first">
          <ul className="space-y-0.5 text-[11px]">
            {recent.map((e, i) => (
              <li key={`${e.quarter}-${i}`} className="flex items-baseline gap-2">
                <span className="w-14 shrink-0 font-mono text-[10px] text-ink-500 tabular-nums">{qName(e.quarter)}</span>
                <span className="w-3.5 shrink-0 text-center" style={{ color: EVENT_TONE[e.kind] }}>
                  {EVENT_ICON[e.kind]}
                </span>
                <span className="text-ink-300">{e.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
});
