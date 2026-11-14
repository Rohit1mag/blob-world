import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TRAIT_COLOR, dominantTrait } from '../engine/culture';
import type { SimulationEngine } from '../engine/SimulationEngine';
import type { Blob, ResourceNode, Structure, Tribe } from '../engine/types';
import { BlobCard, type BlobCardHandle } from './BlobCard';
import { RESOURCE_COLORS, tribePalette } from './blobColor';
import { easeOutBack, seasonWeights, smoothstep } from './seasonVisuals';
import { territoryOutline, traceOutline } from './territory';
import { useAnimationFrame } from './useAnimationFrame';
import { useElementSize } from './useElementSize';

/** World-space padding around the arena so blobs on the border aren't clipped. */
const PAD = 24;
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
const FOLLOW_ZOOM = 3.5;
/** Pointer travel (px) before a press becomes a pan instead of a click. */
const DRAG_THRESHOLD = 4;

/** Camera: zoom relative to fitting the whole map, centred on world point (cx, cy). */
interface View {
  zoom: number;
  cx: number;
  cy: number;
  L: number;
}

interface Particle {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

function makeParticles(n: number, L: number): Particle[] {
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => ({
    x: rnd() * L,
    y: rnd() * L,
    r: 0.8 + rnd() * 1.8,
    speed: 14 + rnd() * 26,
    phase: rnd() * Math.PI * 2,
  }));
}

interface ArenaCanvasProps {
  engine: SimulationEngine;
  /** Blob pinned by click or "Select Fittest"; its brain is shown in the card. */
  pinnedId: number | null;
  onPinnedChange: (id: number | null) => void;
  selectedTribeId?: number | null;
  onSelectTribe?: (id: number | null) => void;
  focusTarget?: { x: number; y: number; seq: number } | null;
  directorMode?: boolean;
}

export function ArenaCanvas({
  engine,
  pinnedId,
  onPinnedChange,
  selectedTribeId = null,
  onSelectTribe,
  focusTarget = null,
  directorMode = false,
}: ArenaCanvasProps) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<BlobCardHandle>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverId = useRef<number | null>(null);
  const pinnedRef = useRef(pinnedId);
  const onPinnedRef = useRef(onPinnedChange);
  pinnedRef.current = pinnedId;
  onPinnedRef.current = onPinnedChange;

  const L = engine.config.arenaSize;
  const particles = useMemo(() => makeParticles(Math.round(160 * (L / 800) ** 2), L), [L]);
  const side = Math.max(0, Math.floor(Math.min(size.width, size.height)));
  const pinnedBlob = pinnedId === null ? null : (engine.blobs.find((b) => b.id === pinnedId) ?? null);

  const view = useRef<View>({ zoom: 1, cx: L / 2, cy: L / 2, L });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [follow, setFollow] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(1);
  const followRef = useRef(follow);
  followRef.current = follow;
  if (pinnedId === null && follow) setFollow(false);
  const directorRef = useRef(directorMode);
  directorRef.current = directorMode;
  const lastFocusSeq = useRef(-1);

  useEffect(() => {
    if (!focusTarget || focusTarget.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusTarget.seq;
    const v = view.current;
    v.cx = focusTarget.x;
    v.cy = focusTarget.y;
    if (v.zoom < 2.2) {
      v.zoom = 2.2;
      setZoomLabel(2.2);
    }
    setFollow(false);
  }, [focusTarget]);

  const scaleFor = (zoom: number) => (side / (L + PAD * 2)) * zoom;
  const clampView = useCallback(
    (v: View) => {
      const scale = (side / (v.L + PAD * 2)) * v.zoom;
      const half = side / (2 * scale);
      for (const k of ['cx', 'cy'] as const) {
        const lo = -PAD + half;
        const hi = v.L + PAD - half;
        v[k] = lo >= hi ? v.L / 2 : Math.min(hi, Math.max(lo, v[k]));
      }
    },
    [side],
  );
  /** Zoom by `factor`, keeping the world point under screen point (sx, sy) fixed. */
  const zoomAt = useCallback(
    (factor: number, sx = side / 2, sy = side / 2) => {
      const v = view.current;
      const before = (side / (v.L + PAD * 2)) * v.zoom;
      const wx = v.cx + (sx - side / 2) / before;
      const wy = v.cy + (sy - side / 2) / before;
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const after = (side / (v.L + PAD * 2)) * v.zoom;
      v.cx = wx - (sx - side / 2) / after;
      v.cy = wy - (sy - side / 2) / after;
      clampView(v);
      setZoomLabel(v.zoom);
    },
    [side, clampView],
  );
  const fitView = useCallback(() => {
    const v = view.current;
    v.zoom = 1;
    v.cx = v.L / 2;
    v.cy = v.L / 2;
    setFollow(false);
    setZoomLabel(1);
  }, []);
  const toggleFollow = () => {
    if (!follow && view.current.zoom < FOLLOW_ZOOM) {
      view.current.zoom = FOLLOW_ZOOM;
      setZoomLabel(FOLLOW_ZOOM);
    }
    setFollow(!follow);
  };

  // React's wheel listener is passive, so attach one that can stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || side === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
  }, [side]);

  useAnimationFrame((now) => {
    const canvas = canvasRef.current;
    if (!canvas || side === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cfg = engine.config;
    const L = cfg.arenaSize;
    const v = view.current;
    if (v.L !== L) Object.assign(v, { zoom: 1, cx: L / 2, cy: L / 2, L });

    if (pinnedRef.current !== null && !engine.blobs.some((b) => b.id === pinnedRef.current)) {
      pinnedRef.current = null;
      onPinnedRef.current(null);
    }
    if (followRef.current && pinnedRef.current !== null) {
      const target = engine.blobs.find((b) => b.id === pinnedRef.current);
      if (target) {
        v.cx += (target.x - v.cx) * 0.12;
        v.cy += (target.y - v.cy) * 0.12;
      }
    } else if (directorRef.current && engine.directorFocus && !drag.current?.moved) {
      v.cx += (engine.directorFocus.x - v.cx) * 0.04;
      v.cy += (engine.directorFocus.y - v.cy) * 0.04;
      if (v.zoom < 1.8) {
        v.zoom += (1.8 - v.zoom) * 0.03;
      }
    }
    clampView(v);

    const dpr = canvas.width / side;
    const scale = (side / (L + PAD * 2)) * v.zoom;
    const px = 1 / scale;
    // Camp labels keep a constant on-screen size at any zoom.
    const labelScale = 0.85 * px;
    const half = side / (2 * scale);
    const inView = (x: number, y: number, r: number) => Math.abs(x - v.cx) < half + r && Math.abs(y - v.cy) < half + r;
    const tick = engine.tick;
    const night = engine.nightProgress;
    const dayFrac = engine.phase === 'night' ? 1 : tick / cfg.dayTicks;
    const yearFrac = (engine.dayOfYear + dayFrac) / cfg.yearLength;
    const season = seasonWeights(yearFrac);
    const time = now / 1000;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (side / 2 - v.cx * scale), dpr * (side / 2 - v.cy * scale));

    drawGround(ctx, L, px, season);
    drawWater(ctx, engine, season.winter, time, px);
    drawFootpaths(ctx, engine, px);
    drawRealmLinks(ctx, engine, px, time);
    drawDiplomacyLinks(ctx, engine, px, time);
    for (const t of engine.tribes) if (!t.extinct) drawTerritory(ctx, t, engine, night, px);
    for (const n of engine.nodes) if (inView(n.x, n.y, 20)) drawNode(ctx, n, season.winter, px);
    for (const s of engine.structures) if (inView(s.x, s.y, 60)) drawStructure(ctx, s, engine.tribes[s.tribeId], engine, tick, px);
    drawTowerShots(ctx, engine, px);
    drawSmokePlumes(ctx, engine, time, night, dayFrac);
    for (const s of engine.structures) if (s.type === 'townCenter') drawCampLabel(ctx, engine.tribes[s.tribeId], engine, labelScale);

    // Hit-test under the pointer every frame since blobs move beneath a still cursor.
    hoverId.current = null;
    if (pointer.current && !drag.current?.moved) {
      const wx = v.cx + (pointer.current.x - side / 2) / scale;
      const wy = v.cy + (pointer.current.y - side / 2) / scale;
      let best = Infinity;
      for (const b of engine.blobs) {
        const d = Math.hypot(b.x - wx, b.y - wy);
        if (d < b.radius + 6 * px && d < best) {
          best = d;
          hoverId.current = b.id;
        }
      }
    }
    canvas.style.cursor = drag.current?.moved ? 'grabbing' : hoverId.current !== null ? 'pointer' : v.zoom > 1 ? 'grab' : 'default';

    const selectedId = pinnedRef.current ?? hoverId.current;
    let selected: Blob | null = null;

    // The dead underneath, then the living, selection on top.
    for (let pass = 0; pass < 2; pass++) {
      for (const b of engine.blobs) {
        if ((pass === 0) !== (b.state === 'dead')) continue;
        if (b.id === selectedId) {
          selected = b;
          continue;
        }
        if (inView(b.x, b.y, 30)) drawBlob(ctx, b, engine, tick, night, px);
      }
    }

    drawWeather(ctx, L, particles, season, time);
    drawNight(ctx, L, engine, night, dayFrac);
    drawVisualFx(ctx, engine, time, px);

    if (selected) {
      drawSelection(ctx, selected, engine, px);
      drawBlob(ctx, selected, engine, tick, night, px);
    }

    const card = cardRef.current;
    if (card) {
      if (selected) {
        const s = selected as Blob;
        card.update(s, (s.x - v.cx) * scale + side / 2, (s.y - v.cy) * scale + side / 2, s.radius * scale + 14, side, side);
      } else card.update(null, 0, 0, 0, side, side);
    }
  });

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
          onPointerMove={(e) => {
            const p = toLocal(e);
            pointer.current = p;
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > DRAG_THRESHOLD) d.moved = true;
            if (d.moved) {
              const scale = scaleFor(view.current.zoom);
              view.current.cx = d.cx - (p.x - d.x) / scale;
              view.current.cy = d.cy - (p.y - d.y) / scale;
              if (followRef.current) setFollow(false);
            }
          }}
          onPointerLeave={() => (pointer.current = null)}
          onPointerDown={(e) => {
            const p = toLocal(e);
            pointer.current = p;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: p.x, y: p.y, cx: view.current.cx, cy: view.current.cy, moved: false };
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            // A press that didn't pan is a click: the hover id is what was under it last frame.
            if (d && !d.moved) {
              if (hoverId.current !== null) {
                onPinnedChange(hoverId.current === pinnedRef.current ? null : hoverId.current);
              } else {
                onPinnedChange(null);
                if (onSelectTribe && side > 0) {
                  const v = view.current;
                  const scale = scaleFor(v.zoom);
                  const wx = v.cx + (d.x - side / 2) / scale;
                  const wy = v.cy + (d.y - side / 2) / scale;
                  let hit: number | null = null;
                  for (const t of engine.tribes) {
                    if (Math.hypot(t.basePosition.x - wx, t.basePosition.y - wy) < 36) {
                      hit = t.id;
                      break;
                    }
                  }
                  onSelectTribe(hit === selectedTribeId ? null : hit);
                }
              }
            }
          }}
          onPointerCancel={() => (drag.current = null)}
          onDoubleClick={fitView}
        />
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-ink-700/80 bg-ink-900/80 p-0.5 text-[11px] text-ink-300 backdrop-blur">
          <MapButton title="Zoom out" onClick={() => zoomAt(1 / 1.5)}>
            −
          </MapButton>
          <span className="w-9 text-center font-mono text-[10px] text-ink-400 tabular-nums">{zoomLabel.toFixed(1)}×</span>
          <MapButton title="Zoom in" onClick={() => zoomAt(1.5)}>
            +
          </MapButton>
          <MapButton title="Fit the whole map (double-click)" onClick={fitView}>
            ⤢
          </MapButton>
          <button
            type="button"
            disabled={pinnedId === null}
            onClick={toggleFollow}
            title={pinnedId === null ? 'Pin a blob to follow it' : 'Keep the camera on the pinned blob'}
            className={`rounded-full px-2.5 py-0.5 text-[11px] transition disabled:opacity-35 ${
              follow ? 'bg-[#5eead4]/20 text-[#5eead4]' : 'hover:text-ink-200'
            }`}
          >
            Follow
          </button>
        </div>
        <BlobCard ref={cardRef} engine={engine} pinnedBlob={pinnedBlob} />
      </div>
    </div>
  );
}

function MapButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-full text-[13px] leading-none transition hover:bg-ink-700/80 hover:text-ink-200"
    >
      {children}
    </button>
  );
}

// ───────────────────────────── World layers ─────────────────────────────

function drawGround(ctx: CanvasRenderingContext2D, L: number, px: number, season: ReturnType<typeof seasonWeights>): void {
  ctx.fillStyle = '#121927';
  ctx.fillRect(0, 0, L, L);

  // Summer: dry, sun-baked glow. Fall: rust tint. Winter: snow cover.
  if (season.summer > 0.01) {
    const g = ctx.createRadialGradient(L * 0.5, L * 0.5, L * 0.05, L * 0.5, L * 0.5, L * 0.75);
    g.addColorStop(0, `rgba(230,190,120,${0.07 * season.summer})`);
    g.addColorStop(1, `rgba(230,170,100,${0.015 * season.summer})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);
  }
  if (season.fall > 0.01) {
    const g = ctx.createLinearGradient(0, 0, L, L);
    g.addColorStop(0, `rgba(214,120,60,${0.09 * season.fall})`);
    g.addColorStop(1, `rgba(150,80,50,${0.05 * season.fall})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);
  }
  if (season.winter > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 0, L);
    g.addColorStop(0, `rgba(225,238,255,${0.16 * season.winter})`);
    g.addColorStop(1, `rgba(170,195,230,${0.08 * season.winter})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, L, L);
  }

  ctx.strokeStyle = 'rgba(125,137,163,0.06)';
  ctx.lineWidth = px;
  ctx.beginPath();
  for (let g = 100; g < L; g += 100) {
    ctx.moveTo(g, 0);
    ctx.lineTo(g, L);
    ctx.moveTo(0, g);
    ctx.lineTo(L, g);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(167,177,198,0.3)';
  ctx.lineWidth = 1.2 * px;
  ctx.strokeRect(0, 0, L, L);
}

function drawFootpaths(ctx: CanvasRenderingContext2D, engine: SimulationEngine, px: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(130, 118, 96, 0.14)';
  ctx.lineWidth = 3.2 * px;
  ctx.lineCap = 'round';
  for (const t of engine.tribes) {
    if (t.extinct) continue;
    const { x, y } = t.basePosition;
    for (const s of engine.structures) {
      if (s.tribeId !== t.id || !s.built || s.type === 'townCenter') continue;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSmokePlumes(ctx: CanvasRenderingContext2D, engine: SimulationEngine, time: number, night: number, dayFrac: number): void {
  const dusk = engine.phase === 'night' ? 0.6 + 0.4 * Math.sin(Math.PI * night) : Math.max(engine.season === 'winter' ? 0.55 : 0, smoothstep(0.75, 1, dayFrac));
  if (dusk <= 0.05) return;
  ctx.save();
  for (const t of engine.tribes) {
    if (t.extinct) continue;
    const { x, y } = t.basePosition;
    for (let i = 0; i < 3; i++) {
      const phase = (time * 0.45 + i * 0.33 + t.id * 0.19) % 1;
      const sx = x + Math.sin(time * 1.6 + i * 2 + t.id) * (3 + phase * 6);
      const sy = y - 16 - phase * 26;
      const r = 2.5 + phase * 5;
      ctx.fillStyle = `rgba(210, 220, 238, ${((1 - phase) * 0.18 * dusk).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawVisualFx(ctx: CanvasRenderingContext2D, engine: SimulationEngine, time: number, px: number): void {
  if (engine.visualFx.length === 0) return;
  const dayTicks = engine.config.dayTicks;
  ctx.save();
  for (const fx of engine.visualFx) {
    const age = (engine.day - fx.day) * dayTicks + (engine.tick - fx.tick);
    const maxAge = fx.kind === 'invention' ? 140 : fx.kind === 'firework' ? 50 : fx.kind === 'popup' ? 28 : 18;
    const u = Math.min(1, Math.max(0, age / maxAge));
    if (u >= 1) continue;
    const alpha = 1 - u;

    if (fx.kind === 'invention' && fx.text) {
      // A discovery banner that rises off the camp and lingers long enough to read.
      const fade = Math.min(1, u * 8) * Math.min(1, (1 - u) * 3);
      const size = 12 * Math.max(0.8, px * 1.1);
      const y = fx.y - u * 26;
      ctx.globalAlpha = fade;
      ctx.font = `700 ${size}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      const label = `✦ ${fx.text}`;
      const w = ctx.measureText(label).width + size * 1.2;
      ctx.fillStyle = 'rgba(12, 16, 26, 0.82)';
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 1.4 * px;
      ctx.beginPath();
      ctx.roundRect(fx.x - w / 2, y - size * 1.05, w, size * 1.55, size * 0.4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff3c4';
      ctx.fillText(label, fx.x, y);
      for (let i = 0; i < 6; i++) {
        const a = time * 2 + (i / 6) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? fx.color : '#ffd166';
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(a) * (w / 2 + 6), y - size * 0.3 + Math.sin(a) * size * 0.9, 1.6 * Math.max(1, px), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (fx.kind === 'clash') {
      ctx.strokeStyle = fx.color;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = (2.2 - u * 1.4) * px;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 6 + u * 22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'splash') {
      if (fx.tx !== undefined && fx.ty !== undefined) {
        ctx.strokeStyle = 'rgba(220, 240, 255, 0.7)';
        ctx.globalAlpha = alpha * 0.8;
        ctx.lineWidth = 1.2 * px;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.quadraticCurveTo((fx.x + fx.tx) / 2, Math.min(fx.y, fx.ty) - 10, fx.tx, fx.ty);
        ctx.stroke();
      }
      ctx.strokeStyle = '#8ce0ff';
      ctx.globalAlpha = alpha * 0.75;
      ctx.lineWidth = 1.4 * px;
      ctx.beginPath();
      ctx.arc(fx.tx ?? fx.x, fx.ty ?? fx.y, 4 + u * 14, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'spark') {
      ctx.fillStyle = fx.color;
      ctx.globalAlpha = alpha * 0.9;
      for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + fx.tick;
        const d = u * 12;
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d - u * 5, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (fx.kind === 'popup' && fx.text) {
      ctx.globalAlpha = alpha;
      ctx.font = `700 ${10 * Math.max(0.7, px * 1.2)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = fx.color;
      ctx.fillText(fx.text, fx.x, fx.y - u * 16);
    } else if (fx.kind === 'firework') {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time * 0.3;
        const d = u * 44;
        ctx.fillStyle = i % 2 === 0 ? fx.color : '#ffd166';
        ctx.globalAlpha = alpha * 0.95;
        ctx.beginPath();
        ctx.arc(fx.x + Math.cos(a) * d, fx.y - 18 - u * 22 + Math.sin(a) * d * 0.7, 2.4 * (1 - u * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  engine: SimulationEngine,
  winter: number,
  time: number,
  px: number,
): void {
  if (engine.river.length === 0 && engine.lakes.length === 0) return;
  ctx.save();
  const bankColor = winter > 0.4 ? 'rgba(130, 155, 185, 0.35)' : 'rgba(92, 118, 98, 0.35)';
  const waterColor = winter > 0.5 ? '#355478' : '#1e4e73';
  const sheenColor = winter > 0.5 ? 'rgba(215, 232, 250, 0.25)' : 'rgba(115, 195, 240, 0.24)';

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Riverbank.
  for (const seg of engine.river) {
    ctx.strokeStyle = bankColor;
    ctx.lineWidth = seg.width + 8;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }
  for (const lk of engine.lakes) {
    ctx.fillStyle = bankColor;
    ctx.beginPath();
    ctx.arc(lk.x, lk.y, lk.radius + 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Deep water.
  for (const seg of engine.river) {
    ctx.strokeStyle = waterColor;
    ctx.lineWidth = seg.width;
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }
  for (const lk of engine.lakes) {
    ctx.fillStyle = waterColor;
    ctx.beginPath();
    ctx.arc(lk.x, lk.y, lk.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gentle current highlights.
  ctx.strokeStyle = sheenColor;
  ctx.lineWidth = 1.6 * px;
  ctx.setLineDash([10 * px, 14 * px]);
  ctx.lineDashOffset = -time * 12 * px;
  for (const seg of engine.river) {
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRealmLinks(ctx: CanvasRenderingContext2D, engine: SimulationEngine, px: number, time: number): void {
  ctx.save();
  // Built and in-progress roads / asphalt highways.
  for (const rd of engine.roads) {
    const a = engine.tribes[rd.fromTribeId]?.basePosition;
    const b = engine.tribes[rd.toTribeId]?.basePosition;
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (rd.built && rd.paved) {
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(14, 18, 26, 0.92)';
      ctx.stroke();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#333b4d';
      ctx.stroke();
      ctx.lineWidth = 1.4 * px;
      ctx.setLineDash([8 * px, 7 * px]);
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
      ctx.stroke();
      // Animated vehicles zipping along the highway.
      ctx.setLineDash([]);
      for (const dir of [0, 0.5]) {
        const u = (time * 0.28 + dir + rd.id * 0.13) % 1;
        const t = dir === 0 ? u : 1 - u;
        const vx = a.x + (b.x - a.x) * t;
        const vy = a.y + (b.y - a.y) * t;
        const ang = Math.atan2(b.y - a.y, b.x - a.x) + (dir === 0 ? 0 : Math.PI);
        ctx.save();
        ctx.translate(vx, vy);
        ctx.rotate(ang);
        ctx.fillStyle = dir === 0 ? '#6aa8ff' : '#ff8a7a';
        ctx.fillRect(-3.2, -1.7, 6.4, 3.4);
        ctx.fillStyle = '#fff3b0';
        ctx.fillRect(2.2, -1.3, 1.2, 2.6);
        ctx.restore();
      }
    } else if (rd.built) {
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(14, 18, 26, 0.85)';
      ctx.stroke();
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = 'rgba(148, 158, 176, 0.9)';
      ctx.stroke();
      ctx.lineWidth = 1.4 * px;
      ctx.setLineDash([7 * px, 6 * px]);
      ctx.strokeStyle = 'rgba(226, 232, 244, 0.72)';
      ctx.stroke();
    } else {
      ctx.setLineDash([5 * px, 5 * px]);
      ctx.lineWidth = 2.6 * px;
      ctx.strokeStyle = 'rgba(160, 170, 188, 0.65)';
      ctx.stroke();
    }
  }
  // Dashed realm links for vassals without a road yet.
  ctx.lineWidth = 1.6 * px;
  ctx.setLineDash([7 * px, 6 * px]);
  for (const t of engine.tribes) {
    if (t.extinct) continue;
    const r = engine.realms[t.realmId];
    if (!r || r.capitalId === t.id) continue;
    const cap = engine.tribes[r.capitalId];
    if (!cap || cap.extinct) continue;
    const hasRoad = engine.roads.some(
      (rd) =>
        (rd.fromTribeId === t.id && rd.toTribeId === cap.id) || (rd.fromTribeId === cap.id && rd.toTribeId === t.id),
    );
    if (hasRoad) continue;
    const p = tribePalette(r.color);
    ctx.strokeStyle = p.alpha(0.32);
    ctx.beginPath();
    ctx.moveTo(t.basePosition.x, t.basePosition.y);
    ctx.lineTo(cap.basePosition.x, cap.basePosition.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDiplomacyLinks(ctx: CanvasRenderingContext2D, engine: SimulationEngine, px: number, time: number): void {
  if (engine.relations.size === 0) return;
  ctx.save();
  for (const rel of engine.relations.values()) {
    if (rel.stance === 'neutral') continue;
    const ra = engine.realms[rel.a];
    const rb = engine.realms[rel.b];
    if (!ra || !rb) continue;
    const capA = engine.tribes[ra.capitalId];
    const capB = engine.tribes[rb.capitalId];
    if (!capA || !capB || capA.extinct || capB.extinct) continue;
    const ax = capA.basePosition.x;
    const ay = capA.basePosition.y;
    const bx = capB.basePosition.x;
    const by = capB.basePosition.y;

    if (rel.stance === 'trade' || rel.stance === 'alliance') {
      const isAlliance = rel.stance === 'alliance';
      ctx.beginPath();
      ctx.setLineDash([4 * px, 6 * px]);
      ctx.lineWidth = (isAlliance ? 2.1 : 1.6) * px;
      ctx.strokeStyle = isAlliance ? 'rgba(111, 227, 154, 0.5)' : 'rgba(255, 209, 102, 0.45)';
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // Animated trade caravans moving back and forth.
      ctx.setLineDash([]);
      for (const dir of [0, 0.5]) {
        const u = (time * 0.14 + dir + rel.a * 0.17) % 1;
        const t = dir === 0 ? u : 1 - u;
        const cx = ax + (bx - ax) * t;
        const cy = ay + (by - ay) * t;
        ctx.fillStyle = isAlliance ? '#6fe39a' : '#ffd166';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(20, 24, 34, 0.85)';
        ctx.lineWidth = px;
        ctx.stroke();
      }
    } else if (rel.stance === 'war') {
      ctx.beginPath();
      ctx.setLineDash([8 * px, 6 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = 'rgba(255, 107, 107, 0.34)';
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawTowerShots(ctx: CanvasRenderingContext2D, engine: SimulationEngine, px: number): void {
  if (engine.towerShots.length === 0) return;
  ctx.save();
  for (const sh of engine.towerShots) {
    const age = engine.tick - sh.tick;
    if (age < 0 || age > 12) continue;
    ctx.strokeStyle = sh.color;
    ctx.globalAlpha = (1 - age / 12) * 0.9;
    ctx.lineWidth = 2.2 * px;
    ctx.beginPath();
    ctx.moveTo(sh.x1, sh.y1);
    ctx.lineTo(sh.x2, sh.y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerritory(ctx: CanvasRenderingContext2D, t: Tribe, engine: SimulationEngine, night: number, px: number): void {
  const p = tribePalette(t.color);
  const { x, y } = t.basePosition;
  const outline = territoryOutline(engine, t);
  const reach = outline.reduce((m, [ox, oy]) => Math.max(m, Math.hypot(ox - x, oy - y)), t.territory);
  const g = ctx.createRadialGradient(x, y, 20, x, y, reach);
  g.addColorStop(0, p.alpha(0.14 + 0.1 * Math.sin(Math.PI * night)));
  g.addColorStop(0.75, p.alpha(0.06));
  g.addColorStop(1, p.alpha(0.02));
  ctx.fillStyle = g;
  traceOutline(ctx, outline);
  ctx.fill();

  const realm = engine.realms[t.realmId];
  const inRealm = realm && realm.tier !== 'chiefdom';
  ctx.save();
  const borderColor = inRealm ? tribePalette(realm.color) : p;
  const isCapital = inRealm && realm.capitalId === t.id;
  ctx.strokeStyle = borderColor.alpha(inRealm ? (isCapital ? 0.55 : 0.3) : 0.22);
  ctx.lineWidth = (isCapital ? 2.2 : 1.3) * px * (t.conquests > 0 ? 1.3 : 1);
  ctx.setLineDash(inRealm && !isCapital ? [5 * px, 5 * px] : []);
  traceOutline(ctx, outline);
  ctx.stroke();
  ctx.restore();

  // Towns, cities, and metropolises get a stone/steel perimeter ring.
  let pop = 0;
  for (const b of engine.blobs) if (b.tribeId === t.id && b.state === 'active') pop++;
  const tier = engine.settlementTier(pop, t.id);
  if (tier === 'town' || tier === 'city' || tier === 'metropolis') {
    ctx.save();
    ctx.strokeStyle = tier === 'metropolis' ? 'rgba(110, 210, 255, 0.35)' : 'rgba(170, 180, 200, 0.28)';
    ctx.lineWidth = (tier === 'metropolis' ? 3 : 2.4) * px;
    ctx.setLineDash([10 * px, 6 * px]);
    traceOutline(ctx, territoryOutline(engine, t, 118 / 165, false));
    ctx.stroke();
    ctx.restore();
  }
}

function drawNode(ctx: CanvasRenderingContext2D, n: ResourceNode, winter: number, px: number): void {
  const fill = n.amount / n.max;
  ctx.globalAlpha = n.amount < 1 ? 0.35 : 1;
  if (n.type === 'food' && n.isFish) {
    // Shimmering fish shoal in water.
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius * 1.15, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(135, 215, 255, 0.45)';
    ctx.lineWidth = px;
    ctx.stroke();
    const count = Math.min(4, Math.max(1, Math.floor(n.amount)));
    ctx.fillStyle = '#8ce0ff';
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + n.id;
      const fx = n.x + Math.cos(a) * n.radius * 0.45;
      const fy = n.y + Math.sin(a) * n.radius * 0.45;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 2.4, 1.1, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (n.type === 'food') {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1d3a31';
    ctx.fill();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#2f5d47';
    ctx.stroke();
    const berries = Math.floor(n.amount);
    ctx.fillStyle = RESOURCE_COLORS.food;
    for (let i = 0; i < berries; i++) {
      const a = (i / Math.max(1, n.max)) * Math.PI * 2 + n.id;
      ctx.beginPath();
      ctx.arc(n.x + Math.cos(a) * n.radius * 0.5, n.y + Math.sin(a) * n.radius * 0.5, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (n.type === 'timber') {
    const r = n.radius * (0.55 + 0.45 * fill);
    ctx.fillStyle = '#5a3d26';
    ctx.fillRect(n.x - 1.4, n.y, 2.8, r * 0.9);
    ctx.fillStyle = '#2f6b47';
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - r * 1.25);
    ctx.lineTo(n.x + r, n.y + r * 0.35);
    ctx.lineTo(n.x - r, n.y + r * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1f4a31';
    ctx.lineWidth = px;
    ctx.stroke();
    if (winter > 0.05) {
      ctx.fillStyle = `rgba(240,246,255,${0.85 * winter})`;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y - r * 1.25);
      ctx.lineTo(n.x + r * 0.45, n.y - r * 0.5);
      ctx.lineTo(n.x - r * 0.45, n.y - r * 0.5);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    const r = n.radius * (0.55 + 0.45 * fill);
    ctx.fillStyle = '#7c8598';
    ctx.strokeStyle = '#4d5568';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + n.id * 0.7;
      const rr = r * (0.8 + 0.2 * Math.sin(n.id * 3 + i * 1.7));
      const x = n.x + Math.cos(a) * rr;
      const y = n.y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,228,240,0.35)';
    ctx.beginPath();
    ctx.arc(n.x - r * 0.25, n.y - r * 0.25, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawStructure(
  ctx: CanvasRenderingContext2D,
  s: Structure,
  tribe: Tribe,
  engine: SimulationEngine,
  tick: number,
  px: number,
): void {
  const p = tribePalette(tribe.color);
  const r = s.radius;
  ctx.globalAlpha = tribe.extinct ? 0.35 : 1;

  if (!s.built) {
    // Blueprint: dashed footprint with a progress ring.
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = p.alpha(0.75);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = p.alpha(0.08);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 3, -Math.PI / 2, -Math.PI / 2 + (s.progress / s.buildTicks) * Math.PI * 2);
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 2 * px;
    ctx.stroke();
    drawStructureGlyph(ctx, s, p.alpha(0.5), px);
    ctx.globalAlpha = 1;
    return;
  }

  if (s.style && !UNSTYLED.has(s.type)) drawStylePlate(ctx, s, px);

  if (s.type === 'townCenter') {
    const w = r * 1.5;
    ctx.fillStyle = '#1a2232';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - w / 2, s.y - w * 0.3, w, w * 0.75, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - w * 0.62, s.y - w * 0.28);
    ctx.lineTo(s.x, s.y - w * 0.78);
    ctx.lineTo(s.x + w * 0.62, s.y - w * 0.28);
    ctx.closePath();
    ctx.fillStyle = p.alpha(0.85);
    ctx.fill();
    ctx.fillStyle = p.stroke;
    ctx.fillRect(s.x - w * 0.12, s.y + w * 0.1, w * 0.24, w * 0.35);
    // Flag (taller for villages, towns, cities & metropolises).
    let pop = 0;
    for (const b of engine.blobs) if (b.tribeId === tribe.id && b.state === 'active') pop++;
    const tier = engine.settlementTier(pop, tribe.id);
    const poleTop = s.y - w * (tier === 'metropolis' || tier === 'city' ? 1.55 : tier === 'town' ? 1.45 : tier === 'village' ? 1.28 : 1.15);
    ctx.strokeStyle = '#c8d0df';
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - w * 0.78);
    ctx.lineTo(s.x, poleTop);
    ctx.stroke();
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.moveTo(s.x, poleTop);
    ctx.lineTo(s.x + (tier === 'town' ? 13 : 9), poleTop + w * 0.09);
    ctx.lineTo(s.x, poleTop + w * 0.18);
    ctx.closePath();
    ctx.fill();
    // Drop-off zone.
    ctx.setLineDash([2 * px, 5 * px]);
    ctx.strokeStyle = p.alpha(0.35);
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (s.type === 'granary') {
    ctx.fillStyle = '#3a2f24';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.75, s.y - r * 0.45, r * 1.5, r * 1.25, 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - r * 0.45, r * 0.75, r * 0.55, 0, Math.PI, 0);
    ctx.fillStyle = p.alpha(0.8);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,180,0.25)';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.75, s.y + 0.15 * r);
    ctx.lineTo(s.x + r * 0.75, s.y + 0.15 * r);
    ctx.moveTo(s.x - r * 0.75, s.y + 0.5 * r);
    ctx.lineTo(s.x + r * 0.75, s.y + 0.5 * r);
    ctx.stroke();
  } else if (s.type === 'shelter') {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y + r * 0.7);
    ctx.lineTo(s.x - r, s.y + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = p.alpha(0.4);
    ctx.fill();
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.6 * px;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y + r * 0.7);
    ctx.lineTo(s.x - r * 0.25, s.y + r * 0.05);
    ctx.lineTo(s.x + r * 0.25, s.y + r * 0.05);
    ctx.closePath();
    ctx.fillStyle = '#141b28';
    ctx.fill();
    if (s.occupants > 0 && engine.season === 'winter') {
      ctx.fillStyle = 'rgba(255,200,120,0.9)';
      ctx.font = `600 8px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(s.occupants), s.x, s.y - r - 3);
    }
  } else if (s.type === 'farm') {
    // Tilled soil plot with crop furrows.
    ctx.fillStyle = '#3b2b1d';
    ctx.strokeStyle = p.alpha(0.75);
    ctx.lineWidth = 1.3 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r, s.y - r * 0.75, r * 2, r * 1.5, 3);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#5fa862';
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      const y = s.y + i * r * 0.28;
      ctx.moveTo(s.x - r * 0.72, y);
      ctx.lineTo(s.x + r * 0.72, y);
    }
    ctx.stroke();
  } else if (s.type === 'workshop') {
    ctx.fillStyle = '#2c3340';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.85, s.y - r * 0.55, r * 1.7, r * 1.2, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d49a4c';
    ctx.fillRect(s.x - r * 0.35, s.y - r * 0.15, r * 0.7, r * 0.45);
  } else if (s.type === 'market') {
    ctx.fillStyle = '#473422';
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.95, s.y - r * 0.65, r * 1.9, r * 1.3, 2);
    ctx.fill();
    ctx.stroke();
    // Striped awning.
    const stripes = 4;
    const sw = (r * 1.8) / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#ffd166' : '#e05d5d';
      ctx.fillRect(s.x - r * 0.9 + i * sw, s.y - r * 0.6, sw, r * 0.55);
    }
  } else if (s.type === 'dock') {
    ctx.fillStyle = '#6f4e31';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.9, s.y - r * 0.65, r * 1.8, r * 1.3, 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#3d2a19';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      ctx.moveTo(s.x - r * 0.85, s.y + i * r * 0.35);
      ctx.lineTo(s.x + r * 0.85, s.y + i * r * 0.35);
    }
    ctx.stroke();
  } else if (s.type === 'bridge') {
    const tc = tribe.basePosition;
    const a = Math.atan2(s.y - tc.y, s.x - tc.x);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    ctx.fillStyle = '#8b6844';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.roundRect(-r * 1.1, -r * 0.55, r * 2.2, r * 1.1, 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#47321e';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      ctx.moveTo(i * r * 0.3, -r * 0.52);
      ctx.lineTo(i * r * 0.3, r * 0.52);
    }
    ctx.stroke();
    ctx.restore();
  } else if (s.type === 'factory') {
    ctx.fillStyle = '#3c4352';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r, s.y - r * 0.65, r * 2, r * 1.3, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#242934';
    ctx.fillRect(s.x - r * 0.75, s.y - r * 0.95, r * 0.35, r * 0.4);
    ctx.fillRect(s.x + r * 0.15, s.y - r * 0.95, r * 0.35, r * 0.4);
  } else if (s.type === 'powerPlant') {
    ctx.fillStyle = '#1d2d44';
    ctx.strokeStyle = '#5fe0e0';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.95, s.y - r * 0.7, r * 1.9, r * 1.4, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5fe0e0';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.type === 'lab') {
    ctx.fillStyle = '#28354a';
    ctx.strokeStyle = '#8fd3ff';
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.82, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8fd3ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.type === 'hospital') {
    ctx.fillStyle = '#e7edf6';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.85, s.y - r * 0.7, r * 1.7, r * 1.4, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff5a5f';
    ctx.fillRect(s.x - r * 0.15, s.y - r * 0.45, r * 0.3, r * 0.9);
    ctx.fillRect(s.x - r * 0.45, s.y - r * 0.15, r * 0.9, r * 0.3);
  } else if (s.type === 'skyscraper') {
    ctx.fillStyle = '#2b4061';
    ctx.strokeStyle = '#8ab4f8';
    ctx.lineWidth = 1.8 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.8, s.y - r * 1.15, r * 1.6, r * 2.1, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = engine.phase === 'night' ? '#ffe082' : 'rgba(180, 220, 255, 0.6)';
    for (let row = -2; row <= 1; row++) {
      for (const col of [-0.42, 0.12]) {
        ctx.fillRect(s.x + col * r, s.y + row * r * 0.42, r * 0.3, r * 0.24);
      }
    }
  } else if (s.type === 'watchtower') {
    ctx.fillStyle = '#353e4e';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - r * 0.72, s.y - r * 0.72, r * 1.44, r * 1.44, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.type === 'monument') {
    ctx.fillStyle = '#6c778c';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r * 0.65, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r * 0.65, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (s.type === 'palace') {
    const w = r * 1.65;
    ctx.fillStyle = '#252e42';
    ctx.strokeStyle = '#f5c451';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.roundRect(s.x - w / 2, s.y - w * 0.38, w, w * 0.76, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y - w * 0.12, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#f5c451';
    ctx.fill();
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.4 * px;
    ctx.stroke();
  } else {
    // Barricade: a palisade segment facing away from the camp.
    const tc = tribe.basePosition;
    const a = Math.atan2(s.y - tc.y, s.x - tc.x) + Math.PI / 2;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    ctx.fillStyle = '#6e5034';
    ctx.strokeStyle = p.fill;
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.roundRect(-r * 1.3, -r * 0.45, r * 2.6, r * 0.9, 1.5);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,20,10,0.6)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(i * r * 0.5, -r * 0.45);
      ctx.lineTo(i * r * 0.5, r * 0.45);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (tick - s.lastHitTick < 10) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,110,100,0.9)';
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }
  if (s.health < s.maxHealth) {
    const w = r * 2;
    const y = s.y + r + 4;
    ctx.fillStyle = 'rgba(10,14,22,0.8)';
    ctx.fillRect(s.x - w / 2, y, w, 2.5);
    ctx.fillStyle = s.health / s.maxHealth > 0.4 ? '#8be3b0' : '#ff8a7a';
    ctx.fillRect(s.x - w / 2, y, (w * s.health) / s.maxHealth, 2.5);
  }
  ctx.globalAlpha = 1;
}

const UNSTYLED = new Set<Structure['type']>(['townCenter', 'farm', 'bridge', 'dock', 'barricade']);
const PENNANTS = ['#ffd166', '#e05d5d', '#5fe0e0'];

/** Culture-specific foundation, so each quarter of a city reads as the culture that built it. */
function drawStylePlate(ctx: CanvasRenderingContext2D, s: Structure, px: number): void {
  const r = s.radius * 1.3;
  if (s.style === 'fortress') {
    ctx.fillStyle = 'rgba(58, 63, 75, 0.9)';
    ctx.strokeStyle = 'rgba(160, 170, 190, 0.6)';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6a7488';
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      ctx.beginPath();
      ctx.arc(s.x + dx * r, s.y + dy * r, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (s.style === 'bazaar') {
    ctx.fillStyle = 'rgba(176, 146, 104, 0.5)';
    ctx.beginPath();
    ctx.roundRect(s.x - r, s.y - r, r * 2, r * 2, r * 0.2);
    ctx.fill();
    ctx.strokeStyle = '#c8d0df';
    ctx.lineWidth = 0.9 * px;
    ctx.beginPath();
    ctx.moveTo(s.x + r * 0.8, s.y - r * 0.6);
    ctx.lineTo(s.x + r * 0.8, s.y - r * 1.45);
    ctx.stroke();
    ctx.fillStyle = PENNANTS[s.id % PENNANTS.length];
    ctx.beginPath();
    ctx.moveTo(s.x + r * 0.8, s.y - r * 1.45);
    ctx.lineTo(s.x + r * 1.3, s.y - r * 1.28);
    ctx.lineTo(s.x + r * 0.8, s.y - r * 1.1);
    ctx.closePath();
    ctx.fill();
  } else if (s.style === 'temple') {
    ctx.fillStyle = 'rgba(232, 224, 200, 0.3)';
    ctx.strokeStyle = 'rgba(245, 196, 81, 0.8)';
    ctx.lineWidth = 1.2 * px;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f5c451';
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (s.style === 'forge') {
    ctx.fillStyle = 'rgba(43, 38, 34, 0.8)';
    ctx.strokeStyle = 'rgba(255, 154, 74, 0.55)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      if (i === 0) ctx.moveTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      else ctx.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a302a';
    ctx.fillRect(s.x + r * 0.45, s.y - r * 1.15, r * 0.3, r * 0.55);
    ctx.fillStyle = '#ff9a4a';
    ctx.beginPath();
    ctx.arc(s.x + r * 0.6, s.y - r * 1.2, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Simple outline icon so blueprints read as the building they will become. */
function drawStructureGlyph(ctx: CanvasRenderingContext2D, s: Structure, color: string, px: number): void {
  const r = s.radius * 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * px;
  ctx.beginPath();
  if (s.type === 'shelter') {
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y + r * 0.7);
    ctx.lineTo(s.x - r, s.y + r * 0.7);
    ctx.closePath();
  } else if (s.type === 'granary') {
    ctx.rect(s.x - r * 0.7, s.y - r * 0.4, r * 1.4, r * 1.1);
    ctx.moveTo(s.x - r * 0.7, s.y - r * 0.4);
    ctx.ellipse(s.x, s.y - r * 0.4, r * 0.7, r * 0.5, 0, Math.PI, 0);
  } else if (s.type === 'farm' || s.type === 'market') {
    ctx.rect(s.x - r, s.y - r * 0.75, r * 2, r * 1.5);
  } else if (s.type === 'watchtower' || s.type === 'monument') {
    ctx.arc(s.x, s.y, r * 0.75, 0, Math.PI * 2);
  } else if (s.type === 'palace') {
    ctx.rect(s.x - r * 1.1, s.y - r * 0.7, r * 2.2, r * 1.4);
    ctx.moveTo(s.x + r * 0.45, s.y);
    ctx.arc(s.x, s.y, r * 0.45, 0, Math.PI * 2);
  } else {
    ctx.rect(s.x - r * 1.2, s.y - r * 0.4, r * 2.4, r * 0.8);
  }
  ctx.stroke();
}

function drawCampLabel(ctx: CanvasRenderingContext2D, t: Tribe, engine: SimulationEngine, k: number): void {
  const p = tribePalette(t.color);
  const { x, y } = t.basePosition;
  let pop = 0;
  for (const b of engine.blobs) if (b.tribeId === t.id && b.state === 'active') pop++;
  const realm = engine.realms[t.realmId];
  const isCap = !t.extinct && realm && realm.capitalId === t.id && realm.tier !== 'chiefdom';
  const isVassal = !t.extinct && realm && realm.capitalId !== t.id;
  const title = t.extinct
    ? `${t.name} · ruins`
    : isCap
      ? `♛ ${realm.tier === 'empire' ? `${realm.name} Empire` : `Kingdom of ${realm.name}`}`
      : isVassal
        ? `${t.name} · ${realm.name}`
        : t.name;
  ctx.textAlign = 'center';
  ctx.font = `600 ${11 * k}px Inter, sans-serif`;
  ctx.fillStyle = t.extinct ? 'rgba(167,177,198,0.45)' : p.fill;
  ctx.fillText(title, x, y + 22 + 12 * k);
  if (!t.extinct) {
    ctx.font = `500 ${8.5 * k}px "JetBrains Mono", monospace`;
    ctx.fillStyle = 'rgba(200,208,223,0.75)';
    const s = t.stockpile;
    ctx.fillText(`${pop} pop · ${Math.floor(s.food)}f ${Math.floor(s.timber)}w ${Math.floor(s.stone)}s`, x, y + 22 + 23 * k);
    ctx.font = `italic 500 ${8.5 * k}px Inter, sans-serif`;
    ctx.fillStyle = TRAIT_COLOR[dominantTrait(t.culture)];
    ctx.fillText(`${t.ethos} · ${t.inventions.length} inventions`, x, y + 22 + 33 * k);
  }
}

function drawBlob(ctx: CanvasRenderingContext2D, b: Blob, engine: SimulationEngine, tick: number, night: number, px: number): void {
  const cfg = engine.config;
  let alpha = 1;
  let scale = 1;
  const dead = b.state === 'dead';
  if (dead) {
    alpha = 0.3 * Math.max(0, 1 - night);
    if (b.deathCause === 'slain') scale = Math.max(0.4, 1 - (tick - b.settledTick) / 20);
  }
  if (b.newborn) scale = Math.max(0, easeOutBack(Math.min(1, night * 2.2)));
  if (alpha <= 0.01 || scale <= 0.01) return;

  const tribe = engine.tribes[b.tribeId];
  const p = tribePalette(tribe.color);
  const r = b.radius * scale;
  const h = b.angle;
  ctx.globalAlpha = alpha;

  // Seafaring tribes paddle across water in little boats.
  if (!dead && (tribe.mods.swim ?? 0) > 0 && engine.isInWater(b.x, b.y)) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(h);
    ctx.fillStyle = '#7a5532';
    ctx.strokeStyle = '#3d2a19';
    ctx.lineWidth = 0.8 * px;
    ctx.beginPath();
    ctx.moveTo(r * 1.9, 0);
    ctx.quadraticCurveTo(r * 0.6, r * 1.25, -r * 1.4, r * 0.9);
    ctx.lineTo(-r * 1.4, -r * 0.9);
    ctx.quadraticCurveTo(r * 0.6, -r * 1.25, r * 1.9, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Subtle aura for high-intelligence blobs, plus lantern glow on scouts & carriers at dusk/night.
  if (!dead && (b.job === 'scout' || b.job === 'carrier')) {
    const dayFrac = engine.phase === 'night' ? 1 : tick / cfg.dayTicks;
    const dusk = engine.phase === 'night' ? 0.9 : smoothstep(0.7, 1, dayFrac);
    if (dusk > 0.05) {
      const lg = ctx.createRadialGradient(b.x, b.y, r * 0.5, b.x, b.y, r * 2.5);
      lg.addColorStop(0, `rgba(255, 205, 110, ${(0.32 * dusk).toFixed(2)})`);
      lg.addColorStop(1, 'rgba(255, 205, 110, 0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!dead && b.genes.intelligence >= 1.25) {
    const t = Math.min(1, (b.genes.intelligence - 1.25) / 1.0);
    const g = ctx.createRadialGradient(b.x, b.y, r * 0.7, b.x, b.y, r * (1.7 + t * 0.6));
    g.addColorStop(0, `rgba(199, 146, 234, ${(0.22 + t * 0.22).toFixed(2)})`);
    g.addColorStop(1, 'rgba(199, 146, 234, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * (1.7 + t * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }

  // Pack on the back, coloured by what it carries.
  if (b.cargo.type && !dead) {
    const bx = b.x - Math.cos(h) * r * 0.95;
    const by = b.y - Math.sin(h) * r * 0.95;
    const s = 2.4 + b.cargo.amount * 1.1;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(h);
    ctx.fillStyle = RESOURCE_COLORS[b.cargo.type];
    ctx.strokeStyle = 'rgba(10,14,22,0.8)';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, 1.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fillStyle = dead ? '#4a5570' : p.fill;
  ctx.fill();
  ctx.lineWidth = 1.3 * px;
  ctx.strokeStyle = dead ? '#2a3244' : p.stroke;
  ctx.stroke();

  // Eyes look along the brain-controlled heading.
  const eyeR = r * 0.27;
  const pupilR = r * 0.14;
  for (const side of [-1, 1]) {
    const a = h + side * 0.5;
    const ex = b.x + Math.cos(a) * r * 0.45;
    const ey = b.y + Math.sin(a) * r * 0.45;
    if (dead) {
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

  // Job headgear / gear so each specialization is immediately readable.
  if (!dead) {
    drawJobTrait(ctx, b, r, h, px);
  }

  // Intent glyph above the head: sword when hostile with a rival in reach, hammer when building,
  // sparkle after a harvest.
  if (!dead && engine.phase === 'day') {
    const ix = b.x;
    const iy = b.y - r - 6;
    ctx.lineWidth = 1.3 * px;
    if (b.coop <= cfg.aggressionThreshold && (b.sensed.threat || tick - b.lastAttackTick < 30)) {
      ctx.strokeStyle = tick - b.lastAttackTick < 12 ? '#ffd2c8' : '#ff8a7a';
      ctx.beginPath();
      ctx.moveTo(ix - 3, iy + 3);
      ctx.lineTo(ix + 3, iy - 3);
      ctx.moveTo(ix - 2.6, iy - 0.6);
      ctx.lineTo(ix - 0.6, iy + 2.6);
      ctx.stroke();
    } else if (tick - b.lastBuildTick < 15) {
      ctx.strokeStyle = '#f5c451';
      ctx.beginPath();
      ctx.moveTo(ix - 2.5, iy + 3);
      ctx.lineTo(ix + 1.5, iy - 1);
      ctx.moveTo(ix - 0.5, iy - 3);
      ctx.lineTo(ix + 3.5, iy + 1);
      ctx.stroke();
    } else if (tick - b.lastGatherTick < 25) {
      ctx.fillStyle = b.cargo.type ? RESOURCE_COLORS[b.cargo.type] : '#e7edf6';
      ctx.beginPath();
      ctx.moveTo(ix, iy - 3);
      ctx.lineTo(ix + 1, iy - 1);
      ctx.lineTo(ix + 3, iy);
      ctx.lineTo(ix + 1, iy + 1);
      ctx.lineTo(ix, iy + 3);
      ctx.lineTo(ix - 1, iy + 1);
      ctx.lineTo(ix - 3, iy);
      ctx.lineTo(ix - 1, iy - 1);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawJobTrait(ctx: CanvasRenderingContext2D, b: Blob, r: number, h: number, px: number): void {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(h);
  if (b.job === 'soldier') {
    // Steel shield arc in front + crimson helm crest.
    ctx.strokeStyle = '#d6e0f0';
    ctx.lineWidth = Math.max(px * 1.4, r * 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.06, -0.75, 0.75);
    ctx.stroke();
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.roundRect(-r * 0.55, -r * 0.2, r * 0.9, r * 0.4, 1);
    ctx.fill();
  } else if (b.job === 'builder') {
    // Amber hard-hat on top.
    ctx.fillStyle = '#f5c451';
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(-r * 0.08, 0, r * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (b.job === 'lumberjack') {
    // Forest-green cap.
    ctx.fillStyle = '#4ca968';
    ctx.strokeStyle = '#14281d';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(-r * 0.12, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (b.job === 'miner') {
    // Slate-blue helmet with bright headlamp dot facing forward.
    ctx.fillStyle = '#6e9be6';
    ctx.strokeStyle = '#141c2b';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(-r * 0.08, 0, r * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(r * 0.26, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.job === 'carrier') {
    // Courier beret + tan satchel stripe.
    ctx.fillStyle = '#d4a373';
    ctx.strokeStyle = '#1b1612';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.arc(-r * 0.1, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(-r * 0.2, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else if (b.job === 'scout') {
    // Cyan hooded cloak + bright plume.
    ctx.fillStyle = '#5fe0e0';
    ctx.strokeStyle = '#0f282a';
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, 0);
    ctx.lineTo(-r * 0.45, -r * 0.45);
    ctx.lineTo(-r * 0.3, 0);
    ctx.lineTo(-r * 0.45, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // Forager: warm straw sun-hat rim with berry-red crown.
    ctx.strokeStyle = '#e6c37a';
    ctx.lineWidth = Math.max(px * 1.2, r * 0.2);
    ctx.beginPath();
    ctx.arc(-r * 0.12, 0, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ff7a6b';
    ctx.beginPath();
    ctx.arc(-r * 0.12, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWeather(
  ctx: CanvasRenderingContext2D,
  L: number,
  particles: Particle[],
  season: ReturnType<typeof seasonWeights>,
  time: number,
): void {
  if (season.winter > 0.02) {
    ctx.fillStyle = `rgba(240,246,255,${0.75 * season.winter})`;
    ctx.beginPath();
    for (const f of particles) {
      const y = (f.y + time * f.speed) % L;
      const x = (f.x + Math.sin(time * 0.8 + f.phase) * 10 + L) % L;
      ctx.moveTo(x + f.r, y);
      ctx.arc(x, y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  if (season.fall > 0.05) {
    ctx.fillStyle = `rgba(222,140,70,${0.55 * season.fall})`;
    for (let i = 0; i < particles.length; i += 4) {
      const f = particles[i];
      const y = (f.y + time * f.speed * 0.6) % L;
      const x = (f.x + Math.sin(time * 0.6 + f.phase) * 18 + L) % L;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time + f.phase);
      ctx.beginPath();
      ctx.ellipse(0, 0, f.r * 1.6, f.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawNight(ctx: CanvasRenderingContext2D, L: number, engine: SimulationEngine, night: number, dayFrac: number): void {
  const dusk = engine.phase === 'night' ? 0.25 + 0.3 * Math.sin(Math.PI * night) : 0.25 * smoothstep(0.88, 1, dayFrac);
  if (dusk <= 0.005) return;
  ctx.fillStyle = `rgba(6,9,20,${dusk})`;
  ctx.fillRect(0, 0, L, L);
  if (engine.phase !== 'night') return;
  // Campfires glow at each living Town Center.
  for (const t of engine.tribes) {
    if (t.extinct) continue;
    const { x, y } = t.basePosition;
    const g = ctx.createRadialGradient(x, y, 4, x, y, 70);
    g.addColorStop(0, `rgba(255,190,110,${0.35 * Math.sin(Math.PI * night)})`);
    g.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 70, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, b: Blob, engine: SimulationEngine, px: number): void {
  const p = tribePalette(engine.tribes[b.tribeId].color);

  ctx.beginPath();
  ctx.arc(b.x, b.y, b.genes.senseRadius, 0, Math.PI * 2);
  ctx.fillStyle = p.alpha(0.06);
  ctx.fill();
  ctx.setLineDash([6 * px, 5 * px]);
  ctx.lineWidth = 1.2 * px;
  ctx.strokeStyle = p.alpha(0.75);
  ctx.stroke();

  if (b.state === 'active') {
    // Lines to whatever the brain is currently perceiving.
    const perceive = (pt: { x: number; y: number } | null, color: string) => {
      if (!pt) return;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.stroke();
    };
    perceive(b.sensed.food, 'rgba(182,243,107,0.8)');
    perceive(b.sensed.timber, 'rgba(196,138,82,0.85)');
    perceive(b.sensed.stone, 'rgba(170,179,197,0.85)');
    perceive(b.sensed.ally, p.alpha(0.7));
    perceive(b.sensed.threat, 'rgba(255,110,100,0.9)');
    if (b.cargo.type) {
      const home = engine.tribes[b.tribeId].basePosition;
      ctx.setLineDash([2 * px, 4 * px]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(home.x, home.y);
      ctx.strokeStyle = 'rgba(231,237,246,0.35)';
      ctx.stroke();
    }

    // Steering vector: direction from the brain, length from throttle.
    ctx.setLineDash([]);
    const len = b.radius + 6 + b.throttle * 28;
    const tx = b.x + Math.cos(b.angle) * len;
    const ty = b.y + Math.sin(b.angle) * len;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(b.angle) * (b.radius + 3), b.y + Math.sin(b.angle) * (b.radius + 3));
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = 'rgba(231,237,246,0.8)';
    ctx.lineWidth = 1.6 * px;
    ctx.stroke();
    const head = 4;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - Math.cos(b.angle - 0.5) * head, ty - Math.sin(b.angle - 0.5) * head);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - Math.cos(b.angle + 0.5) * head, ty - Math.sin(b.angle + 0.5) * head);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(b.x, b.y, b.radius + 4, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(244,247,251,0.9)';
  ctx.lineWidth = 1.5 * px;
  ctx.stroke();
}
