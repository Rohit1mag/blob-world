import { useImperativeHandle, useRef, type Ref } from 'react';
import type { SimulationEngine } from '../engine/SimulationEngine';
import type { Blob, ResourceType } from '../engine/types';
import { BrainVisualizer } from './BrainVisualizer';

const RESOURCE_LABEL: Record<ResourceType, string> = { food: 'berries', timber: 'wood', stone: 'stone' };

const CARD_FIELDS = [
  'title',
  'state',
  'tribe',
  'role',
  'cargo',
  'energy',
  'throttle',
  'coop',
  'delivered',
  'kills',
  'age',
  'generation',
  'maxSpeed',
  'size',
  'sense',
  'intelligence',
] as const;
type CardField = (typeof CARD_FIELDS)[number];

const DEATH_LABEL: Record<NonNullable<Blob['deathCause']>, string> = {
  starved: 'Starved',
  exhausted: 'Exhausted',
  slain: 'Slain',
  disease: 'Disease',
  age: 'Old age',
};
const ROLE_LABEL: Record<Blob['role'], string> = {
  gatherer: 'Gatherer',
  builder: 'Builder',
  warrior: 'Warrior',
  idle: 'Idle',
};
const JOB_LABEL: Record<Blob['job'], string> = {
  forager: 'Forager',
  lumberjack: 'Woodcutter',
  miner: 'Miner',
  builder: 'Builder',
  soldier: 'Soldier',
  carrier: 'Carrier',
  scout: 'Scout',
};

export interface BlobCardHandle {
  /**
   * Show `b` beside screen point (sx, sy), `offset` px away, kept inside a `width`×`height`
   * viewport. Called every frame, so it writes to the DOM directly instead of re-rendering.
   */
  update(b: Blob | null, sx: number, sy: number, offset: number, width: number, height: number): void;
}

