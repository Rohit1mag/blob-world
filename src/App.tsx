import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArenaCanvas } from './components/ArenaCanvas';
import { RESOURCE_COLORS } from './components/blobColor';
import { CampInspector } from './components/CampInspector';
import { ChartsPanel } from './components/ChartsPanel';
import { ControlsBar, type LiveParams, type SpeedSetting } from './components/ControlsBar';
import { useAnimationFrame } from './components/useAnimationFrame';
import { PRESETS } from './engine/config';
import { SimulationEngine, type SavedSimulation } from './engine/SimulationEngine';
import type { DayStatus } from './engine/types';
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
  playingRef.current = playing;
  speedRef.current = speed;

  const syncUi = useCallback(() => {
    setRevision(engine.revision);
    setStatus(engine.getStatus());
  }, [engine]);

  const skipRef = useRef<{ startDay: number; target: number } | null>(null);
  const [skipProgress, setSkipProgress] = useState<number | null>(null);
  const stopSkip = useCallback(() => {
    skipRef.current = null;
    setSkipProgress(null);
  }, []);

  // Fixed-timestep driver: simulation rate is decoupled from frame rate, and the
  // loop is suspended entirely while the tab is hidden.
  const loop = useRef({ acc: 0, lastStatusAt: 0, lastChartAt: 0, lastRevision: engine.revision });
  useAnimationFrame((now, rawDt) => {
    const l = loop.current;
    const dt = Math.min(100, rawDt);
    const s = speedRef.current;
    const skip = skipRef.current;

    if (skip) {
      const deadline = performance.now() + SKIP_FRAME_BUDGET_MS;
      while (engine.day < skip.target && !engine.finished && performance.now() < deadline) engine.runTicks(25);
      if (engine.day >= skip.target || engine.finished) {
        stopSkip();
        if (engine.finished) setPlaying(false);
        syncUi();
        saveProgress();
      } else {
        const span = Math.max(1, skip.target - skip.startDay);
        setSkipProgress((engine.day - skip.startDay + engine.tick / engine.config.dayTicks) / span);
      }
      l.acc = 0;
    } else if (playingRef.current) {
      if (s === 'max') {
        const deadline = now + MAX_FRAME_BUDGET_MS;
        for (let done = 0; done < MAX_TICKS_PER_FRAME && !engine.finished; done += 10) {
          engine.runTicks(10);
          if (performance.now() > deadline) break;
        }
      } else {
        l.acc += (dt / 1000) * BASE_TPS * s;
        const n = Math.floor(l.acc);
        l.acc -= n;
        engine.runTicks(Math.min(n, MAX_TICKS_PER_FRAME));
      }
      if (engine.finished) setPlaying(false);
    } else {
      l.acc = 0;
    }

    const chartInterval = skip ? 300 : s === 'max' ? 120 : 0;
    if (engine.revision !== l.lastRevision && now - l.lastChartAt >= chartInterval) {
      l.lastRevision = engine.revision;
      l.lastChartAt = now;
      setRevision(engine.revision);
      if (!skip && engine.day % 5 === 0 && engine.phase === 'day' && engine.tick === 0) {
        saveProgress();
      }
    }
    if (now - l.lastStatusAt > 100) {
      l.lastStatusAt = now;
      setStatus(engine.getStatus());
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
    setPinnedId(engine.fittestBlob()?.id ?? null);
  }, [engine]);

  const togglePlay = useCallback(() => {
    if (engine.finished) return;
    setPlaying((p) => !p);
  }, [engine]);

  const stepDay = useCallback(() => {
    stopSkip();
    setPlaying(false);
    engine.advanceDay();
    syncUi();
    saveProgress();
  }, [engine, syncUi, saveProgress, stopSkip]);

  const skipYear = useCallback(() => {
    if (skipRef.current) {
      stopSkip();
      syncUi();
      saveProgress();
      return;
    }
    if (engine.finished) return;
    skipRef.current = { startDay: engine.day, target: engine.nextYearStartDay };
    setSkipProgress(0);
  }, [engine, syncUi, saveProgress, stopSkip]);

  const reset = useCallback(() => {
    stopSkip();
    engine.reset({ ...params, seed: randomSeed() });
    setPinnedId(null);
    setSelectedTribeId(null);
    syncUi();
    saveProgress();
  }, [engine, params, syncUi, saveProgress, stopSkip]);

  const newWorld = useCallback(async () => {
    stopSkip();
    setPlaying(false);
    const previousId = worldIdRef.current;
    const previous = engine.toJSON();
    if (previousId) await saveWorld(previousId, previous);
    engine.reset({ ...params, seed: randomSeed() });
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
      syncUi();
      throw err;
    }
  }, [engine, params, rememberWorld, syncUi, stopSkip]);

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
            <span className="ml-2 text-[12px] font-medium text-ink-500">Tribes</span>
          </h1>
          <p className="text-[11.5px] text-ink-500">
            {engine.config.mode === 'endless'
              ? 'Tribes gather, build and raid through the seasons. Crowded camps split, ruins are resettled, and brains keep evolving.'
              : 'Rival tribes gather, build and raid through summer, fall and winter. Each brain evolves to help its tribe outlast the rest.'}
          </p>
        </div>
        <div className="flex items-center gap-4 text-[10.5px] text-ink-500">
          <span className="flex max-w-[520px] flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {(engine.config.mode === 'endless' ? living : status.tribes).map((t) => (
              <span key={t.id} className={`flex items-center gap-1.5 ${t.extinct ? 'opacity-40 line-through' : ''}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                <span style={{ color: t.color }}>{t.name}</span>
              </span>
            ))}
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
    </div>
  );
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
