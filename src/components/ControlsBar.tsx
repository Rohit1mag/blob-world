import type { ReactNode } from 'react';
import type { ScenarioPreset } from '../engine/config';
import type { GameMode } from '../engine/types';

export type SpeedSetting = 1 | 5 | 25 | 'max';
export const SPEEDS: SpeedSetting[] = [1, 5, 25, 'max'];

export interface LiveParams {
  foodPerDay: number;
  mutationRate: number;
  blobsPerTribe: number;
  tribeCount: number;
  mode: GameMode;
}

const TRIBE_COUNTS = [3, 4];
const MODES: { id: GameMode; label: string; note: string }[] = [
  { id: 'endless', label: 'Endless', note: 'tribes split, resettle & keep going' },
  { id: 'lastStanding', label: 'Last standing', note: 'ends when one tribe is left' },
];

function Segmented<T extends string | number>({
  label,
  options,
  value,
  note,
  pending,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  note: string;
  pending?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-medium text-ink-300">{label}</span>
      <div className="flex rounded-full border border-ink-700 p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${
              value === o.id ? 'bg-ink-700 text-ink-200' : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className={`text-[9.5px] ${pending ? 'text-amber-300/90' : 'text-ink-500'}`}>{pending ? `● applies on reset` : note}</span>
    </div>
  );
}

interface ControlsBarProps {
  playing: boolean;
  speed: SpeedSetting;
  params: LiveParams;
  /** Params whose new value hasn't taken effect yet. */
  pending: Partial<Record<keyof LiveParams, boolean>>;
  presets: ScenarioPreset[];
  activePreset: string | null;
  onTogglePlay: () => void;
  onStepDay: () => void;
  onSpeed: (s: SpeedSetting) => void;
  onParam: <K extends keyof LiveParams>(key: K, value: LiveParams[K]) => void;
  onPreset: (id: string) => void;
  onReset: () => void;
  onSave?: () => void;
  savedLabel?: string | null;
  onSelectFittest: () => void;
}

function IconButton({
  onClick,
  title,
  children,
  primary,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        primary
          ? 'flex h-9 w-9 items-center justify-center rounded-full bg-ink-200 text-ink-950 transition hover:bg-white active:scale-95'
          : 'flex h-9 w-9 items-center justify-center rounded-full border border-ink-700 text-ink-300 transition hover:border-ink-500 hover:text-ink-200 active:scale-95'
      }
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  color,
  note,
  pending,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  color: string;
  note: string;
  pending?: boolean;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-0.5">
      <span className="flex items-baseline justify-between text-[10.5px]">
        <span className="font-medium text-ink-300">{label}</span>
        <span className="font-mono text-ink-200 tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--fill': `${fill}%`, '--track-fill': color } as React.CSSProperties}
      />
      <span className={`text-[9.5px] ${pending ? 'text-amber-300/90' : 'text-ink-500'}`}>
        {pending ? `● ${note}` : note}
      </span>
    </label>
  );
}

export function ControlsBar({
  playing,
  speed,
  params,
  pending,
  presets,
  activePreset,
  onTogglePlay,
  onStepDay,
  onSpeed,
  onParam,
  onPreset,
  onReset,
  onSave,
  savedLabel,
  onSelectFittest,
}: ControlsBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-ink-700/60 bg-ink-900/70 px-4 py-3">
      <div className="flex items-center gap-2">
        <IconButton onClick={onTogglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'} primary>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <rect x="2.5" y="2" width="3" height="10" rx="0.8" />
              <rect x="8.5" y="2" width="3" height="10" rx="0.8" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
              <path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5Z" />
            </svg>
          )}
        </IconButton>
        <IconButton onClick={onStepDay} title="Step 1 day (→)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M2 2.6v8.8a.5.5 0 0 0 .8.4l6.4-4.4a.5.5 0 0 0 0-.8L2.8 2.2a.5.5 0 0 0-.8.4Z" />
            <rect x="10" y="2" width="2" height="10" rx="0.6" />
          </svg>
        </IconButton>
        <IconButton onClick={onReset} title="Reset with a new seed (R)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2.5 7a4.5 4.5 0 1 0 1.4-3.3" />
            <path d="M2.5 1.8v2.6h2.6" />
          </svg>
        </IconButton>
        <div className="ml-2 flex rounded-full border border-ink-700 p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              className={`rounded-full px-2.5 py-1 font-mono text-[11px] transition ${
                speed === s ? 'bg-ink-700 text-ink-200' : 'text-ink-500 hover:text-ink-300'
              }`}
            >
              {s === 'max' ? 'Max' : `${s}×`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onSelectFittest}
          title="Pin the highest-scoring active blob and show its brain (F)"
          className="ml-1 flex items-center gap-1.5 rounded-full border border-[#5eead4]/40 px-3 py-1 text-[11px] font-medium text-[#5eead4] transition hover:border-[#5eead4]/80 hover:bg-[#5eead4]/10"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.2" />
            <circle cx="6" cy="6" r="1.4" fill="currentColor" />
          </svg>
          Select Fittest
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            title="Save progress to browser storage"
            className="flex items-center gap-1.5 rounded-full border border-ink-600/80 px-3 py-1 text-[11px] font-medium text-ink-300 transition hover:border-ink-400 hover:bg-ink-800"
          >
            <span>Save</span>
            {savedLabel && <span className="font-mono text-[10px] text-emerald-300/90">{savedLabel}</span>}
          </button>
        )}
      </div>

      <div className="flex min-w-[320px] flex-[2] flex-wrap gap-x-5 gap-y-2">
        <Slider
          label="Food per day"
          value={params.foodPerDay}
          min={10}
          max={200}
          step={1}
          display={String(params.foodPerDay)}
          color="#b6f36b"
          note={pending.foodPerDay ? 'applies next day' : 'summer berry regrowth rate'}
          pending={pending.foodPerDay}
          onChange={(v) => onParam('foodPerDay', v)}
        />
        <Slider
          label="Mutation"
          value={Math.round(params.mutationRate * 100)}
          min={0}
          max={30}
          step={1}
          display={`${Math.round(params.mutationRate * 100)}%`}
          color="#c99bff"
          note={pending.mutationRate ? 'applies next day' : 'σ of offspring trait & brain noise'}
          pending={pending.mutationRate}
          onChange={(v) => onParam('mutationRate', v / 100)}
        />
        <Slider
          label="Blobs per tribe"
          value={params.blobsPerTribe}
          min={3}
          max={30}
          step={1}
          display={String(params.blobsPerTribe)}
          color="#6aa8ff"
          note={pending.blobsPerTribe ? 'applies on reset' : 'founders in each camp'}
          pending={pending.blobsPerTribe}
          onChange={(v) => onParam('blobsPerTribe', v)}
        />
        <Segmented
          label="Founding tribes"
          options={TRIBE_COUNTS.map((n) => ({ id: n, label: String(n) }))}
          value={params.tribeCount}
          note="camps on day 1"
          pending={pending.tribeCount}
          onChange={(n) => onParam('tribeCount', n)}
        />
        <Segmented
          label="Mode"
          options={MODES}
          value={params.mode}
          note={MODES.find((m) => m.id === params.mode)!.note}
          pending={pending.mode}
          onChange={(m) => onParam('mode', m)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-medium tracking-wider text-ink-500 uppercase">Scenarios</span>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.description}
            onClick={() => onPreset(p.id)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
              activePreset === p.id
                ? 'border-ink-400 bg-ink-700/70 text-ink-200'
                : 'border-ink-700 text-ink-400 hover:border-ink-500 hover:text-ink-200'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
