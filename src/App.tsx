import { useCallback, useEffect, useRef, useState } from 'react';
import { ArenaCanvas } from './components/ArenaCanvas';
import { ChartsPanel } from './components/ChartsPanel';
import { ControlsBar, type LiveParams, type SpeedSetting } from './components/ControlsBar';
import { PRESETS } from './engine/config';
import { SimulationEngine } from './engine/SimulationEngine';
import type { DayStatus } from './engine/types';

/** Simulation ticks per second at 1×. */
const BASE_TPS = 60;
/** Per-frame CPU budget for the Max setting, leaving headroom for rendering. */
const MAX_FRAME_BUDGET_MS = 11;

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

function paramsFrom(engine: SimulationEngine): LiveParams {
  const { foodPerDay, mutationRate, initialPopulation } = engine.config;
  return { foodPerDay, mutationRate, initialPopulation };
}

export default function App() {
  const engineRef = useRef<SimulationEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SimulationEngine({ ...PRESETS[0].config, seed: randomSeed() });
  const engine = engineRef.current;

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedSetting>(1);
  const [params, setParams] = useState<LiveParams>(() => paramsFrom(engine));
  const [activePreset, setActivePreset] = useState<string | null>(PRESETS[0].id);
  const [revision, setRevision] = useState(engine.revision);
  const [status, setStatus] = useState<DayStatus>(() => engine.getStatus());

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  const syncUi = useCallback(() => {
    setRevision(engine.revision);
    setStatus(engine.getStatus());
  }, [engine]);

  // Fixed-timestep driver: simulation rate is decoupled from frame rate, so Max
  // runs as many deterministic ticks as fit in the frame budget.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastStatusAt = 0;
    let lastChartAt = 0;
    let lastRevision = engine.revision;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - last);
      last = now;
      const s = speedRef.current;

      if (playingRef.current) {
        if (s === 'max') {
          const deadline = now + MAX_FRAME_BUDGET_MS;
          do engine.runTicks(50);
          while (performance.now() < deadline && engine.phase !== 'extinct');
        } else {
          acc += (dt / 1000) * BASE_TPS * s;
          const n = Math.floor(acc);
          acc -= n;
          engine.runTicks(Math.min(n, s * 8));
        }
        if (engine.phase === 'extinct') setPlaying(false);
      } else {
        acc = 0;
      }

      const chartInterval = s === 'max' ? 120 : 0;
      if (engine.revision !== lastRevision && now - lastChartAt >= chartInterval) {
        lastRevision = engine.revision;
        lastChartAt = now;
        setRevision(engine.revision);
      }
      if (now - lastStatusAt > 100) {
        lastStatusAt = now;
        setStatus(engine.getStatus());
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const togglePlay = useCallback(() => {
    if (engine.phase === 'extinct') return;
    setPlaying((p) => !p);
  }, [engine]);

  const stepDay = useCallback(() => {
    setPlaying(false);
    engine.advanceDay();
    syncUi();
  }, [engine, syncUi]);

  const reset = useCallback(() => {
    engine.reset({ ...params, seed: randomSeed() });
    syncUi();
  }, [engine, params, syncUi]);

  const applyPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      engine.reset({ ...preset.config, seed: randomSeed() });
      setParams(paramsFrom(engine));
      setActivePreset(id);
      syncUi();
    },
    [engine, syncUi],
  );

  const setParam = useCallback(
    <K extends keyof LiveParams>(key: K, value: LiveParams[K]) => {
      setParams((p) => ({ ...p, [key]: value }));
      engine.setConfig({ [key]: value });
      setActivePreset(null);
    },
    [engine],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepDay();
      } else if (e.key === 'r' || e.key === 'R') {
        reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, stepDay, reset]);

  const pending = {
    foodPerDay: params.foodPerDay !== engine.config.foodPerDay,
    mutationRate: params.mutationRate !== engine.config.mutationRate,
    initialPopulation: params.initialPopulation !== engine.config.initialPopulation,
  };

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 lg:h-full">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink-200">
            Blob<span className="text-ink-400">World</span>
          </h1>
          <p className="text-[11.5px] text-ink-500">
            Forage, return home, replicate. Watch natural selection reshape the population one day at a time.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[10.5px] text-ink-500">
          <span className="flex items-center gap-3">
            <span>Color =</span>
            <span className="text-gene-speed">R speed</span>
            <span className="text-gene-size">G size</span>
            <span className="text-gene-sense">B sense</span>
          </span>
          <span className="font-mono">seed {engine.config.seed}</span>
        </div>
      </header>

      <ControlsBar
        playing={playing}
        speed={speed}
        params={params}
        pending={pending}
        presets={PRESETS}
        activePreset={activePreset}
        onTogglePlay={togglePlay}
        onStepDay={stepDay}
        onSpeed={setSpeed}
        onParam={setParam}
        onPreset={applyPreset}
        onReset={reset}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_460px]">
        <section className="flex min-h-[420px] flex-col rounded-xl border border-ink-700/60 bg-ink-900/40 p-3">
          <DayProgress status={status} />
          <div className="relative mt-3 min-h-0 flex-1">
            <ArenaCanvas engine={engine} />
            {status.phase === 'extinct' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="rounded-xl border border-ink-600/70 bg-ink-900/90 px-6 py-5 text-center shadow-2xl backdrop-blur">
                  <p className="text-[15px] font-semibold text-ink-200">Extinct after day {status.day}</p>
                  <p className="mt-1 text-[12px] text-ink-400">No blob made it home with food.</p>
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-4 rounded-full bg-ink-200 px-4 py-1.5 text-[12px] font-medium text-ink-950 hover:bg-white"
                  >
                    Start over
                  </button>
                </div>
              </div>
            )}
          </div>
          <footer className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[10.5px] text-ink-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-food" /> food
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-ink-400" /> home perimeter
            </span>
            <span>Eat 1 → survive · eat 2 → replicate · eat 0 → die</span>
            <span>Predation: ≥ 1.2× larger eats smaller</span>
            <span className="ml-auto">Hover or click a blob to inspect · Space play · → step · R reset</span>
          </footer>
        </section>

        <aside className="min-h-0 overflow-y-auto pr-0.5">
          <ChartsPanel history={engine.history} genes={engine.generationGenes} day={status.day} revision={revision} />
        </aside>
      </main>
    </div>
  );
}

function DayProgress({ status }: { status: DayStatus }) {
  const { total, home, dead, active, phase } = status;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const phaseLabel = phase === 'day' ? 'Foraging' : phase === 'dusk' ? 'Dusk · tallying survivors' : 'Extinct';
  return (
    <div className="px-1">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
        <span className="text-[13px] font-semibold text-ink-200">Day {status.day}</span>
        <span className="text-ink-500">{phaseLabel}</span>
        <span className="ml-auto flex gap-4 font-mono tabular-nums">
          <span className="text-ink-300">
            {active} <span className="text-ink-500">active</span>
          </span>
          <span className="text-emerald-300/90">
            {home} <span className="text-ink-500">safe</span>
          </span>
          <span className="text-rose-300/90">
            {dead} <span className="text-ink-500">dead</span>
          </span>
          <span className="text-food">
            {status.foodRemaining}/{status.foodTotal} <span className="text-ink-500">food</span>
          </span>
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-700/70">
        <div className="h-full bg-emerald-300/80 transition-[width] duration-150" style={{ width: `${pct(home)}%` }} />
        <div className="h-full bg-rose-300/60 transition-[width] duration-150" style={{ width: `${pct(dead)}%` }} />
      </div>
    </div>
  );
}
