import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import {
  ARENA_SIZE,
  CORP_INPUT_LABELS,
  CORP_OUTPUT_LABELS,
  FLOORS,
  GROUND_Y,
  SHAFT_W,
  SHAFT_X,
  TASK_SIZE,
  TOP_FLOOR,
  TRAIT_COLORS,
  TRAITS,
  describeSplit,
  dominantStyle,
  type CorporateEngine,
  type Departure,
  type Employee,
  type FloorLayout,
  type Rect,
} from '../engine/CorporateEngine';
import { BrainVisualizer, type BrainLabels } from './BrainVisualizer';
import { useAnimationFrame } from './useAnimationFrame';
import { useElementSize } from './useElementSize';

const L = ARENA_SIZE;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DRAG_THRESHOLD = 4;
const GOLD = '#f5c451';
/** Back-wall tint per floor, bullpen to penthouse. */
const WALL = [
  ['#1a2233', '#141b29'],
  ['#18263a', '#132030'],
  ['#1c2140', '#151a33'],
  ['#1b2a2c', '#142022'],
  ['#25203f', '#1b1731'],
  ['#2c2416', '#1d1810'],
];
const DEPARTURE_LABEL = { burnout: 'MEDICAL LEAVE', layoff: 'LAID OFF', pip: 'PIP\u2019D', retired: 'RETIRED' } as const;
const DEPARTURE_COLOR = { burnout: '#ff6b6b', layoff: '#c8a27a', pip: '#ff9b8a', retired: GOLD } as const;
const SPLIT_COLORS = [TRAIT_COLORS.execution, TRAIT_COLORS.charisma, TRAIT_COLORS.politics] as const;
const PIVOT = '#ff5fd2';

const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
const CORP_BRAIN_LABELS: BrainLabels = {
  inputs: CORP_INPUT_LABELS,
  outputs: CORP_OUTPUT_LABELS,
  format: (out) => [signed(out[0]), signed(out[1]), signed(out[2])],
};

interface View {
  zoom: number;
  cx: number;
  cy: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
}

interface Tower {
  x: number;
  w: number;
  h: number;
  lit: number[];
}

function makeBackdrop(): { stars: Star[]; towers: Tower[] } {
  let s = 424242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const stars = Array.from({ length: 90 }, () => ({ x: rnd() * L, y: rnd() * 420, r: 0.4 + rnd() * 1.1, phase: rnd() * Math.PI * 2 }));
  const towers: Tower[] = [];
  for (let x = -10; x < L; ) {
    const w = 30 + rnd() * 50;
    const h = 120 + rnd() * 320;
    towers.push({ x, w, h, lit: Array.from({ length: 14 }, () => rnd()) });
    x += w + 4 + rnd() * 10;
  }
  return { stars, towers };
}

interface CorporateArenaProps {
  engine: CorporateEngine;
  pinnedId: number | null;
  onPinnedChange: (id: number | null) => void;
}

export function CorporateArena({ engine, pinnedId, onPinnedChange }: CorporateArenaProps) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<EmployeeCardHandle>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hoverId = useRef<number | null>(null);
  const pinnedRef = useRef(pinnedId);
  const onPinnedRef = useRef(onPinnedChange);
  pinnedRef.current = pinnedId;
  onPinnedRef.current = onPinnedChange;
  const backdrop = useMemo(makeBackdrop, []);
  const side = Math.max(0, Math.floor(Math.min(size.width, size.height)));
  const pinned = pinnedId === null ? null : (engine.getEmployee(pinnedId) ?? null);

  const view = useRef<View>({ zoom: 1, cx: L / 2, cy: L / 2 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);

  const clampView = useCallback(
    (v: View) => {
      const half = L / (2 * v.zoom);
      v.cx = Math.min(L - half, Math.max(half, v.cx));
      v.cy = Math.min(L - half, Math.max(half, v.cy));
    },
    [],
  );
  const zoomAt = useCallback(
    (factor: number, sx = side / 2, sy = side / 2) => {
      const v = view.current;
      const before = (side / L) * v.zoom;
      const wx = v.cx + (sx - side / 2) / before;
      const wy = v.cy + (sy - side / 2) / before;
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const after = (side / L) * v.zoom;
      v.cx = wx - (sx - side / 2) / after;
      v.cy = wy - (sy - side / 2) / after;
      clampView(v);
      setZoomLabel(v.zoom);
    },
    [side, clampView],
  );

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
    if (pinnedRef.current !== null && !engine.getEmployee(pinnedRef.current)) {
      pinnedRef.current = null;
      onPinnedRef.current(null);
    }
    const v = view.current;
    clampView(v);
    const dpr = canvas.width / side;
    const scale = (side / L) * v.zoom;
    const px = 1 / scale;
    const time = now / 1000;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (side / 2 - v.cx * scale), dpr * (side / 2 - v.cy * scale));

    drawSky(ctx, backdrop, time);
    drawStreet(ctx, px);
    drawShafts(ctx, time, px);
    drawRoof(ctx, time, px);
    for (const f of FLOORS) drawFloor(ctx, f, engine, time, px);
    for (const d of engine.departures) drawDeparture(ctx, d, engine.tick, px);

    hoverId.current = null;
    if (pointer.current && !drag.current?.moved) {
      const wx = v.cx + (pointer.current.x - side / 2) / scale;
      const wy = v.cy + (pointer.current.y - side / 2) / scale;
      let best = Infinity;
      for (const e of engine.employees) {
        const d = Math.hypot(e.x - wx, e.y - wy);
        if (d < e.radius + 5 * px && d < best) {
          best = d;
          hoverId.current = e.id;
        }
      }
    }
    canvas.style.cursor = drag.current?.moved ? 'grabbing' : hoverId.current !== null ? 'pointer' : v.zoom > 1 ? 'grab' : 'default';

    const selectedId = pinnedRef.current ?? hoverId.current;
    let selected: Employee | null = null;
    for (const e of engine.employees) {
      if (e.id === selectedId) selected = e;
      else drawEmployee(ctx, e, engine, time, px, false);
    }
    if (selected) drawEmployee(ctx, selected, engine, time, px, true);
    for (const e of engine.employees) if (e.bubble) drawBubble(ctx, e, e.bubble.text, px);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawReviewBanner(ctx, engine, side);
    drawPivotBanner(ctx, engine, side);

    if (selected) {
      const sx = (selected.x - v.cx) * scale + side / 2;
      const sy = (selected.y - v.cy) * scale + side / 2;
      cardRef.current?.update(selected, engine, sx, sy, selected.radius * scale + 14, side, side);
    } else {
      cardRef.current?.update(null, engine, 0, 0, 0, side, side);
    }
  });

  const toLocal = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: side, height: side }}>
        <canvas
          ref={canvasRef}
          style={{ width: side, height: side, touchAction: 'none' }}
          className="block rounded-xl"
          onPointerDown={(e) => {
            const p = toLocal(e);
            drag.current = { x: p.x, y: p.y, cx: view.current.cx, cy: view.current.cy, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const p = toLocal(e);
            pointer.current = p;
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > DRAG_THRESHOLD) d.moved = true;
            if (d.moved) {
              const scale = (side / L) * view.current.zoom;
              view.current.cx = d.cx - (p.x - d.x) / scale;
              view.current.cy = d.cy - (p.y - d.y) / scale;
              clampView(view.current);
            }
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d && !d.moved) onPinnedRef.current(hoverId.current === pinnedRef.current ? null : hoverId.current);
          }}
          onPointerLeave={() => {
            pointer.current = null;
          }}
        />
        <EmployeeCard ref={cardRef} pinned={pinned} />
        {zoomLabel > 1.01 && (
          <button
            type="button"
            onClick={() => {
              Object.assign(view.current, { zoom: 1, cx: L / 2, cy: L / 2 });
              setZoomLabel(1);
            }}
            className="absolute right-2 bottom-2 rounded-full border border-ink-700/80 bg-ink-900/80 px-2.5 py-1 font-mono text-[10.5px] text-ink-300 backdrop-blur hover:text-ink-200"
          >
            {zoomLabel.toFixed(1)}× · fit
          </button>
        )}
      </div>
    </div>
  );
}

