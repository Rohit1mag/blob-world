import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArenaCanvas } from './components/ArenaCanvas';
import { RESOURCE_COLORS } from './components/blobColor';
import { CampInspector } from './components/CampInspector';
import { ChartsPanel } from './components/ChartsPanel';
import { ControlsBar, CorporateControlsBar, type CorporateParams, type LiveParams, type SpeedSetting } from './components/ControlsBar';
import { CorporateArena } from './components/CorporateArena';
import { CorporateChartsPanel } from './components/CorporateChartsPanel';
import { useAnimationFrame } from './components/useAnimationFrame';
import { PRESETS } from './engine/config';
import {
  CULTURE_PRESETS,
  CorporateEngine,
  TRAIT_COLORS,
  type CultureId,
  type CorporateStatus,
  type SavedCorporate,
} from './engine/CorporateEngine';
import { SimulationEngine, type SavedSimulation } from './engine/SimulationEngine';
import type { DayStatus, GameMode, WorldEvent } from './engine/types';
import { supabaseConfigured } from './lib/supabase';
import {
  createWorld,
  ensurePlayer,
  listWorlds,
  loadWorld,
  queueWorldSave,
  saveWorld,
  setCloudErrorReporter,
  type WorldMeta,
} from './lib/worlds';

const SAVE_KEY = 'blobworld:save:v1';
const ACTIVE_WORLD_KEY = 'blobworld:active-world';
const CORPORATE_SAVE_KEY = 'blobworld:corporate:v1';
const SIM_MODE_KEY = 'blobworld:sim-mode';

type SimMode = 'ecosystem' | 'civilization' | 'corporate';
const SIM_MODES: { id: SimMode; label: string }[] = [
  { id: 'ecosystem', label: 'Ecosystem' },
  { id: 'civilization', label: 'Civilization' },
  { id: 'corporate', label: 'Corporate Ladder' },
];
/** The tribe engine's game mode behind each non-corporate tab. */
const TRIBE_MODE: Record<Exclude<SimMode, 'corporate'>, GameMode> = { ecosystem: 'lastStanding', civilization: 'endless' };

/** Simulation ticks per second at 1×. */
const BASE_TPS = 60;
/** Hard ceiling on simulation work per rendered frame, at any speed. */
const MAX_TICKS_PER_FRAME = 50;
/** Per-frame CPU budget for the Max setting, leaving headroom for rendering. */
const MAX_FRAME_BUDGET_MS = 11;
/** Per-frame CPU budget while fast-forwarding a year; the UI stays responsive at a lower frame rate. */
const SKIP_FRAME_BUDGET_MS = 40;
/** Params that only take effect when the world is regenerated. */
const RESET_ONLY: (keyof LiveParams)[] = ['blobsPerTribe', 'tribeCount', 'mode'];

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

const World3D = lazy(() => import('./components/World3D'));
type ViewMode = '2d' | '3d';

function paramsFrom(engine: SimulationEngine): LiveParams {
  const { foodPerDay, mutationRate, blobsPerTribe, tribeCount, mode } = engine.config;
  return { foodPerDay, mutationRate, blobsPerTribe, tribeCount, mode };
}

function corporateParamsFrom(corp: CorporateEngine): CorporateParams {
  const { culture, politicsSteepness, layoffPct, espressoPerk } = corp.config;
  return { culture, politicsSteepness, layoffPct, espressoPerk };
}

/** A skip-ahead in progress, expressed over whichever engine is active. */
interface SkipRun {
  done: () => boolean;
  progress: () => number;
}

