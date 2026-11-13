import type { ReactNode } from 'react';
import type { ScenarioPreset } from '../engine/config';

export type SpeedSetting = 1 | 5 | 25 | 'max';
export const SPEEDS: SpeedSetting[] = [1, 5, 25, 'max'];

export interface LiveParams {
  foodPerDay: number;
  mutationRate: number;
  initialPopulation: number;
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
          note={pending.foodPerDay ? 'applies next day' : 'pellets spawned each morning'}
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
          note={pending.mutationRate ? 'applies next day' : 'σ of offspring trait noise'}
          pending={pending.mutationRate}
          onChange={(v) => onParam('mutationRate', v / 100)}
        />
        <Slider
          label="Initial population"
          value={params.initialPopulation}
          min={10}
          max={100}
          step={1}
          display={String(params.initialPopulation)}
          color="#6aa8ff"
          note={pending.initialPopulation ? 'applies on reset' : 'founders on day 1'}
          pending={pending.initialPopulation}
          onChange={(v) => onParam('initialPopulation', v)}
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