/** Floating inspector for the hovered or pinned blob; shows the brain once pinned. */
export function BlobCard({ engine, pinnedBlob, ref }: { engine: SimulationEngine; pinnedBlob: Blob | null; ref: Ref<BlobCardHandle> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const energyBarRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<CardField, HTMLElement | null>>>({});

  useImperativeHandle(ref, () => ({
    update(b, sx, sy, offset, width, height) {
      const card = cardRef.current;
      if (!card) return;
      if (!b) {
        card.style.opacity = '0';
        return;
      }
      const tribe = engine.tribes[b.tribeId];
      const f = fieldRefs.current;
      const set = (k: CardField, v: string) => {
        const el = f[k];
        if (el && el.textContent !== v) el.textContent = v;
      };
      const cfg = engine.config;
      set('title', `Blob #${b.id}`);
      set('state', b.state === 'dead' ? DEATH_LABEL[b.deathCause ?? 'starved'] : b.newborn ? 'Newborn' : b.sheltered ? 'Sheltered' : 'Active');
      set('tribe', tribe.name);
      set('role', `${JOB_LABEL[b.job]} · ${ROLE_LABEL[b.role]}`);
      set('cargo', b.cargo.type ? `${b.cargo.amount} ${RESOURCE_LABEL[b.cargo.type]}` : 'empty');
      set('energy', `${b.energy.toFixed(0)} / ${b.maxEnergy.toFixed(0)}`);
      set('throttle', b.state === 'active' ? `${Math.round(b.throttle * 100)}%` : '–');
      const intent = b.coop <= cfg.aggressionThreshold ? 'raid' : b.coop >= cfg.cooperationThreshold ? 'build' : 'gather';
      set('coop', b.state === 'active' ? `${b.coop >= 0 ? '+' : ''}${b.coop.toFixed(2)} ${intent}` : '–');
      set('delivered', `${b.delivered} · ${b.harvested} picked`);
      set('kills', `${b.kills} · ${b.attacks} hits`);
      set('age', `${b.daysSurvived} / ${b.maxAge} d`);
      set('generation', `${b.generation} · L-${String(b.lineageId).padStart(3, '0')}`);
      set('maxSpeed', b.genes.maxSpeed.toFixed(2));
      set('size', b.genes.size.toFixed(2));
      set('sense', b.genes.senseRadius.toFixed(0));
      set('intelligence', b.genes.intelligence.toFixed(2));
      if (energyBarRef.current) {
        energyBarRef.current.style.width = `${Math.max(0, Math.min(1, b.energy / b.maxEnergy)) * 100}%`;
      }
      card.style.setProperty('--blob', tribe.color);

      const w = card.offsetWidth;
      const h = card.offsetHeight;
      let x = sx + offset;
      if (x + w > width - 4) x = sx - offset - w;
      x = Math.max(4, Math.min(width - w - 4, x));
      const y = Math.max(4, Math.min(height - h - 4, sy - h / 2));
      card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      card.style.opacity = '1';
    },
  }));

  const showBrain = pinnedBlob !== null;
  const { inputs, hidden, outputs } = engine.blobs[0]?.brain.shape ?? { inputs: 0, hidden: 0, outputs: 0 };
  const row = (label: string, key: CardField, color?: string) => (
    <CardRow label={label} color={color} fieldRef={(el) => (fieldRefs.current[key] = el)} />
  );

  return (
    <div
      ref={cardRef}
      className={`pointer-events-none absolute top-0 left-0 z-10 rounded-lg border border-ink-600/70 bg-ink-900/92 px-3 py-2.5 shadow-2xl shadow-black/40 backdrop-blur-sm transition-opacity duration-150 ${
        showBrain ? 'w-[262px]' : 'w-52'
      }`}
      style={{ opacity: 0 }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--blob)' }} />
        <span ref={(el) => void (fieldRefs.current.title = el)} className="text-[12px] font-semibold text-ink-200" />
        <span ref={(el) => void (fieldRefs.current.state = el)} className="ml-auto text-[10px] font-medium tracking-wide text-ink-400 uppercase" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {row('Tribe', 'tribe', 'var(--blob)')}
        {row('Role', 'role')}
        {row('Cargo', 'cargo')}
        {row('Energy', 'energy')}
      </dl>
      <div className="mt-1 mb-1.5 h-1 overflow-hidden rounded-full bg-ink-700">
        <div ref={energyBarRef} className="h-full rounded-full bg-amber-300/80" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {row('Throttle', 'throttle')}
        {row('Coop', 'coop')}
        {row('Delivered', 'delivered')}
        {row('Kills', 'kills')}
        {row('Age', 'age')}
        {row('Gen', 'generation')}
      </dl>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-ink-700/70 pt-1.5 font-mono text-[11px]">
        {row('Max speed', 'maxSpeed', 'var(--color-gene-speed)')}
        {row('Size', 'size', 'var(--color-gene-size)')}
        {row('Sense', 'sense', 'var(--color-gene-sense)')}
        {row('Intel', 'intelligence', '#c792ea')}
      </dl>
      {showBrain ? (
        <div className="mt-2 border-t border-ink-700/70 pt-2">
          <div className="mb-1 flex items-center justify-between text-[9.5px]">
            <span className="font-medium tracking-wider text-ink-400 uppercase">
              Brain · {inputs} → {hidden} → {outputs}
            </span>
            <span className="flex gap-2 text-ink-500">
              <span className="text-[#5eead4]">+</span>
              <span className="text-[#ff7f6a]">−</span>
            </span>
          </div>
          <BrainVisualizer net={pinnedBlob.brain} />
        </div>
      ) : (
        <p className="mt-2 text-[9.5px] text-ink-500">Click to pin and inspect its brain</p>
      )}
    </div>
  );
}

function CardRow({ label, color, fieldRef }: { label: string; color?: string; fieldRef: (el: HTMLElement | null) => void }) {
  return (
    <>
      <dt className="text-ink-400" style={color ? { color } : undefined}>
        {label}
      </dt>
      <dd ref={fieldRef} className="text-right text-ink-200 tabular-nums" />
    </>
  );
}