export default function App() {
  const engineRef = useRef<SimulationEngine | null>(null);
  const restoredDayRef = useRef<number | null>(null);
  if (!engineRef.current) {
    const eng = new SimulationEngine({ ...PRESETS[0].config, seed: randomSeed() });
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedSimulation;
        if (parsed?.version === 1 && parsed.config?.arenaSize) {
          eng.loadJSON(parsed);
          restoredDayRef.current = eng.day;
        }
      }
    } catch {
      // Ignore corrupt saved state.
    }
    engineRef.current = eng;
  }
  const engine = engineRef.current;

  const corpRef = useRef<CorporateEngine | null>(null);
  if (!corpRef.current) {
    const corp = new CorporateEngine({ seed: randomSeed() });
    try {
      const raw = localStorage.getItem(CORPORATE_SAVE_KEY);
      if (raw) corp.loadJSON(JSON.parse(raw) as SavedCorporate);
    } catch {
      // Ignore corrupt saved state.
    }
    corpRef.current = corp;
  }
  const corp = corpRef.current;
  const [corporate, setCorporate] = useState(() => localStorage.getItem(SIM_MODE_KEY) === 'corporate');
  const simMode: SimMode = corporate ? 'corporate' : engine.config.mode === 'lastStanding' ? 'ecosystem' : 'civilization';
  const [corpParams, setCorpParams] = useState<CorporateParams>(() => corporateParamsFrom(corp));
  const [corpStatus, setCorpStatus] = useState<CorporateStatus>(() => corp.getStatus());
  const [corpPinnedId, setCorpPinnedId] = useState<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedSetting>(1);
  const [params, setParams] = useState<LiveParams>(() => paramsFrom(engine));
  const [activePreset, setActivePreset] = useState<string | null>(PRESETS[0].id);
  const [revision, setRevision] = useState(engine.revision);
  const [status, setStatus] = useState<DayStatus>(() => engine.getStatus());
  const [savedLabel, setSavedLabel] = useState<string | null>(() =>
    restoredDayRef.current !== null ? `d${restoredDayRef.current}` : null,
  );
  const [worlds, setWorlds] = useState<WorldMeta[]>([]);
  const [activeWorldId, setActiveWorldId] = useState<string | null>(null);
  const [booting, setBooting] = useState(supabaseConfigured);
  const [cloudNote, setCloudNote] = useState<string | null>(null);
  const worldIdRef = useRef<string | null>(null);

  const rememberWorld = useCallback((id: string, list: WorldMeta[]) => {
    worldIdRef.current = id;
    localStorage.setItem(ACTIVE_WORLD_KEY, id);
    setActiveWorldId(id);
    setWorlds(list);
  }, []);

  const saveProgress = useCallback(() => {
    const snapshot = engine.toJSON();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      setSavedLabel(`d${engine.day}`);
    } catch {
      // Ignore quota errors. The cloud copy is the durable save.
    }
    if (worldIdRef.current) queueWorldSave(worldIdRef.current, snapshot);
  }, [engine]);

  const saveCorporate = useCallback(() => {
    try {
      localStorage.setItem(CORPORATE_SAVE_KEY, JSON.stringify(corp.toJSON()));
    } catch {
      // Ignore quota errors; the company simply restarts next visit.
    }
  }, [corp]);

  useEffect(() => {
    setCloudErrorReporter((message) => setCloudNote(message));
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let cancelled = false;
    const boot = async () => {
      try {
        await ensurePlayer();
        let list = await listWorlds();
        const storedId = localStorage.getItem(ACTIVE_WORLD_KEY);
        const chosen = list.find((world) => world.id === storedId) ?? list[0] ?? null;
        if (!chosen) {
          const created = await createWorld(engine.toJSON());
          list = await listWorlds();
          if (cancelled) return;
          rememberWorld(created.id, list);
          return;
        }
        const remote = await loadWorld(chosen.id);
        const localDay = restoredDayRef.current;
        if (localDay === null || remote.day >= localDay) {
          engine.loadJSON(remote);
          setParams(paramsFrom(engine));
          setRevision(engine.revision);
          setStatus(engine.getStatus());
          setSavedLabel(`d${engine.day}`);
          try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(remote));
          } catch {
            // The cloud copy is already loaded.
          }
        } else {
          await saveWorld(chosen.id, engine.toJSON());
        }
        if (cancelled) return;
        rememberWorld(chosen.id, await listWorlds());
      } catch (err) {
        if (!cancelled) setCloudNote(err instanceof Error ? err.message : 'Cloud unavailable');
      } finally {
        if (!cancelled) setBooting(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [engine, rememberWorld]);

  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const corporateRef = useRef(corporate);
  playingRef.current = playing;
  speedRef.current = speed;
  corporateRef.current = corporate;

  const syncUi = useCallback(() => {
    if (corporateRef.current) {
      setRevision(corp.revision);
      setCorpStatus(corp.getStatus());
    } else {
      setRevision(engine.revision);
      setStatus(engine.getStatus());
    }
  }, [engine, corp]);
  const saveActive = useCallback(() => (corporateRef.current ? saveCorporate() : saveProgress()), [saveCorporate, saveProgress]);

  const skipRef = useRef<SkipRun | null>(null);
  const [skipProgress, setSkipProgress] = useState<number | null>(null);
  const stopSkip = useCallback(() => {
    skipRef.current = null;
    setSkipProgress(null);
  }, []);

  // Fixed-timestep driver: simulation rate is decoupled from frame rate, and the
  // loop is suspended entirely while the tab is hidden. It steps whichever engine is on screen.
  const loop = useRef({ acc: 0, lastStatusAt: 0, lastChartAt: 0, lastRevision: -1 });
  useAnimationFrame((now, rawDt) => {
    const l = loop.current;
    const dt = Math.min(100, rawDt);
    const s = speedRef.current;
    const skip = skipRef.current;
    const isCorp = corporateRef.current;
    const sim = isCorp ? corp : engine;

    if (skip) {
      const deadline = performance.now() + SKIP_FRAME_BUDGET_MS;
      while (!skip.done() && performance.now() < deadline) sim.runTicks(25);
      if (skip.done()) {
        stopSkip();
        if (sim.finished) setPlaying(false);
        syncUi();
        saveActive();
      } else {
        setSkipProgress(skip.progress());
      }
      l.acc = 0;
    } else if (playingRef.current) {
      if (s === 'max') {
        const deadline = now + MAX_FRAME_BUDGET_MS;
        for (let done = 0; done < MAX_TICKS_PER_FRAME && !sim.finished; done += 10) {
          sim.runTicks(10);
          if (performance.now() > deadline) break;
        }
      } else {
        l.acc += (dt / 1000) * BASE_TPS * s;
        const n = Math.floor(l.acc);
        l.acc -= n;
        sim.runTicks(Math.min(n, MAX_TICKS_PER_FRAME));
      }
      if (sim.finished) setPlaying(false);
    } else {
      l.acc = 0;
    }

    const chartInterval = skip ? 300 : s === 'max' ? 120 : 0;
    if (sim.revision !== l.lastRevision && now - l.lastChartAt >= chartInterval) {
      l.lastRevision = sim.revision;
      l.lastChartAt = now;
      setRevision(sim.revision);
      if (isCorp) {
        if (!skip) saveCorporate();
      } else if (!skip && engine.day % 5 === 0 && engine.phase === 'day' && engine.tick === 0) {
        saveProgress();
      }
    }
    if (now - l.lastStatusAt > 100) {
      l.lastStatusAt = now;
      if (isCorp) setCorpStatus(corp.getStatus());
      else setStatus(engine.getStatus());
    }
  });

  const [pinnedId, setPinnedId] = useState<number | null>(null);
  const [selectedTribeId, setSelectedTribeId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [directorMode, setDirectorMode] = useState(false);
  const [focusTarget, setFocusTarget] = useState<{ x: number; y: number; seq: number } | null>(null);
  const focusCamp = useCallback(
    (tribeId: number) => {
      const t = engine.tribes[tribeId];
      if (!t) return;
      setDirectorMode(false);
      setFocusTarget((prev) => ({ x: t.basePosition.x, y: t.basePosition.y, seq: (prev?.seq ?? 0) + 1 }));
    },
    [engine],
  );
  const selectFittest = useCallback(() => {
    if (corporateRef.current) setCorpPinnedId(corp.topPerformer()?.id ?? null);
    else setPinnedId(engine.fittestBlob()?.id ?? null);
  }, [engine, corp]);

  const togglePlay = useCallback(() => {
    if (!corporateRef.current && engine.finished) return;
    setPlaying((p) => !p);
  }, [engine]);

  const stepDay = useCallback(() => {
    stopSkip();
    setPlaying(false);
    if (corporateRef.current) corp.advanceQuarter();
    else engine.advanceDay();
    syncUi();
    saveActive();
  }, [engine, corp, syncUi, saveActive, stopSkip]);

  const skipYear = useCallback(() => {
    if (skipRef.current) {
      stopSkip();
      syncUi();
      saveActive();
      return;
    }
    if (corporateRef.current) {
      const start = corp.quarter;
      const target = corp.nextFiscalYearQuarter;
      skipRef.current = {
        done: () => corp.quarter >= target,
        progress: () => (corp.quarter - start + corp.quarterTick / corp.config.quarterTicks) / Math.max(1, target - start),
      };
    } else {
      if (engine.finished) return;
      const start = engine.day;
      const target = engine.nextYearStartDay;
      skipRef.current = {
        done: () => engine.day >= target || engine.finished,
        progress: () => (engine.day - start + engine.tick / engine.config.dayTicks) / Math.max(1, target - start),
      };
    }
    setSkipProgress(0);
  }, [engine, corp, syncUi, saveActive, stopSkip]);

  const reset = useCallback(() => {
    stopSkip();
    if (corporateRef.current) {
      corp.reset({ seed: randomSeed() });
      setCorpPinnedId(null);
      syncUi();
      saveCorporate();
      return;
    }
    engine.reset({ ...params, seed: randomSeed() });
    setPinnedId(null);
    setSelectedTribeId(null);
    syncUi();
    saveProgress();
  }, [engine, corp, params, syncUi, saveProgress, saveCorporate, stopSkip]);

  const newWorld = useCallback(async (overrides: Partial<LiveParams> = {}) => {
    stopSkip();
    setPlaying(false);
    const previousId = worldIdRef.current;
    const previous = engine.toJSON();
    if (previousId) await saveWorld(previousId, previous);
    engine.reset({ ...params, ...overrides, seed: randomSeed() });
    setParams(paramsFrom(engine));
    try {
      const created = await createWorld(engine.toJSON());
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(engine.toJSON()));
      } catch {
        // Cloud already has this world.
      }
      setPinnedId(null);
      setSelectedTribeId(null);
      syncUi();
      rememberWorld(created.id, await listWorlds());
      setSavedLabel(`d${engine.day}`);
      setCloudNote(null);
    } catch (err) {
      engine.loadJSON(previous);
      setParams(paramsFrom(engine));
      syncUi();
      throw err;
    }
  }, [engine, params, rememberWorld, syncUi, stopSkip]);

  const switchSimMode = useCallback(
    (next: SimMode) => {
      if (next === simMode) return;
      stopSkip();
      if (next === 'corporate') {
        corporateRef.current = true;
        setCorporate(true);
        localStorage.setItem(SIM_MODE_KEY, 'corporate');
        syncUi();
        return;
      }
      const mode = TRIBE_MODE[next];
      if (engine.config.mode !== mode) {
        // Ecosystem and Civilization are different rule sets, so the switch starts a fresh world.
        if (supabaseConfigured) {
          void newWorld({ mode }).catch((err) => setCloudNote(err instanceof Error ? err.message : 'Could not start a world'));
        } else {
          if (engine.day > 1 && !window.confirm(`Switch to ${next === 'ecosystem' ? 'Ecosystem' : 'Civilization'}? This starts a new tribe world and replaces the current save.`)) return;
          engine.reset({ ...params, mode, seed: randomSeed() });
          setParams(paramsFrom(engine));
          setPinnedId(null);
          setSelectedTribeId(null);
          saveProgress();
        }
      }
      corporateRef.current = false;
      setCorporate(false);
      localStorage.setItem(SIM_MODE_KEY, next);
      syncUi();
    },
    [simMode, engine, params, newWorld, saveProgress, syncUi, stopSkip],
  );

  const applyCulture = useCallback(
    (id: CultureId) => {
      corp.setConfig({ culture: id });
      setCorpParams(corporateParamsFrom(corp));
      setRevision(corp.revision);
      setCorpStatus(corp.getStatus());
    },
    [corp],
  );

  const setCorpParam = useCallback(
    <K extends keyof CorporateParams>(key: K, value: CorporateParams[K]) => {
      corp.setConfig({ [key]: value });
      setCorpParams(corporateParamsFrom(corp));
      setRevision(corp.revision);
    },
    [corp],
  );

  const switchWorld = useCallback(
    async (id: string) => {
      if (id === worldIdRef.current) return;
      stopSkip();
      setPlaying(false);
      if (worldIdRef.current) await saveWorld(worldIdRef.current, engine.toJSON());
      const saved = await loadWorld(id);
      engine.loadJSON(saved);
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
      } catch {
        // The selected world is loaded from the cloud.
      }
      setParams(paramsFrom(engine));
      setActivePreset(null);
      setPinnedId(null);
      setSelectedTribeId(null);
      syncUi();
      rememberWorld(id, await listWorlds());
      setSavedLabel(`d${engine.day}`);
      setCloudNote(null);
    },
    [engine, rememberWorld, syncUi, stopSkip],
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = PRESETS.find((p) => p.id === id);
      if (!preset) return;
      stopSkip();
      engine.reset({ ...preset.config, tribeCount: params.tribeCount, mode: params.mode, seed: randomSeed() });
      setParams(paramsFrom(engine));
      setActivePreset(id);
      setPinnedId(null);
      syncUi();
      saveProgress();
    },
    [engine, params.tribeCount, params.mode, syncUi, saveProgress, stopSkip],
  );

  const setParam = useCallback(
    <K extends keyof LiveParams>(key: K, value: LiveParams[K]) => {
      setParams((p) => ({ ...p, [key]: value }));
      if (!RESET_ONLY.includes(key)) engine.setConfig({ [key]: value });
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
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        skipYear();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        stepDay();
      } else if (e.key === 'y' || e.key === 'Y') {
        skipYear();
      } else if (e.key === 'Escape' && skipRef.current) {
        skipYear();
      } else if (e.key === 'r' || e.key === 'R') {
        reset();
      } else if (e.key === 'f' || e.key === 'F') {
        selectFittest();
      } else if (corporateRef.current) {
        return;
      } else if (e.key === 'v' || e.key === 'V') {
        setViewMode((m) => (m === '2d' ? '3d' : '2d'));
      } else if (e.key === 'd' || e.key === 'D') {
        setDirectorMode((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, stepDay, skipYear, reset, selectFittest]);

  const pending = {
    foodPerDay: params.foodPerDay !== engine.config.foodPerDay,
    mutationRate: params.mutationRate !== engine.config.mutationRate,
    blobsPerTribe: params.blobsPerTribe !== engine.config.blobsPerTribe,
    tribeCount: params.tribeCount !== engine.config.tribeCount,
    mode: params.mode !== engine.config.mode,
  };
  const living = status.tribes.filter((t) => !t.extinct);

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 lg:h-full">
      {booting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 text-[13px] text-ink-200">
          Loading your worlds…
        </div>
      )}
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink-200">
            Blob<span className="text-ink-400">World</span>
            <span className="ml-2 text-[12px] font-medium text-ink-500">{corporate ? 'BlobCorp' : 'Tribes'}</span>
          </h1>
          <p className="text-[11.5px] text-ink-500">
            {corporate
              ? 'Employees ship, network and scheme up a six-floor tower. Every floor rewards a different mix of output, visibility and politics; the best climb, the worst are cut, and most new hires are cloned from leadership.'
              : engine.config.mode === 'endless'
                ? 'Tribes gather, build and raid through the seasons. Crowded camps split, ruins are resettled, and brains keep evolving.'
                : 'Rival tribes gather, build and raid through summer, fall and winter. Each brain evolves to help its tribe outlast the rest.'}
          </p>
        </div>
        <nav className="flex rounded-full border border-ink-700/80 bg-ink-900/70 p-0.5" aria-label="Simulation mode">
          {SIM_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => switchSimMode(m.id)}
              aria-pressed={simMode === m.id}
              className={`rounded-full px-3.5 py-1 text-[12px] font-medium transition ${
                simMode === m.id ? 'bg-ink-200 text-ink-950' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-4 text-[10.5px] text-ink-500">
          {corporate ? (
            <span className="flex items-center gap-3">
              <span style={{ color: TRAIT_COLORS.execution }}>● Execution</span>
              <span style={{ color: TRAIT_COLORS.charisma }}>● Charisma</span>
              <span style={{ color: TRAIT_COLORS.politics }}>● Politics</span>
            </span>
          ) : (
            <span className="flex max-w-[520px] flex-wrap items-center justify-end gap-x-3 gap-y-1">
              {(engine.config.mode === 'endless' ? living : status.tribes).map((t) => (
                <span key={t.id} className={`flex items-center gap-1.5 ${t.extinct ? 'opacity-40 line-through' : ''}`}>
                  <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                  <span style={{ color: t.color }}>{t.name}</span>
                </span>
              ))}
            </span>
          )}
          <span className="font-mono">seed {corporate ? corp.config.seed : engine.config.seed}</span>
        </div>
      </header>

      {corporate ? (
        <>
          <CorporateControlsBar
            playing={playing}
            speed={speed}
            params={corpParams}
            presets={CULTURE_PRESETS}
            skipProgress={skipProgress}
            nextFiscalYear={corpStatus.fiscalYear + 1}
            onTogglePlay={togglePlay}
            onStepQuarter={stepDay}
            onSkipYear={skipYear}
            onSpeed={setSpeed}
            onParam={setCorpParam}
            onPreset={applyCulture}
            onReset={reset}
            onSelectTop={selectFittest}
          />
          <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_460px]">
            <section className="flex min-h-[420px] flex-col rounded-xl border border-ink-700/60 bg-ink-900/40 p-3">
              <QuarterProgress status={corpStatus} />
              <div className="relative mt-3 min-h-0 flex-1">
                <CorporateArena engine={corp} pinnedId={corpPinnedId} onPinnedChange={setCorpPinnedId} />
              </div>
              <footer className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[10.5px] text-ink-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#4fe3f0]/60" /> workstations: energy → KPI + burnout
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#ffb347]/60" /> breakroom: energy back, burnout down
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-[#ff5fd2]/60" /> watercooler: visibility, alliances, credit-stealing
                </span>
                <span>lanyard junior · headphones senior · tie manager · blazer director · pin VP · crown C-Suite · ★ greenfield launch</span>
                <span className="ml-auto">Scroll to zoom · drag to pan · Space play · → next review · Y next FY · R reset · F top performer</span>
              </footer>
            </section>
            <aside className="min-h-0 overflow-y-auto pr-0.5">
              <CorporateChartsPanel engine={corp} status={corpStatus} revision={revision} />
            </aside>
          </main>
        </>
      ) : (
          <>
          <ControlsBar
            playing={playing}
            speed={speed}
            params={params}
            pending={pending}
            presets={PRESETS}
            activePreset={activePreset}
            onTogglePlay={togglePlay}
            onStepDay={stepDay}
            onSkipYear={skipYear}
            skipProgress={skipProgress}
            nextYear={status.year + 1}
            onSpeed={setSpeed}
            onParam={setParam}
            onPreset={applyPreset}
            onReset={reset}
            onSave={saveProgress}
            savedLabel={cloudNote ?? savedLabel}
            worlds={worlds}
            activeWorldId={activeWorldId}
            onNewWorld={supabaseConfigured ? () => void newWorld().catch((err) => setCloudNote(err instanceof Error ? err.message : 'Could not start a world')) : undefined}
            onSwitchWorld={supabaseConfigured ? (id) => void switchWorld(id).catch((err) => setCloudNote(err instanceof Error ? err.message : 'Could not open that world')) : undefined}
            onSelectFittest={selectFittest}
          />

          <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_460px]">
            <section className="flex min-h-[420px] flex-col rounded-xl border border-ink-700/60 bg-ink-900/40 p-3">
              <DayProgress status={status} graceDays={engine.config.graceDays} />
              <div className="relative mt-3 min-h-0 flex-1">
                {viewMode === '2d' ? (
                  <ArenaCanvas
                    engine={engine}
                    pinnedId={pinnedId}
                    onPinnedChange={setPinnedId}
                    selectedTribeId={selectedTribeId}
                    onSelectTribe={setSelectedTribeId}
                    focusTarget={focusTarget}
                    directorMode={directorMode}
                  />
                ) : (
                  <Suspense fallback={<div className="flex h-full items-center justify-center text-[12px] text-ink-500">Loading 3D world…</div>}>
                    <World3D
                      engine={engine}
                      pinnedId={pinnedId}
                      onPinnedChange={setPinnedId}
                      selectedTribeId={selectedTribeId}
                      onSelectTribe={setSelectedTribeId}
                      focusTarget={focusTarget}
                      directorMode={directorMode}
                    />
                  </Suspense>
                )}
                {selectedTribeId !== null && (
                  <CampInspector
                    engine={engine}
                    tribeId={selectedTribeId}
                    onClose={() => setSelectedTribeId(null)}
                    onAction={syncUi}
                  />
                )}
                <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5">
                  <div className="flex rounded-full border border-ink-700/80 bg-ink-900/80 p-0.5 backdrop-blur">
                    {(['2d', '3d'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setViewMode(m)}
                        title="Switch view (V)"
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase transition ${
                          viewMode === m ? 'bg-ink-700 text-ink-200' : 'text-ink-500 hover:text-ink-300'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirectorMode((d) => !d)}
                    title="Director camera: auto-follow wars, splits & festivals (D)"
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur transition ${
                      directorMode
                        ? 'border-amber-400/60 bg-amber-400/20 text-amber-200'
                        : 'border-ink-700/80 bg-ink-900/80 text-ink-400 hover:text-ink-200'
                    }`}
                  >
                    Director
                  </button>
                </div>
                {engine.events.length > 0 && (
                  <div className="pointer-events-none absolute top-11 left-2 z-10 flex max-w-[300px] flex-col gap-1">
                    {engine.events
                      .slice(-2)
                      .reverse()
                      .map((ev, i) => {
                        const t = engine.tribes[ev.tribeId];
                        return (
                          <button
                            key={`${ev.day}-${ev.kind}-${i}`}
                            type="button"
                            onClick={() => focusCamp(ev.tribeId)}
                            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-ink-700/70 bg-ink-900/80 px-2.5 py-1 text-left text-[10.5px] text-ink-200 shadow backdrop-blur transition hover:border-ink-500"
                            style={{ opacity: i === 0 ? 0.95 : 0.72 }}
                            title="Jump camera to camp"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t?.color ?? '#c8d0df' }} />
                            <span className="truncate">{ev.text}</span>
                            <span className="ml-auto shrink-0 font-mono text-[9.5px] text-ink-500">d{ev.day}</span>
                          </button>
                        );
                      })}
                  </div>
                )}
                <DiscoveryCard engine={engine} day={status.day} onFocus={focusCamp} />
                {(status.phase === 'extinct' || status.phase === 'won') && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="min-w-[280px] rounded-xl border border-ink-600/70 bg-ink-900/90 px-6 py-5 text-center shadow-2xl backdrop-blur">
                      <EndSummary status={status} />
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
                  <span className="h-2 w-2 rounded-full" style={{ background: RESOURCE_COLORS.food }} /> berries
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#8ce0ff]" /> fish
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rotate-45" style={{ background: '#2f6b47' }} /> trees
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: RESOURCE_COLORS.stone }} /> stone
                </span>
                <span>Carry to your Town Hall · camps evolve into modern cities with factories, power grids, labs, hospitals, skyscrapers & highways</span>
                <span className="flex items-center gap-2">
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#e6c37a]" /> forager</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#4ca968]" /> woodcutter</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#6e9be6]" /> miner</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#f5c451]" /> builder</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#ff6b6b]" /> soldier</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#d4a373]" /> carrier</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#5fe0e0]" /> scout</span>
                </span>
                <span className="ml-auto">
                  {viewMode === '2d' ? 'Scroll to zoom · drag to pan · ' : ''}Space play · → step · Y next year · R reset · F fittest · V 2D/3D · D director
                </span>
              </footer>
            </section>

            <aside className="min-h-0 overflow-y-auto pr-0.5">
              <ChartsPanel
                history={engine.history}
                genes={engine.generationGenes}
                tribes={engine.tribes}
                realms={engine.realms}
                winters={engine.winters}
                events={engine.events}
                status={status}
                selectedTribeId={selectedTribeId}
                onSelectTribe={setSelectedTribeId}
                revision={revision}
              />
            </aside>
          </main>
          </>
      )}
    </div>
  );
}