function drawSky(ctx: CanvasRenderingContext2D, backdrop: ReturnType<typeof makeBackdrop>, time: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, '#070b18');
  g.addColorStop(0.55, '#0e1428');
  g.addColorStop(1, '#1b1730');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L, L);
  for (const s of backdrop.stars) {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 1.3 + s.phase);
    ctx.fillStyle = '#dfe8ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const t of backdrop.towers) {
    const top = GROUND_Y - t.h;
    ctx.fillStyle = '#0c1120';
    ctx.fillRect(t.x, top, t.w, t.h);
    ctx.fillStyle = 'rgba(255, 214, 140, 0.16)';
    for (let i = 0; i < t.lit.length; i++) {
      if (t.lit[i] < 0.55) continue;
      const wx = t.x + 5 + (i % 3) * ((t.w - 10) / 3);
      const wy = top + 10 + Math.floor(i / 3) * 22;
      if (wy < GROUND_Y - 8) ctx.fillRect(wx, wy, 4, 6);
    }
  }
}

function drawStreet(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.fillStyle = '#0d111b';
  ctx.fillRect(0, GROUND_Y, L, L - GROUND_Y);
  ctx.strokeStyle = 'rgba(245,196,81,0.25)';
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y + 12);
  ctx.lineTo(L, GROUND_Y + 12);
  ctx.stroke();
  ctx.setLineDash([]);
  // Lobby revolving doors at the foot of each elevator.
  for (const x of SHAFT_X) {
    ctx.fillStyle = 'rgba(120, 220, 255, 0.18)';
    ctx.fillRect(x - SHAFT_W / 2, GROUND_Y - 2, SHAFT_W, 18);
  }
}

