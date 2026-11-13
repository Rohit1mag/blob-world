import { useEffect, useRef } from 'react';
import type { SimulationEngine } from '../engine/SimulationEngine';
import type { Blob } from '../engine/types';
import { blobColors } from './blobColor';
import { useElementSize } from './useElementSize';

/** World-space padding around the arena so blobs sitting on the border aren't clipped. */
const PAD = 28;
const FOOD_COLOR = '#b6f36b';

const CARD_FIELDS = ['title', 'state', 'speed', 'size', 'sense', 'energy', 'food', 'generation', 'lineage'] as const;
type CardField = (typeof CARD_FIELDS)[number];

const STATE_LABEL: Record<Blob['state'], string> = {
  foraging: 'Foraging',
  returning: 'Heading home',
  home: 'Safe at home',
  starved: 'Starved',
  eaten: 'Eaten',
};

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

interface ArenaCanvasProps {
  engine: SimulationEngine;
}

export function ArenaCanvas({ engine }: ArenaCanvasProps) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const energyBarRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Partial<Record<CardField, HTMLElement | null>>>({});
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverId = useRef<number | null>(null);
  const pinnedId = useRef<number | null>(null);
  const sideRef = useRef(0);

  const side = Math.max(0, Math.floor(Math.min(size.width, size.height)));
  sideRef.current = side;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || side === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
  }, [side]);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const s = sideRef.current;
      if (!canvas || s === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      render(ctx, canvas, s);
    };

    const render = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: number) => {
      const L = engine.config.arenaSize;
      const dpr = canvas.width / s;
      const scale = s / (L + PAD * 2);
      const px = 1 / scale;
      const dusk = engine.duskProgress;
      const tick = engine.tick;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * scale * PAD, dpr * scale * PAD);

      // Arena floor + faint graph-paper grid.
      ctx.fillStyle = '#121927';
      ctx.fillRect(0, 0, L, L);
      ctx.strokeStyle = 'rgba(125,137,163,0.07)';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (let g = 100; g < L; g += 100) {
        ctx.moveTo(g, 0);
        ctx.lineTo(g, L);
        ctx.moveTo(0, g);
        ctx.lineTo(L, g);
      }
      ctx.stroke();

      // Home perimeter.
      ctx.strokeStyle = 'rgba(125,137,163,0.10)';
      ctx.lineWidth = 22;
      ctx.strokeRect(0, 0, L, L);
      ctx.strokeStyle = 'rgba(167,177,198,0.45)';
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(0, 0, L, L);
      ctx.setLineDash([4 * px, 6 * px]);
      ctx.strokeStyle = 'rgba(167,177,198,0.16)';
      ctx.strokeRect(11, 11, L - 22, L - 22);
      ctx.setLineDash([]);

      // Food.
      ctx.fillStyle = 'rgba(182,243,107,0.13)';
      ctx.beginPath();
      for (const f of engine.food) {
        if (f.eaten) continue;
        ctx.moveTo(f.x + 7, f.y);
        ctx.arc(f.x, f.y, 7, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = FOOD_COLOR;
      ctx.beginPath();
      for (const f of engine.food) {
        if (f.eaten) continue;
        ctx.moveTo(f.x + 3.6, f.y);
        ctx.arc(f.x, f.y, 3.6, 0, Math.PI * 2);
      }
      ctx.fill();

      // Hit-test under the pointer every frame since blobs move beneath a still cursor.
      hoverId.current = null;
      if (pointer.current) {
        const wx = pointer.current.x / scale - PAD;
        const wy = pointer.current.y / scale - PAD;
        let best = Infinity;
        for (const b of engine.blobs) {
          if (b.state === 'eaten') continue;
          const d = Math.hypot(b.x - wx, b.y - wy);
          if (d < b.radius + 6 * px && d < best) {
            best = d;
            hoverId.current = b.id;
          }
        }
      }
      canvas.style.cursor = hoverId.current !== null ? 'pointer' : 'default';

      if (pinnedId.current !== null && !engine.blobs.some((b) => b.id === pinnedId.current)) {
        pinnedId.current = null;
      }
      const selectedId = pinnedId.current ?? hoverId.current;
      let selected: Blob | null = null;

      // Draw in layers: the dead underneath, then the living, selection on top.
      for (let pass = 0; pass < 2; pass++) {
        for (const b of engine.blobs) {
          const dead = b.state === 'starved' || b.state === 'eaten';
          if ((pass === 0) !== dead) continue;
          if (b.id === selectedId) {
            selected = b;
            continue;
          }
          drawBlob(ctx, b, tick, dusk, px);
        }
      }
      if (selected) {
        drawSelection(ctx, selected, px);
        drawBlob(ctx, selected, tick, dusk, px);
      }

      updateCard(selected, scale, s);
    };

    const updateCard = (b: Blob | null, scale: number, s: number) => {
      const card = cardRef.current;
      if (!card) return;
      if (!b) {
        card.style.opacity = '0';
        return;
      }
      const f = fieldRefs.current;
      const set = (k: CardField, v: string) => {
        const el = f[k];
        if (el && el.textContent !== v) el.textContent = v;
      };
      set('title', `Blob #${b.id}`);
      set('state', STATE_LABEL[b.state]);
      set('speed', b.genes.speed.toFixed(2));
      set('size', b.genes.size.toFixed(2));
      set('sense', b.genes.senseRadius.toFixed(0));
      set('energy', `${b.energy.toFixed(0)} / ${b.maxEnergy.toFixed(0)}`);
      set('food', String(b.foodEaten));
      set('generation', String(b.generation));
      set('lineage', `L-${String(b.lineageId).padStart(3, '0')}`);
      if (energyBarRef.current) {
        energyBarRef.current.style.width = `${Math.max(0, Math.min(1, b.energy / b.maxEnergy)) * 100}%`;
      }
      const { fill } = blobColors(b.genes);
      card.style.setProperty('--blob', fill);

      const sx = (b.x + PAD) * scale;
      const sy = (b.y + PAD) * scale;
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const offset = b.radius * scale + 14;
      let x = sx + offset;
      if (x + w > s - 4) x = sx - offset - w;
      const y = Math.max(4, Math.min(s - h - 4, sy - h / 2));
      card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      card.style.opacity = '1';
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  const toLocal = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: side, height: side }}>
        <canvas
          ref={canvasRef}
          className="block rounded-xl"
          style={{ width: side, height: side }}
          onPointerMove={(e) => (pointer.current = toLocal(e))}
          onPointerLeave={() => (pointer.current = null)}
          onPointerDown={(e) => {
            pointer.current = toLocal(e);
            // The hover id is from the last rendered frame, which is what the user clicked on.
            pinnedId.current = hoverId.current === pinnedId.current ? null : hoverId.current;
          }}
        />
        <div
          ref={cardRef}
          className="pointer-events-none absolute top-0 left-0 w-48 rounded-lg border border-ink-600/70 bg-ink-900/92 px-3 py-2.5 shadow-2xl shadow-black/40 backdrop-blur-sm transition-opacity duration-150"
          style={{ opacity: 0 }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--blob)' }} />
            <span ref={(el) => void (fieldRefs.current.title = el)} className="text-[12px] font-semibold text-ink-200" />
            <span
              ref={(el) => void (fieldRefs.current.state = el)}
              className="ml-auto text-[10px] font-medium tracking-wide text-ink-400 uppercase"
            />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <CardRow label="Speed" color="var(--color-gene-speed)" fieldRef={(el) => (fieldRefs.current.speed = el)} />
            <CardRow label="Size" color="var(--color-gene-size)" fieldRef={(el) => (fieldRefs.current.size = el)} />
            <CardRow label="Sense" color="var(--color-gene-sense)" fieldRef={(el) => (fieldRefs.current.sense = el)} />
            <CardRow label="Energy" fieldRef={(el) => (fieldRefs.current.energy = el)} />
          </dl>
          <div className="mt-1 mb-1.5 h-1 overflow-hidden rounded-full bg-ink-700">
            <div ref={energyBarRef} className="h-full rounded-full bg-amber-300/80" />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
            <CardRow label="Food" fieldRef={(el) => (fieldRefs.current.food = el)} />
            <CardRow label="Generation" fieldRef={(el) => (fieldRefs.current.generation = el)} />
            <CardRow label="Lineage" fieldRef={(el) => (fieldRefs.current.lineage = el)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function CardRow({
  label,
  color,
  fieldRef,
}: {
  label: string;
  color?: string;
  fieldRef: (el: HTMLElement | null) => void;
}) {
  return (
    <>
      <dt className="text-ink-400" style={color ? { color } : undefined}>
        {label}
      </dt>
      <dd ref={fieldRef} className="text-right text-ink-200 tabular-nums" />
    </>
  );
}

function drawBlob(ctx: CanvasRenderingContext2D, b: Blob, tick: number, dusk: number, px: number): void {
  let alpha = 1;
  let scale = 1;
  const starved = b.state === 'starved';

  if (b.state === 'eaten') {
    scale = Math.max(0, 1 - (tick - b.settledTick) / 10);
    if (dusk > 0) scale = 0;
    if (scale <= 0) return;
  } else if (starved) {
    alpha = 0.28;
  }
  if (b.outcome === 'died') alpha *= 1 - dusk;
  if (b.outcome === 'newborn') scale = Math.max(0, easeOutBack(Math.min(1, dusk * 2.2)));
  if (alpha <= 0.01 || scale <= 0.01) return;

  const r = b.radius * scale;
  const { fill, stroke } = blobColors(b.genes);
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fillStyle = starved ? '#4a5570' : fill;
  ctx.fill();
  ctx.lineWidth = 1.4 * px;
  ctx.strokeStyle = starved ? '#2a3244' : stroke;
  ctx.stroke();

  if (b.outcome === 'replicated' && dusk > 0) {
    ctx.globalAlpha = (1 - dusk) * 0.7;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r + 3 + dusk * 14, 0, Math.PI * 2);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  // Eyes look along the heading.
  const h = b.heading;
  const eyeR = r * 0.27;
  const pupilR = r * 0.14;
  for (const side of [-1, 1]) {
    const a = h + side * 0.5;
    const ex = b.x + Math.cos(a) * r * 0.45;
    const ey = b.y + Math.sin(a) * r * 0.45;
    if (starved) {
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.7, ey);
      ctx.lineTo(ex + eyeR * 0.7, ey);
      ctx.strokeStyle = '#1b2230';
      ctx.lineWidth = Math.max(px, r * 0.08);
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f7fb';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + Math.cos(h) * eyeR * 0.42, ey + Math.sin(h) * eyeR * 0.42, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#131924';
    ctx.fill();
  }

  // Food carried today, as pips above the body.
  const pips = Math.min(b.foodEaten, 4);
  if (pips > 0 && !starved) {
    ctx.fillStyle = FOOD_COLOR;
    const spacing = 5.5;
    const startX = b.x - ((pips - 1) * spacing) / 2;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(startX + i * spacing, b.y - r - 5, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawSelection(ctx: CanvasRenderingContext2D, b: Blob, px: number): void {
  const { rgb } = blobColors(b.genes);
  const [r, g, bl] = rgb;
  const active = b.state === 'foraging' || b.state === 'returning';

  ctx.beginPath();
  ctx.arc(b.x, b.y, b.genes.senseRadius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${bl},0.06)`;
  ctx.fill();
  ctx.setLineDash([6 * px, 5 * px]);
  ctx.lineWidth = 1.2 * px;
  ctx.strokeStyle = `rgba(${r},${g},${bl},0.75)`;
  ctx.stroke();

  if (active && b.mode !== 'idle') {
    const color =
      b.mode === 'flee' ? 'rgba(255,122,122,0.8)' : b.mode === 'hunt' ? 'rgba(255,190,90,0.85)' : 'rgba(231,237,246,0.55)';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.targetX, b.targetY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * px;
    ctx.stroke();
    ctx.setLineDash([]);
    if (b.mode !== 'wander' && b.mode !== 'flee') {
      ctx.beginPath();
      ctx.arc(b.targetX, b.targetY, 6, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(244,247,251,0.9)';
  ctx.lineWidth = 1.5 * px;
  ctx.stroke();
}