function QuarterProgress({ status }: { status: CorporateStatus }) {
  const { activity, headcount } = status;
  const total = headcount || 1;
  return (
    <div className="px-1">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
        <span className="text-[13px] font-semibold text-ink-200">
          FY{status.fiscalYear} · Q{status.quarterOfYear} · Week {status.week}
        </span>
        <span className="text-ink-500">
          {status.week >= 12 ? 'performance reviews imminent' : status.week <= 2 ? 'fresh quarter · new OKRs' : 'heads down, shipping'}
        </span>
        <span className="font-mono text-ink-400 tabular-nums">
          QTD revenue <span className="text-[#6fe39a]">{Math.round(status.revenueQtd)}</span> · visibility{' '}
          <span className="text-[#ff5fd2]">{Math.round(status.visibilityQtd)}</span> · political credit{' '}
          <span className="text-[#ffb347]">{Math.round(status.politicalQtd)}</span> · medical leave{' '}
          <span className="text-[#ff6b6b]">{status.medicalQtd}</span>
        </span>
        <span className="ml-auto font-mono text-ink-300 tabular-nums">
          {headcount} <span className="text-ink-500">employees</span>
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-700/70" title="What everyone is doing right now">
        <div className="h-full bg-[#4fe3f0]/80" style={{ width: `${(activity.work / total) * 100}%` }} />
        <div className="h-full bg-[#ffb347]/80" style={{ width: `${(activity.break / total) * 100}%` }} />
        <div className="h-full bg-[#ff5fd2]/80" style={{ width: `${(activity.network / total) * 100}%` }} />
      </div>
      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-ink-800">
        <div className="h-full bg-[#f5c451]/70" style={{ width: `${status.quarterProgress * 100}%` }} />
      </div>
    </div>
  );
}