function drawShafts(ctx: CanvasRenderingContext2D, time: number, px: number): void {
  const top = FLOORS[TOP_FLOOR].rect.y - 8;
  for (const x of SHAFT_X) {
    const x0 = x - SHAFT_W / 2;
    const g = ctx.createLinearGradient(x0, 0, x0 + SHAFT_W, 0);
    g.addColorStop(0, 'rgba(60, 200, 255, 0.10)');
    g.addColorStop(0.5, 'rgba(20, 40, 70, 0.55)');
    g.addColorStop(1, 'rgba(60, 200, 255, 0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, top, SHAFT_W, GROUND_Y - top);
    const pulse = 0.45 + 0.25 * Math.sin(time * 2 + x);
    ctx.save();
    ctx.shadowColor = '#4fe3f0';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = `rgba(79, 227, 240, ${pulse})`;
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x0, GROUND_Y);
    ctx.moveTo(x0 + SHAFT_W, top);
    ctx.lineTo(x0 + SHAFT_W, GROUND_Y);
    ctx.stroke();
    ctx.restore();
    // Counterweight cables.
    ctx.strokeStyle = 'rgba(167,177,198,0.12)';
    ctx.lineWidth = 0.6 * px;
    ctx.beginPath();
    ctx.moveTo(x - 4, top);
    ctx.lineTo(x - 4, GROUND_Y);
    ctx.moveTo(x + 4, top);
    ctx.lineTo(x + 4, GROUND_Y);
    ctx.stroke();
  }
  // Glass sky-bridges from each shaft to its floor.
  for (const f of FLOORS) {
    const y = f.rect.y + f.rect.h;
    for (const side of [0, 1] as const) {
      const sx = side === 0 ? SHAFT_X[0] + SHAFT_W / 2 : SHAFT_X[1] - SHAFT_W / 2;
      const fx = side === 0 ? f.rect.x - 4 : f.rect.x + f.rect.w + 4;
      const x0 = Math.min(sx, fx);
      const w = Math.abs(fx - sx);
      ctx.fillStyle = 'rgba(79, 227, 240, 0.07)';
      ctx.fillRect(x0, f.aisleY - 12, w, y - f.aisleY + 12);
      ctx.fillStyle = '#3a4357';
      ctx.fillRect(x0, y, w, 3);
      ctx.fillStyle = 'rgba(79,227,240,0.8)';
      ctx.beginPath();
      ctx.arc(side === 0 ? SHAFT_X[0] : SHAFT_X[1], f.aisleY - 14, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRoof(ctx: CanvasRenderingContext2D, time: number, px: number): void {
  const f = FLOORS[TOP_FLOOR];
  const cx = L / 2;
  const roofY = f.rect.y - 6;
  ctx.fillStyle = '#2a2f3d';
  ctx.fillRect(f.rect.x - 8, roofY, f.rect.w + 16, 6);
  ctx.fillStyle = GOLD;
  ctx.fillRect(f.rect.x - 8, roofY, f.rect.w + 16, 1.2);
  // Antenna with a blinking beacon.
  ctx.strokeStyle = '#7d89a3';
  ctx.lineWidth = 1.2 * px;
  ctx.beginPath();
  ctx.moveTo(cx + 90, roofY);
  ctx.lineTo(cx + 90, roofY - 34);
  ctx.stroke();
  if (Math.sin(time * 3) > 0) {
    ctx.fillStyle = '#ff4d4d';
    ctx.shadowColor = '#ff4d4d';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx + 90, roofY - 35, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  // Rooftop logo sign.
  ctx.save();
  ctx.shadowColor = GOLD;
  ctx.shadowBlur = 12;
  ctx.fillStyle = GOLD;
  ctx.font = '700 15px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('BLOBCORP', cx - 10, roofY - 10);
  ctx.restore();
  ctx.strokeStyle = 'rgba(245,196,81,0.5)';
  ctx.lineWidth = px;
  ctx.beginPath();
  ctx.moveTo(cx - 60, roofY - 6);
  ctx.lineTo(cx - 60, roofY);
  ctx.moveTo(cx + 40, roofY - 6);
  ctx.lineTo(cx + 40, roofY);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function zoneLabel(ctx: CanvasRenderingContext2D, text: string, z: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.font = '600 6.5px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(text, z.x + z.w / 2, z.y + 2);
}

function drawFloor(ctx: CanvasRenderingContext2D, f: FloorLayout, engine: CorporateEngine, time: number, px: number): void {
  const { rect } = f;
  const occupied = engine.floorOccupancy(f.index);
  const [wallTop, wallBottom] = WALL[f.index];
  const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  g.addColorStop(0, wallTop);
  g.addColorStop(1, wallBottom);
  ctx.fillStyle = g;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // Ceiling light strips.
  ctx.fillStyle = f.index === TOP_FLOOR ? 'rgba(245,196,81,0.55)' : 'rgba(210,230,255,0.45)';
  for (let x = rect.x + 30; x < rect.x + rect.w - 30; x += 60) ctx.fillRect(x, rect.y + 2, 26, 1.6);
  const glow = ctx.createLinearGradient(0, rect.y, 0, rect.y + 26);
  glow.addColorStop(0, f.index === TOP_FLOOR ? 'rgba(245,196,81,0.10)' : 'rgba(210,230,255,0.07)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(rect.x, rect.y, rect.w, 26);

  // Walls and slab.
  ctx.fillStyle = '#3a4357';
  ctx.fillRect(rect.x - 6, rect.y + rect.h, rect.w + 12, 6);
  ctx.fillStyle = f.index === TOP_FLOOR ? GOLD : '#4a5570';
  ctx.fillRect(rect.x - 4, rect.y, 2.5, rect.h);
  ctx.fillRect(rect.x + rect.w + 1.5, rect.y, 2.5, rect.h);

  drawBreakroom(ctx, f, time, px);
  drawMixer(ctx, f, px);
  for (let i = 0; i < f.cells.length; i++) drawWorkstation(ctx, f, f.cells[i], px);

  ctx.font = '700 7px ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = f.index === TOP_FLOOR ? GOLD : 'rgba(200,210,230,0.75)';
  const title = `F${f.index + 1} \u00b7 ${f.title.toUpperCase()}`;
  ctx.fillText(title, rect.x + 4, rect.y + 6);
  if (f.index < TOP_FLOOR) drawLadderBadge(ctx, engine, f, rect.x + 10 + ctx.measureText(title).width, rect.y + 4.5, px);
  ctx.textAlign = 'right';
  ctx.fillStyle = occupied < f.capacity ? '#ffb347' : 'rgba(200,210,230,0.55)';
  ctx.fillText(`${occupied}/${f.capacity}`, rect.x + rect.w - 4, rect.y + 6);
}

/** Floor Ladder HUD: what it takes to get promoted off this floor under the current culture. */
function drawLadderBadge(ctx: CanvasRenderingContext2D, engine: CorporateEngine, f: FloorLayout, x: number, y: number, px: number): void {
  const w = engine.promotionWeights(f.index);
  const label = `\u25b2 ${describeSplit(w)}`;
  ctx.font = '600 6px ui-sans-serif, system-ui';
  const barW = 28;
  const h = 10;
  const bw = barW + ctx.measureText(label).width + 12;
  ctx.fillStyle = 'rgba(8, 12, 22, 0.75)';
  ctx.strokeStyle = 'rgba(200,210,230,0.22)';
  ctx.lineWidth = 0.6 * px;
  roundRect(ctx, x, y, bw, h, h / 2);
  ctx.fill();
  ctx.stroke();
  let bx = x + 4;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = SPLIT_COLORS[i];
    ctx.fillRect(bx, y + 3.5, barW * w[i], 3);
    bx += barW * w[i];
  }
  ctx.fillStyle = w[0] >= 0.75 ? 'rgba(79,227,240,0.9)' : w[0] >= 0.4 ? 'rgba(220,225,240,0.85)' : 'rgba(255,179,71,0.95)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + barW + 8, y + h / 2 + 0.3);
  ctx.textBaseline = 'top';
}

function drawBreakroom(ctx: CanvasRenderingContext2D, f: FloorLayout, time: number, px: number): void {
  const z = f.breakroom;
  ctx.fillStyle = 'rgba(255, 179, 71, 0.07)';
  roundRect(ctx, z.x, z.y, z.w, z.h, 3);
  ctx.fill();
  zoneLabel(ctx, f.index >= 3 ? 'Espresso Bar' : 'Breakroom', z, 'rgba(255,179,71,0.8)');
  // Counter along the back with an espresso machine.
  const cy = z.y + 12;
  ctx.fillStyle = '#5b4632';
  ctx.fillRect(z.x + 4, cy, z.w - 8, 4);
  const mx = z.x + 8;
  ctx.fillStyle = '#9aa3b5';
  ctx.fillRect(mx, cy - 7, 8, 7);
  ctx.fillStyle = '#ff4d4d';
  ctx.fillRect(mx + 1.5, cy - 5.5, 1.5, 1.5);
  ctx.strokeStyle = 'rgba(230,235,245,0.35)';
  ctx.lineWidth = 0.6 * px;
  ctx.beginPath();
  const wobble = Math.sin(time * 4) * 1.2;
  ctx.moveTo(mx + 4, cy - 8);
  ctx.quadraticCurveTo(mx + 4 + wobble, cy - 11, mx + 4, cy - 14);
  ctx.stroke();
  // Bistro tables.
  ctx.fillStyle = 'rgba(255,179,71,0.22)';
  const rows = Math.max(1, Math.floor((z.h - 22) / 26));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.beginPath();
      ctx.arc(z.x + z.w * (0.3 + c * 0.4), z.y + 30 + r * 26, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMixer(ctx: CanvasRenderingContext2D, f: FloorLayout, px: number): void {
  const z = f.mixer;
  ctx.fillStyle = 'rgba(255, 95, 210, 0.06)';
  roundRect(ctx, z.x, z.y, z.w, z.h, 3);
  ctx.fill();
  zoneLabel(ctx, f.mixerName, z, 'rgba(255,95,210,0.8)');
  if (f.index === TOP_FLOOR) {
    // Boardroom table.
    ctx.fillStyle = '#4a3a22';
    roundRect(ctx, z.x + 6, z.y + z.h / 2 - 5, z.w - 12, 10, 5);
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 0.6 * px;
    ctx.stroke();
    return;
  }
  if (f.index <= 1) {
    // Watercooler.
    const wx = z.x + z.w - 12;
    ctx.fillStyle = '#c8d0df';
    ctx.fillRect(wx - 3, z.y + 18, 6, 10);
    ctx.fillStyle = 'rgba(106,168,255,0.85)';
    roundRect(ctx, wx - 3.5, z.y + 11, 7, 8, 2.5);
    ctx.fill();
  } else {
    // Bar cart.
    ctx.fillStyle = '#5a4060';
    ctx.fillRect(z.x + z.w - 18, z.y + 14, 12, 4);
    ctx.fillStyle = GOLD;
    for (let i = 0; i < 3; i++) ctx.fillRect(z.x + z.w - 17 + i * 4, z.y + 10, 1.5, 4);
  }
  ctx.fillStyle = 'rgba(255,95,210,0.22)';
  const rows = Math.max(1, Math.floor((z.h - 22) / 28));
  for (let r = 0; r < rows; r++) {
    ctx.beginPath();
    ctx.arc(z.x + z.w * 0.4, z.y + 32 + r * 28, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWorkstation(ctx: CanvasRenderingContext2D, f: FloorLayout, c: Rect, px: number): void {
  const cx = c.x + c.w / 2;
  switch (f.index) {
    case 0: {
      // Dense bullpen desk with one monitor.
      const dw = c.w * 0.72;
      const dy = c.y + c.h * 0.38;
      ctx.fillStyle = '#3b4560';
      ctx.fillRect(cx - dw / 2, dy, dw, 4);
      ctx.fillStyle = 'rgba(79,227,240,0.55)';
      ctx.fillRect(cx - 4, dy - 6, 8, 5);
      break;
    }
    case 1: {
      const dw = c.w * 0.74;
      const dy = c.y + c.h * 0.4;
      ctx.fillStyle = '#3f4b68';
      ctx.fillRect(cx - dw / 2, dy, dw, 5);
      ctx.fillStyle = 'rgba(79,227,240,0.6)';
      ctx.fillRect(cx - 10, dy - 7, 9, 6);
      ctx.fillRect(cx + 1, dy - 7, 9, 6);
      ctx.fillStyle = '#4caf6a';
      ctx.beginPath();
      ctx.arc(cx + dw / 2 - 3, dy - 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 2: {
      // Glass-walled office.
      ctx.fillStyle = 'rgba(140, 220, 255, 0.05)';
      ctx.fillRect(c.x + 2, c.y + 1, c.w - 4, c.h - 3);
      ctx.strokeStyle = 'rgba(140, 220, 255, 0.45)';
      ctx.lineWidth = 0.8 * px;
      ctx.strokeRect(c.x + 2, c.y + 1, c.w - 4, c.h - 3);
      const dy = c.y + c.h * 0.38;
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(cx - c.w * 0.3, dy, c.w * 0.6, 5);
      ctx.fillStyle = 'rgba(79,227,240,0.6)';
      ctx.fillRect(cx - 5, dy - 6, 10, 5);
      break;
    }
    case 3: {
      // Director's office: frosted glass, dual monitors, a plant for gravitas.
      ctx.fillStyle = 'rgba(139, 227, 176, 0.05)';
      ctx.fillRect(c.x + 2, c.y + 1, c.w - 4, c.h - 3);
      ctx.strokeStyle = 'rgba(139, 227, 176, 0.45)';
      ctx.lineWidth = 0.8 * px;
      ctx.strokeRect(c.x + 2, c.y + 1, c.w - 4, c.h - 3);
      const dy = c.y + c.h * 0.36;
      ctx.fillStyle = '#5e4630';
      ctx.fillRect(cx - c.w * 0.32, dy, c.w * 0.64, 5);
      ctx.fillStyle = 'rgba(79,227,240,0.6)';
      ctx.fillRect(cx - 9, dy - 6, 8, 5);
      ctx.fillRect(cx + 1, dy - 6, 8, 5);
      ctx.fillStyle = '#4caf6a';
      ctx.beginPath();
      ctx.arc(c.x + c.w - 8, c.y + 8, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 4: {
      // Executive suite with rug and plant.
      ctx.fillStyle = 'rgba(201,155,255,0.06)';
      ctx.fillRect(c.x + 3, c.y + 1, c.w - 6, c.h - 3);
      ctx.strokeStyle = 'rgba(201,155,255,0.5)';
      ctx.lineWidth = 0.9 * px;
      ctx.strokeRect(c.x + 3, c.y + 1, c.w - 6, c.h - 3);
      ctx.fillStyle = 'rgba(160, 60, 70, 0.25)';
      ctx.beginPath();
      ctx.ellipse(cx, c.y + c.h * 0.7, c.w * 0.32, c.h * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      const dy = c.y + c.h * 0.36;
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(cx - c.w * 0.32, dy, c.w * 0.64, 6);
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx - c.w * 0.32, dy, c.w * 0.64, 0.8);
      ctx.fillStyle = '#4caf6a';
      ctx.beginPath();
      ctx.arc(c.x + c.w - 9, c.y + 9, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // Corner office: floor-to-ceiling window, gold trim, big desk.
      const outer = c.x < L / 2 ? c.x : c.x + c.w;
      ctx.fillStyle = 'rgba(140, 200, 255, 0.10)';
      ctx.fillRect(c.x < L / 2 ? outer : outer - 6, c.y, 6, c.h);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.4 * px;
      ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
      ctx.fillStyle = 'rgba(245,196,81,0.06)';
      ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
      const dy = c.y + c.h * 0.32;
      ctx.fillStyle = '#7a5532';
      roundRect(ctx, cx - c.w * 0.34, dy, c.w * 0.68, 8, 2);
      ctx.fill();
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx - c.w * 0.34, dy, c.w * 0.68, 1);
    }
  }
}

function drawEmployee(ctx: CanvasRenderingContext2D, e: Employee, engine: CorporateEngine, time: number, px: number, selected: boolean): void {
  const color = TRAIT_COLORS[dominantStyle(e.traits)];
  const walking = e.path.length > 0;
  const riding = e.locFloor === -1 && (Math.abs(e.x - SHAFT_X[0]) < 2 || Math.abs(e.x - SHAFT_X[1]) < 2);
  const r = e.radius;
  const x = e.x;
  const y = e.y - (walking && !riding ? Math.abs(Math.sin(time * 11 + e.id)) * 1.2 : 0);

  if (riding) {
    ctx.fillStyle = 'rgba(30, 50, 80, 0.85)';
    ctx.strokeStyle = 'rgba(79,227,240,0.85)';
    ctx.lineWidth = 0.9 * px;
    roundRect(ctx, x - SHAFT_W / 2 + 3, y - r - 5, SHAFT_W - 6, r * 2 + 9, 2);
    ctx.fill();
    ctx.stroke();
  }

  // Aura in the dominant career colour.
  const aura = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
  aura.addColorStop(0, `${color}55`);
  aura.addColorStop(1, `${color}00`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
  ctx.fill();

  if (e.burnout > 80) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 8 + e.id);
    ctx.strokeStyle = `rgba(255, 70, 70, ${0.35 + 0.45 * pulse})`;
    ctx.lineWidth = 1.4 * px;
    ctx.beginPath();
    ctx.arc(x, y, r + 2 + pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Body.
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.25, color);
  body.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(10,14,24,0.6)';
  ctx.lineWidth = 0.7 * px;
  ctx.stroke();

  drawAccessory(ctx, e, engine, x, y, r, px);

  // Eyes look where they're going; sleepy when out of energy.
  const look = e.facing * r * 0.12;
  const eyeY = y - r * 0.22;
  const tired = e.energy < 25;
  for (const dx of [-0.32, 0.32]) {
    const ex = x + dx * r + look;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (tired) ctx.ellipse(ex, eyeY, r * 0.17, r * 0.07, 0, 0, Math.PI * 2);
    else ctx.arc(ex, eyeY, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    if (!tired) {
      ctx.fillStyle = '#111723';
      ctx.beginPath();
      ctx.arc(ex + e.facing * r * 0.05, eyeY, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (e.burnout > 80) drawSteam(ctx, e, x, y, r, time);
  if (e.activity === 'break' && walking) drawCoffee(ctx, x + r * 0.9, y - r - 7, time, px);
  const sincePromo = engine.tick - e.promotedAt;
  if (sincePromo >= 0 && sincePromo < 260) {
    const a = 1 - sincePromo / 260;
    ctx.fillStyle = `rgba(139, 227, 176, ${a})`;
    ctx.beginPath();
    const ay = y - r - 6 - (1 - a) * 6;
    ctx.moveTo(x - r * 0.9 - 4, ay + 2);
    ctx.lineTo(x - r * 0.9, ay - 4);
    ctx.lineTo(x - r * 0.9 + 4, ay + 2);
    ctx.closePath();
    ctx.fill();
  }
  const sinceDemotion = engine.tick - e.demotedAt;
  if (sinceDemotion >= 0 && sinceDemotion < 260) {
    const a = 1 - sinceDemotion / 260;
    ctx.fillStyle = `rgba(255, 140, 90, ${a})`;
    ctx.beginPath();
    const ay = y - r - 8 + (1 - a) * 6;
    ctx.moveTo(x - r * 0.9 - 4, ay - 2);
    ctx.lineTo(x - r * 0.9, ay + 4);
    ctx.lineTo(x - r * 0.9 + 4, ay - 2);
    ctx.closePath();
    ctx.fill();
  }
  if (e.task === 'launch' && e.activity === 'work' && !walking) {
    // Greenfield launch in progress; the star fills in as the task nears completion.
    ctx.fillStyle = 'rgba(245,196,81,0.3)';
    drawStar(ctx, x + r * 0.95, y - r * 0.95, 3);
    const done = Math.min(1, e.taskProgress / TASK_SIZE);
    ctx.fillStyle = `rgba(245,196,81,${0.4 + 0.6 * done})`;
    drawStar(ctx, x + r * 0.95, y - r * 0.95, 1.2 + 1.8 * done);
  }

  if (selected) {
    ctx.strokeStyle = '#e7edf6';
    ctx.lineWidth = 1.4 * px;
    ctx.setLineDash([3 * px, 2.5 * px]);
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawAccessory(ctx: CanvasRenderingContext2D, e: Employee, engine: CorporateEngine, x: number, y: number, r: number, px: number): void {
  ctx.lineWidth = Math.max(0.6 * px, r * 0.09);
  switch (e.floor) {
    case 0: {
      // Lanyard: green for interns in their first two quarters, blue for juniors.
      const lanyard = engine.quarter - e.hiredQuarter < 2 ? '#7cfc9a' : '#6aa8ff';
      ctx.strokeStyle = lanyard;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.55, y + r * 0.05);
      ctx.lineTo(x, y + r * 0.55);
      ctx.lineTo(x + r * 0.55, y + r * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#f2f5fa';
      ctx.fillRect(x - r * 0.18, y + r * 0.5, r * 0.36, r * 0.36);
      ctx.fillStyle = lanyard;
      ctx.fillRect(x - r * 0.18, y + r * 0.5, r * 0.36, r * 0.1);
      break;
    }
    case 1: {
      // Headphones for the heads-down seniors.
      ctx.strokeStyle = '#2a2f3d';
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.95, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.fillStyle = '#2a2f3d';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + s * r * 0.88, y - r * 0.1, r * 0.18, r * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 2:
      drawTie(ctx, x, y, r, '#c0392b');
      break;
    case 3:
      // Directors: blazer over a navy tie.
      drawTie(ctx, x, y, r, '#2f5fae');
      drawLapels(ctx, x, y, r);
      break;
    default: {
      // VPs add a gold pin to the blazer; the C-Suite also wears a crown.
      drawLapels(ctx, x, y, r);
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.arc(x - r * 0.42, y + r * 0.5, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      if (e.floor === TOP_FLOOR) {
        const cy = y - r * 0.82;
        ctx.fillStyle = GOLD;
        ctx.strokeStyle = '#8a6a1c';
        ctx.lineWidth = 0.5 * px;
        ctx.beginPath();
        ctx.moveTo(x - r * 0.55, cy);
        ctx.lineTo(x - r * 0.6, cy - r * 0.55);
        ctx.lineTo(x - r * 0.3, cy - r * 0.25);
        ctx.lineTo(x, cy - r * 0.65);
        ctx.lineTo(x + r * 0.3, cy - r * 0.25);
        ctx.lineTo(x + r * 0.6, cy - r * 0.55);
        ctx.lineTo(x + r * 0.55, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function drawTie(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = '#f2f5fa';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.35, y + r * 0.2);
  ctx.lineTo(x, y + r * 0.38);
  ctx.lineTo(x + r * 0.35, y + r * 0.2);
  ctx.lineTo(x, y + r * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.36);
  ctx.lineTo(x - r * 0.13, y + r * 0.62);
  ctx.lineTo(x, y + r * 0.95);
  ctx.lineTo(x + r * 0.13, y + r * 0.62);
  ctx.closePath();
  ctx.fill();
}

function drawLapels(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = 'rgba(20, 22, 34, 0.85)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * r * 0.15, y + r * 0.98);
    ctx.lineTo(x + s * r * 0.75, y + r * 0.62);
    ctx.lineTo(x + s * r * 0.3, y + r * 0.2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? size : size * 0.45;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function drawSteam(ctx: CanvasRenderingContext2D, e: Employee, x: number, y: number, r: number, time: number): void {
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.9 + i / 3 + e.id * 0.13) % 1;
    const px = x + (i - 1) * r * 0.45 + Math.sin(t * 6 + i) * 1.5;
    const py = y - r - t * 12;
    ctx.fillStyle = `rgba(255, ${90 + 60 * t}, ${80 + 60 * t}, ${0.65 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(px, py, 1.2 + t * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCoffee(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, px: number): void {
  const bob = Math.sin(time * 4) * 0.8;
  const cy = y + bob;
  ctx.fillStyle = '#f2f5fa';
  ctx.beginPath();
  ctx.moveTo(x - 3, cy - 3);
  ctx.lineTo(x + 3, cy - 3);
  ctx.lineTo(x + 2.2, cy + 3);
  ctx.lineTo(x - 2.2, cy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7a4a2a';
  ctx.fillRect(x - 3, cy - 3, 6, 1.4);
  ctx.strokeStyle = '#f2f5fa';
  ctx.lineWidth = 0.8 * px;
  ctx.beginPath();
  ctx.arc(x + 3.2, cy, 1.4, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(230,235,245,0.5)';
  ctx.beginPath();
  ctx.moveTo(x, cy - 4);
  ctx.quadraticCurveTo(x + 1.5, cy - 6, x, cy - 8);
  ctx.stroke();
}

function drawBubble(ctx: CanvasRenderingContext2D, e: Employee, text: string, px: number): void {
  const fs = Math.max(5.5, 9.5 * px);
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui`;
  const w = ctx.measureText(text).width + fs;
  const h = fs * 1.6;
  const bx = Math.min(L - w - 2, Math.max(2, e.x - w / 2));
  const by = e.y - e.radius - h - 6;
  const steal = text.startsWith('Per my') || text.startsWith('As I') || text.startsWith('My ') || text.startsWith('Building');
  ctx.fillStyle = steal ? 'rgba(255, 220, 170, 0.96)' : 'rgba(242, 245, 250, 0.96)';
  ctx.strokeStyle = steal ? '#ffb347' : 'rgba(10,14,24,0.4)';
  ctx.lineWidth = 0.8 * px;
  roundRect(ctx, bx, by, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(e.x - 2, by + h - 0.5);
  ctx.lineTo(e.x, by + h + 4);
  ctx.lineTo(e.x + 2.5, by + h - 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#111723';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 0.3);
}

function drawDeparture(ctx: CanvasRenderingContext2D, d: Departure, tick: number, px: number): void {
  const t = (tick - d.tick) / 150;
  if (t >= 1) return;
  const a = 1 - t;
  const y = d.y - t * 26;
  ctx.globalAlpha = a * 0.8;
  ctx.fillStyle = d.color;
  ctx.beginPath();
  ctx.arc(d.x, y, d.radius * (1 - t * 0.4), 0, Math.PI * 2);
  ctx.fill();
  if (d.cause === 'layoff') {
    // Cardboard box of desk belongings.
    ctx.fillStyle = '#c8a27a';
    ctx.fillRect(d.x - 4, y + d.radius * 0.2, 8, 6);
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(d.x - 4, y + d.radius * 0.2, 8, 1.2);
  }
  ctx.globalAlpha = a;
  const fs = Math.max(5, 8 * px);
  ctx.font = `700 ${fs}px ui-sans-serif, system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = DEPARTURE_COLOR[d.cause];
  ctx.fillText(DEPARTURE_LABEL[d.cause], d.x, y - d.radius - 2);
  ctx.globalAlpha = 1;
}

function drawReviewBanner(ctx: CanvasRenderingContext2D, engine: CorporateEngine, side: number): void {
  const age = engine.tick - engine.lastReviewTick;
  if (age < 0 || age > 200) return;
  const last = engine.history[engine.history.length - 1];
  if (!last) return;
  const done = last.quarter - 1;
  const title = `Q${(done % 4) + 1} FY${Math.floor(done / 4) + 1} Performance Review`;
  const parts = [
    `${last.promotions} promoted`,
    last.demotions ? `${last.demotions} demoted` : null,
    `${last.pips} PIP\u2019d`,
    `${last.layoffs} laid off`,
    last.retirements ? `${last.retirements} retired` : null,
    `${last.hires} hired`,
  ];
  drawBanner(ctx, side, side * 0.42, age, title, parts.filter(Boolean).join(' \u00b7 '), GOLD);
}

function drawPivotBanner(ctx: CanvasRenderingContext2D, engine: CorporateEngine, side: number): void {
  const age = engine.tick - engine.lastPivotTick;
  if (age < 0 || age > 200) return;
  let detail = '';
  for (let i = engine.events.length - 1; i >= 0; i--) {
    if (engine.events[i].kind === 'pivot') {
      detail = engine.events[i].text.replace(/^Product pivot! /, '');
      break;
    }
  }
  drawBanner(ctx, side, side * 0.3, age, '\u21bb Product Pivot', detail, PIVOT);
}

function drawBanner(ctx: CanvasRenderingContext2D, side: number, y: number, age: number, title: string, detail: string, color: string): void {
  ctx.globalAlpha = Math.min(1, age / 15) * Math.min(1, (200 - age) / 40);
  ctx.font = '500 11px ui-sans-serif, system-ui';
  const detailW = ctx.measureText(detail).width;
  ctx.font = '700 14px ui-sans-serif, system-ui';
  const w = Math.min(side - 16, Math.max(ctx.measureText(title).width, detailW, 220) + 40);
  const x = side / 2 - w / 2;
  ctx.fillStyle = 'rgba(12, 16, 28, 0.88)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, 46, 10);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = color;
  ctx.fillText(title, side / 2, y + 8);
  ctx.font = '500 11px ui-sans-serif, system-ui';
  ctx.fillStyle = '#c8d0df';
  ctx.fillText(detail, side / 2, y + 27, w - 20);
  ctx.globalAlpha = 1;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, c + c * amount)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const CARD_FIELDS = ['name', 'status', 'floor', 'next', 'kpi', 'vis', 'pol', 'task', 'oversight', 'career', 'tenure', 'generation', 'ally'] as const;
type CardField = (typeof CARD_FIELDS)[number];
const ACTIVITY_LABEL = { work: 'At desk', break: 'On break', network: 'Networking' } as const;
const TASK_LABEL = { standard: 'Feature work', launch: 'Greenfield launch', maintenance: 'Maintenance' } as const;

interface EmployeeCardHandle {
  update(e: Employee | null, engine: CorporateEngine, sx: number, sy: number, offset: number, width: number, height: number): void;
}

function EmployeeCard({ pinned, ref }: { pinned: Employee | null; ref: Ref<EmployeeCardHandle> }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const fields = useRef<Partial<Record<CardField, HTMLElement | null>>>({});
  const bars = useRef<Record<string, HTMLDivElement | null>>({});

  useImperativeHandle(ref, () => ({
    update(e, engine, sx, sy, offset, width, height) {
      const card = cardRef.current;
      if (!card) return;
      if (!e) {
        card.style.opacity = '0';
        return;
      }
      const set = (k: CardField, v: string) => {
        const el = fields.current[k];
        if (el && el.textContent !== v) el.textContent = v;
      };
      const bar = (k: string, v: number) => {
        const el = bars.current[k];
        if (el) el.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
      };
      const ally = e.allyId !== null ? engine.getEmployee(e.allyId) : undefined;
      set('name', e.name);
      set('status', e.locFloor === -1 ? 'In elevator' : e.path.length ? `\u2192 ${ACTIVITY_LABEL[e.activity]}` : e.stealing ? 'Taking credit' : ACTIVITY_LABEL[e.activity]);
      set('floor', `F${e.floor + 1} \u00b7 ${FLOORS[e.floor].title}`);
      set('next', e.floor < TOP_FLOOR ? describeSplit(engine.promotionWeights(e.floor)) : 'top of the ladder');
      set('kpi', e.qKpi.toFixed(1));
      set('vis', e.qVis.toFixed(1));
      set('pol', e.qPol.toFixed(1));
      set('task', `${TASK_LABEL[e.task]} ${Math.round((e.taskProgress / TASK_SIZE) * 100)}%`);
      set('oversight', !engine.culture.mods.redTape ? '\u2013' : e.supervised ? 'Supervised' : 'Unsupervised (\u221240% KPI)');
      set('career', e.careerKpi.toFixed(0));
      set('tenure', `${engine.quarter - e.hiredQuarter} Q`);
      set('generation', String(e.generation));
      set('ally', ally ? `${ally.name} (F${ally.floor + 1})` : '\u2013');
      bar('energy', e.energy / 100);
      bar('burnout', e.burnout / 100);
      for (const k of TRAITS) bar(k, e.traits[k]);
      card.style.setProperty('--emp', TRAIT_COLORS[dominantStyle(e.traits)]);

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

  const field = (label: string, key: CardField, color?: string) => (
    <>
      <dt className="text-ink-400" style={color ? { color } : undefined}>
        {label}
      </dt>
      <dd ref={(el) => void (fields.current[key] = el)} className="truncate text-right text-ink-200 tabular-nums" />
    </>
  );
  const meter = (label: string, key: string, color: string) => (
    <div key={key} className="flex items-center gap-2 text-[10px]">
      <span className="w-16 shrink-0 text-ink-400" style={{ color }}>
        {label}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700">
        <div ref={(el) => void (bars.current[key] = el)} className="h-full rounded-full" style={{ background: color }} />
      </div>
    </div>
  );

  return (
    <div
      ref={cardRef}
      className={`pointer-events-none absolute top-0 left-0 z-10 rounded-lg border border-ink-600/70 bg-ink-900/92 px-3 py-2.5 shadow-2xl shadow-black/40 backdrop-blur-sm transition-opacity duration-150 ${
        pinned ? 'w-[262px]' : 'w-56'
      }`}
      style={{ opacity: 0 }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--emp)' }} />
        <span ref={(el) => void (fields.current.name = el)} className="truncate text-[12px] font-semibold text-ink-200" />
        <span ref={(el) => void (fields.current.status = el)} className="ml-auto shrink-0 text-[9.5px] font-medium tracking-wide text-ink-400 uppercase" />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {field('Role', 'floor', 'var(--emp)')}
        {field('Next promo', 'next')}
      </dl>
      <div className="my-1.5 flex flex-col gap-1">
        {meter('Energy', 'energy', '#f5c451')}
        {meter('Burnout', 'burnout', '#ff6b6b')}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
        {field('KPI (qtr)', 'kpi', TRAIT_COLORS.execution)}
        {field('Visibility', 'vis', TRAIT_COLORS.charisma)}
        {field('Pol. credit', 'pol', TRAIT_COLORS.politics)}
        {field('Task', 'task')}
        {field('Oversight', 'oversight')}
        {field('Career KPI', 'career')}
        {field('Tenure', 'tenure')}
        {field('Gen', 'generation')}
        {field('Ally', 'ally')}
      </dl>
      <div className="mt-1.5 flex flex-col gap-1 border-t border-ink-700/70 pt-1.5">{TRAITS.map((k) => meter(k[0].toUpperCase() + k.slice(1), k, TRAIT_COLORS[k]))}</div>
      {pinned ? (
        <div className="mt-2 border-t border-ink-700/70 pt-2">
          <div className="mb-1 flex items-center justify-between text-[9.5px]">
            <span className="font-medium tracking-wider text-ink-400 uppercase">Brain · 10 → 7 → 3</span>
            <span className="flex gap-2 text-ink-500">
              <span className="text-[#5eead4]">+</span>
              <span className="text-[#ff7f6a]">−</span>
            </span>
          </div>
          <BrainVisualizer net={pinned.brain} labels={CORP_BRAIN_LABELS} />
        </div>
      ) : (
        <p className="mt-2 text-[9.5px] text-ink-500">Click to pin and inspect their brain</p>
      )}
    </div>
  );
}