/** Headline for the newest invention or culture shift, shown for a couple of days. */
function DiscoveryCard({ engine, day, onFocus }: { engine: SimulationEngine; day: number; onFocus: (tribeId: number) => void }) {
  let latest: WorldEvent | null = null;
  for (let i = engine.events.length - 1; i >= 0; i--) {
    const e = engine.events[i];
    if (day - e.day > 2) break;
    if (e.kind === 'invention' || e.kind === 'culture') {
      latest = e;
      break;
    }
  }
  if (!latest) return null;
  const t = engine.tribes[latest.tribeId];
  const [headline, detail] = latest.kind === 'invention' ? splitDetail(latest.text) : [latest.text, null];
  return (
    <button
      key={`${latest.day}-${latest.text}`}
      type="button"
      onClick={() => onFocus(latest.tribeId)}
      className="absolute top-2 left-1/2 z-20 max-w-[420px] -translate-x-1/2 rounded-xl border bg-ink-900/90 px-4 py-2 text-center shadow-2xl backdrop-blur"
      style={{ borderColor: t?.color ?? '#c8d0df' }}
      title="Jump camera to camp"
    >
      <div className="text-[9.5px] font-medium tracking-wider uppercase" style={{ color: t?.color }}>
        {latest.kind === 'invention' ? '✦ Discovery' : '❖ Culture shift'} · day {latest.day}
      </div>
      <div className="text-[13px] font-semibold text-ink-200">{headline}</div>
      {detail && <div className="text-[10.5px] text-ink-400">{detail}</div>}
    </button>
  );
}

function splitDetail(text: string): [string, string | null] {
  const open = text.lastIndexOf(' (');
  return open > 0 && text.endsWith(')') ? [text.slice(0, open), text.slice(open + 2, -1)] : [text, null];
}

function EndSummary({ status }: { status: DayStatus }) {
  const winner = status.winnerId === null ? null : status.tribes[status.winnerId];
  const fallen = status.tribes.filter((t) => t.fallenDay !== null).sort((a, b) => b.fallenDay! - a.fallenDay!);
  return (
    <>
      {winner ? (
        <>
          <p className="text-[10px] font-medium tracking-wider text-ink-500 uppercase">Last tribe standing</p>
          <p className="mt-1 text-[22px] font-semibold" style={{ color: winner.color }}>
            {winner.name} wins
          </p>
          <p className="mt-0.5 text-[12px] text-ink-400">
            Year {status.year}, day {status.dayOfYear + 1} · {winner.population} blobs · {Math.floor(winner.stockpile.food)} food in store
          </p>
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold text-ink-200">Every tribe has fallen · day {status.day}</p>
          <p className="mt-1 text-[12px] text-ink-400">No camp could feed itself through the seasons.</p>
        </>
      )}
      {fallen.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-left font-mono text-[11px]">
          {fallen.map((t) => (
            <li key={t.id} className="flex justify-between gap-6">
              <span style={{ color: t.color }}>{t.name}</span>
              <span className="text-ink-500">fell on day {t.fallenDay}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const SEASON_STYLE = {
  summer: { label: 'Summer', color: '#f5c451', note: 'harvests at full strength' },
  fall: { label: 'Fall', color: '#e08a4f', note: 'harvests thinning · stock up' },
  winter: { label: 'Winter', color: '#b9d4ff', note: 'little regrowth · cold drains energy outside shelters' },
} as const;

function DayProgress({ status, graceDays }: { status: DayStatus; graceDays: number }) {
  const season = SEASON_STYLE[status.season];
  const dayPct = status.phase === 'night' ? 100 : (status.tick / status.dayTicks) * 100;
  const phaseLabel = {
    day: 'Working',
    night: 'Night · rations, births & building plans',
    won: `${status.winnerId !== null ? status.tribes[status.winnerId].name : ''} wins`,
    extinct: 'All tribes fallen',
  }[status.phase];
  const alive = status.tribes.filter((t) => !t.extinct);
  const total = alive.reduce((s, t) => s + t.population, 0) || 1;
  return (
    <div className="px-1">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px]">
        <span className="text-[13px] font-semibold text-ink-200">
          Year {status.year} · Day {status.dayOfYear + 1}
        </span>
        <span className="font-medium" style={{ color: season.color }}>
          {season.label}
        </span>
        <span className="text-ink-500">{season.note}</span>
        <span className="text-ink-500">· {phaseLabel}</span>
        {status.day <= graceDays && <span className="text-amber-300/80">· founding era: tribes reseeded until day {graceDays}</span>}
        <span className="ml-auto font-mono text-ink-300 tabular-nums">
          {status.population} <span className="text-ink-500">blobs</span>
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-700/70">
        {alive.map((t) => (
          <div key={t.id} className="h-full transition-[width] duration-150" style={{ width: `${(t.population / total) * 100}%`, background: t.color, opacity: 0.8 }} />
        ))}
      </div>
      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-ink-800">
        <div className="h-full" style={{ width: `${dayPct}%`, background: season.color, opacity: 0.6 }} />
      </div>
    </div>
  );
}
