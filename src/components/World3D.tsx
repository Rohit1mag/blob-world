import { MapControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { SimulationEngine } from '../engine/SimulationEngine';
import type { Blob, Structure, Tribe } from '../engine/types';
import { BlobCard, type BlobCardHandle } from './BlobCard';
import { RESOURCE_COLORS } from './blobColor';
import { easeOutBack, seasonWeights, smoothstep } from './seasonVisuals';
import { useAnimationFrame } from './useAnimationFrame';

type Controls = ComponentRef<typeof MapControls>;

const BLOB_CAP = 1600;
const NODE_CAP = 2000;
const MAX_BERRIES = 6;
const WEATHER_PARTICLES = 2500;
const FOLLOW_DISTANCE = 220;
/** Overview camera height and pull-back, as fractions of the map size. */
const OVERVIEW = [0.6, 0.5] as const;
/** Camera height above which eyes and packs are skipped; they're sub-pixel from up there. */
const DETAIL_HEIGHT_FRACTION = 0.55;

const GROUND = { summer: new THREE.Color('#34472f'), fall: new THREE.Color('#4d4029'), winter: new THREE.Color('#c4d1e2') };
const SKY = { day: new THREE.Color('#1c2638'), night: new THREE.Color('#060911') };
const CROWN = { summer: new THREE.Color('#2f6b47'), fall: new THREE.Color('#9a6a2e'), winter: new THREE.Color('#dfe8f3') };
const DEAD = new THREE.Color('#4a5570');
const RUIN = new THREE.Color('#596277');

interface World3DProps {
  engine: SimulationEngine;
  pinnedId: number | null;
  onPinnedChange: (id: number | null) => void;
  selectedTribeId?: number | null;
  onSelectTribe?: (id: number | null) => void;
  focusTarget?: { x: number; y: number; seq: number } | null;
  directorMode?: boolean;
}

/** Time-of-day and season for the frame, shared by every layer. */
function worldClock(engine: SimulationEngine) {
  const cfg = engine.config;
  const night = engine.nightProgress;
  const dayFrac = engine.phase === 'night' ? 1 : engine.tick / cfg.dayTicks;
  const season = seasonWeights((engine.dayOfYear + dayFrac) / cfg.yearLength);
  const dusk = engine.phase === 'night' ? 0.45 + 0.4 * Math.sin(Math.PI * night) : 0.45 * smoothstep(0.85, 1, dayFrac);
  return { night, dayFrac, season, dusk };
}

export default function World3D({
  engine,
  pinnedId,
  onPinnedChange,
  selectedTribeId = null,
  onSelectTribe,
  focusTarget = null,
  directorMode = false,
}: World3DProps) {
  const L = engine.config.arenaSize;
  const cardRef = useRef<BlobCardHandle>(null);
  const controlsRef = useRef<Controls>(null);
  const hoverId = useRef<number | null>(null);
  const pinnedRef = useRef(pinnedId);
  pinnedRef.current = pinnedId;
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  if (pinnedId === null && follow) setFollow(false);
  const directorRef = useRef(directorMode);
  directorRef.current = directorMode;
  const lastFocusSeq = useRef(-1);
  const pinnedBlob = pinnedId === null ? null : (engine.blobs.find((b) => b.id === pinnedId) ?? null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const labelRefs = useRef(new Map<number, HTMLDivElement>());

  /** Move the camera so it looks at world point (x, y), keeping its current angle and distance. */
  const focus = (x: number, y: number) => {
    const c = controlsRef.current;
    if (!c) return;
    const dx = x - L / 2 - c.target.x;
    const dz = y - L / 2 - c.target.z;
    c.target.x += dx;
    c.target.z += dz;
    c.object.position.x += dx;
    c.object.position.z += dz;
    setFollow(false);
  };
  useEffect(() => {
    if (!focusTarget || focusTarget.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focusTarget.seq;
    focus(focusTarget.x, focusTarget.y);
  }, [focusTarget]);
  const resetCamera = () => {
    const c = controlsRef.current;
    if (!c) return;
    c.target.set(0, 0, 0);
    c.object.position.set(0, L * OVERVIEW[0], L * OVERVIEW[1]);
    setFollow(false);
  };
  const toggleFollow = () => {
    const c = controlsRef.current;
    if (!follow && c && pinnedBlob) {
      // Swoop in close behind the blob, keeping the current viewing direction.
      const dir = c.object.position.clone().sub(c.target).normalize();
      c.target.set(pinnedBlob.x - L / 2, 0, pinnedBlob.y - L / 2);
      c.object.position.copy(c.target).addScaledVector(dir, FOLLOW_DISTANCE);
      if (c.object.position.y < 60) c.object.position.y = 60;
    }
    setFollow(!follow);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl"
      onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 45, near: 2, far: L * 5, position: [0, L * OVERVIEW[0], L * OVERVIEW[1]] }}
        onPointerMissed={(e) => {
          const d = downAt.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) onPinnedChange(null);
        }}
      >
        <Lighting engine={engine} />
        <Ground engine={engine} />
        <WaterLayer engine={engine} />
        <Nodes engine={engine} />
        <Settlements engine={engine} selectedTribeId={selectedTribeId} onSelectTribe={onSelectTribe} />
        <Blobs engine={engine} hoverId={hoverId} onPick={(id) => onPinnedChange(id === pinnedRef.current ? null : id)} />
        <Effects3D engine={engine} />
        <Selection engine={engine} pinnedRef={pinnedRef} hoverId={hoverId} />
        <Weather engine={engine} />
        <LabelProjector engine={engine} labelRefs={labelRefs} />
        <CameraRig
          engine={engine}
          controlsRef={controlsRef}
          followRef={followRef}
          directorRef={directorRef}
          pinnedRef={pinnedRef}
          hoverId={hoverId}
          cardRef={cardRef}
        />
        <MapControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          maxPolarAngle={1.32}
          minDistance={25}
          maxDistance={L * 1.9}
          onStart={() => followRef.current && setFollow(false)}
        />
      </Canvas>

      <CampLabels engine={engine} labelRefs={labelRefs} />
      <BlobCard ref={cardRef} engine={engine} pinnedBlob={pinnedBlob} />

      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full border border-ink-700/80 bg-ink-900/80 p-0.5 text-[11px] text-ink-300 backdrop-blur">
        <button type="button" onClick={resetCamera} className="rounded-full px-2.5 py-0.5 transition hover:text-ink-200" title="Back to the overview">
          Overview
        </button>
        <button
          type="button"
          disabled={pinnedId === null}
          onClick={toggleFollow}
          title={pinnedId === null ? 'Pin a blob to follow it' : 'Keep the camera on the pinned blob'}
          className={`rounded-full px-2.5 py-0.5 transition disabled:opacity-35 ${follow ? 'bg-[#5eead4]/20 text-[#5eead4]' : 'hover:text-ink-200'}`}
        >
          Follow
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-ink-400/80">
        Drag to pan · right-drag to orbit · scroll to zoom · click a blob
      </p>
      <Minimap engine={engine} controlsRef={controlsRef} onFocus={focus} />
    </div>
  );
}

// ───────────────────────────── Camera & card ─────────────────────────────

function CameraRig({
  engine,
  controlsRef,
  followRef,
  directorRef,
  pinnedRef,
  hoverId,
  cardRef,
}: {
  engine: SimulationEngine;
  controlsRef: RefObject<Controls | null>;
  followRef: RefObject<boolean>;
  directorRef: RefObject<boolean>;
  pinnedRef: RefObject<number | null>;
  hoverId: RefObject<number | null>;
  cardRef: RefObject<BlobCardHandle | null>;
}) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const L = engine.config.arenaSize;
    const c = controlsRef.current;
    const pinned = pinnedRef.current === null ? null : (engine.blobs.find((b) => b.id === pinnedRef.current) ?? null);
    if (c && followRef.current && pinned) {
      const dx = (pinned.x - L / 2 - c.target.x) * 0.12;
      const dz = (pinned.y - L / 2 - c.target.z) * 0.12;
      c.target.x += dx;
      c.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
    } else if (c && directorRef.current && engine.directorFocus) {
      const dx = (engine.directorFocus.x - L / 2 - c.target.x) * 0.035;
      const dz = (engine.directorFocus.y - L / 2 - c.target.z) * 0.035;
      c.target.x += dx;
      c.target.z += dz;
      camera.position.x += dx;
      camera.position.z += dz;
    }

    const id = pinnedRef.current ?? hoverId.current;
    const b = pinned ?? (id === null ? null : (engine.blobs.find((x) => x.id === id) ?? null));
    const card = cardRef.current;
    if (!card) return;
    if (!b) return card.update(null, 0, 0, 0, size.width, size.height);
    v.set(b.x - L / 2, b.radius * 1.2, b.y - L / 2).project(camera);
    if (v.z > 1) return card.update(null, 0, 0, 0, size.width, size.height);
    const sx = (v.x * 0.5 + 0.5) * size.width;
    const sy = (-v.y * 0.5 + 0.5) * size.height;
    card.update(b, sx, sy, 22, size.width, size.height);
  });
  return null;
}

// ───────────────────────────── Camp labels ─────────────────────────────

/** DOM labels over each camp; content refreshes a few times a second, positions every frame. */
function CampLabels({ engine, labelRefs }: { engine: SimulationEngine; labelRefs: RefObject<Map<number, HTMLDivElement>> }) {
  const [, setVersion] = useState(0);
  const last = useRef(0);
  useAnimationFrame((now) => {
    if (now - last.current < 300) return;
    last.current = now;
    setVersion((v) => v + 1);
  });
  const pops = engine.tribes.map(() => 0);
  for (const b of engine.blobs) if (b.state === 'active') pops[b.tribeId]++;
  return (
    <>
      {engine.structures
        .filter((s) => s.type === 'townCenter')
        .map((s) => {
          const t = engine.tribes[s.tribeId];
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
          return (
            <div
              key={s.id}
              ref={(el) => {
                if (el) labelRefs.current.set(s.tribeId, el);
                else labelRefs.current.delete(s.tribeId);
              }}
              className="pointer-events-none absolute top-0 left-0 text-center leading-tight whitespace-nowrap select-none"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)', opacity: 0 }}
            >
              <div className="text-[11px] font-semibold" style={{ color: t.extinct ? 'rgba(167,177,198,0.6)' : t.color }}>
                {title}
              </div>
              {!t.extinct && (
                <div className="font-mono text-[9px] text-ink-300">
                  {pops[t.id]} pop · {Math.floor(t.stockpile.food)}f {t.stockpile.timber}w {t.stockpile.stone}s
                </div>
              )}
            </div>
          );
        })}
    </>
  );
}

function LabelProjector({ engine, labelRefs }: { engine: SimulationEngine; labelRefs: RefObject<Map<number, HTMLDivElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const L = engine.config.arenaSize;
    for (const [tribeId, el] of labelRefs.current) {
      const p = engine.tribes[tribeId]?.basePosition;
      if (!p) continue;
      v.set(p.x - L / 2, 64, p.y - L / 2).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.opacity = visible ? '1' : '0';
      if (!visible) continue;
      const sx = (v.x * 0.5 + 0.5) * size.width;
      const sy = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, -100%) translate(${Math.round(sx)}px, ${Math.round(sy)}px)`;
    }
  });
  return null;
}

// ───────────────────────────── Environment ─────────────────────────────

function Lighting({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const { scene } = useThree();
  const bg = useMemo(() => new THREE.Color(), []);
  const fog = useMemo(() => new THREE.Fog('#1c2638', L * 1.1, L * 3), [L]);
  useEffect(() => {
    scene.fog = fog;
    scene.background = bg;
  }, [scene, fog, bg]);

  useFrame(() => {
    const { dayFrac, dusk, season } = worldClock(engine);
    const light = 1 - dusk;
    const a = Math.PI * (0.15 + 0.7 * dayFrac);
    if (sun.current) {
      sun.current.position.set(Math.cos(a) * L * 0.7, L * (0.35 + 0.45 * Math.sin(a)), L * 0.35);
      sun.current.intensity = 0.25 + 1.9 * light * (1 - 0.25 * season.winter);
      sun.current.color.setRGB(1, 0.86 + 0.14 * light, 0.72 + 0.28 * light);
    }
    if (hemi.current) hemi.current.intensity = 0.35 + 0.65 * light;
    bg.copy(SKY.day).lerp(SKY.night, dusk);
    fog.color.copy(bg);
  });

  const s = L * 0.62;
  return (
    <>
      <hemisphereLight ref={hemi} args={['#c4d6ff', '#3a3122', 0.9]} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-s}
        shadow-camera-right={s}
        shadow-camera-top={s}
        shadow-camera-bottom={-s}
        shadow-camera-far={L * 3}
        shadow-bias={-0.0004}
      />
    </>
  );
}

function Ground({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const { season } = worldClock(engine);
    if (!mat.current) return;
    const c = mat.current.color;
    c.setRGB(0, 0, 0);
    c.r = GROUND.summer.r * season.summer + GROUND.fall.r * season.fall + GROUND.winter.r * season.winter;
    c.g = GROUND.summer.g * season.summer + GROUND.fall.g * season.fall + GROUND.winter.g * season.winter;
    c.b = GROUND.summer.b * season.summer + GROUND.fall.b * season.fall + GROUND.winter.b * season.winter;
  });
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[L, L]} />
        <meshStandardMaterial ref={mat} roughness={0.95} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-1}>
        <planeGeometry args={[L * 8, L * 8]} />
        <meshStandardMaterial color="#0d121c" roughness={1} />
      </mesh>
    </>
  );
}

function WaterLayer({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((state) => {
    if (!matRef.current) return;
    const { season } = worldClock(engine);
    const shimmer = 0.16 + 0.08 * Math.sin(state.clock.elapsedTime * 1.6);
    const r = 0.12 + season.winter * 0.16;
    const g = 0.33 + season.winter * 0.12;
    const b = 0.49 + season.winter * 0.1;
    matRef.current.color.setRGB(r, g, b);
    matRef.current.roughness = 0.14 + season.winter * 0.25;
    matRef.current.emissiveIntensity = shimmer * (1 - season.winter * 0.6);
  });
  return (
    <group>
      {engine.river.map((seg, i) => {
        const dx = seg.x2 - seg.x1;
        const dz = seg.y2 - seg.y1;
        const len = Math.hypot(dx, dz) + seg.width * 0.45;
        const angle = Math.atan2(dx, dz);
        const mx = (seg.x1 + seg.x2) / 2 - L / 2;
        const mz = (seg.y1 + seg.y2) / 2 - L / 2;
        return (
          <mesh key={`riv-${i}`} position={[mx, 0.25, mz]} rotation={[0, angle, 0]} receiveShadow>
            <boxGeometry args={[seg.width, 0.3, len]} />
            <meshStandardMaterial ref={i === 0 ? matRef : undefined} color="#1e547c" emissive="#1c5a88" emissiveIntensity={0.18} roughness={0.18} metalness={0.3} />
          </mesh>
        );
      })}
      {engine.lakes.map((lk, i) => (
        <mesh key={`lake-${i}`} position={[lk.x - L / 2, 0.28, lk.y - L / 2]} rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[lk.radius, 32]} />
          <meshStandardMaterial color="#1e547c" emissive="#1c5a88" emissiveIntensity={0.18} roughness={0.18} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function Weather({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const points = useRef<THREE.Points>(null);
  const mat = useRef<THREE.PointsMaterial>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(WEATHER_PARTICLES * 3);
    const speeds = new Float32Array(WEATHER_PARTICLES);
    for (let i = 0; i < WEATHER_PARTICLES; i++) {
      positions[i * 3] = (Math.random() - 0.5) * L;
      positions[i * 3 + 1] = Math.random() * 320;
      positions[i * 3 + 2] = (Math.random() - 0.5) * L;
      speeds[i] = 18 + Math.random() * 30;
    }
    return { positions, speeds };
  }, [L]);
  useFrame((state, dt) => {
    const { season } = worldClock(engine);
    const amount = Math.max(season.winter, season.fall * 0.7);
    if (!points.current || !mat.current) return;
    points.current.visible = amount > 0.02;
    if (!points.current.visible) return;
    mat.current.opacity = amount * 0.85;
    mat.current.color.set(season.winter >= season.fall ? '#f2f6ff' : '#de8c46');
    mat.current.size = season.winter >= season.fall ? 2.6 : 3.6;
    const fall = season.winter >= season.fall ? 1 : 0.55;
    const t = state.clock.elapsedTime;
    const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < WEATHER_PARTICLES; i++) {
      let y = positions[i * 3 + 1] - speeds[i] * fall * Math.min(dt, 0.05);
      if (y < 0) y += 320;
      positions[i * 3 + 1] = y;
      positions[i * 3] += Math.sin(t * 0.8 + i) * 0.15;
    }
    attr.needsUpdate = true;
  });
  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial ref={mat} transparent depthWrite={false} sizeAttenuation />
    </points>
  );
}

// ───────────────────────────── Resources ─────────────────────────────

function Nodes({ engine }: { engine: SimulationEngine }) {
  const bush = useRef<THREE.InstancedMesh>(null);
  const berry = useRef<THREE.InstancedMesh>(null);
  const fish = useRef<THREE.InstancedMesh>(null);
  const trunk = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  const stone = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!bush.current || !berry.current || !fish.current || !trunk.current || !crown.current || !stone.current) return;
    const L = engine.config.arenaSize;
    const { season } = worldClock(engine);
    color.setRGB(
      CROWN.summer.r * season.summer + CROWN.fall.r * season.fall + CROWN.winter.r * season.winter,
      CROWN.summer.g * season.summer + CROWN.fall.g * season.fall + CROWN.winter.g * season.winter,
      CROWN.summer.b * season.summer + CROWN.fall.b * season.fall + CROWN.winter.b * season.winter,
    );
    (crown.current.material as THREE.MeshStandardMaterial).color.copy(color);
    let nb = 0;
    let nf = 0;
    let nfi = 0;
    let nt = 0;
    let ns = 0;
    const put = (mesh: THREE.InstancedMesh, i: number) => {
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    };
    for (const n of engine.nodes) {
      const x = n.x - L / 2;
      const z = n.y - L / 2;
      const fill = n.amount / n.max;
      dummy.rotation.set(0, n.id * 1.7, 0);
      if (n.type === 'food' && n.isFish) {
        const count = Math.min(4, Math.max(0, Math.floor(n.amount)));
        for (let i = 0; i < count && nfi < NODE_CAP * 2; i++) {
          const a = (i / 4) * Math.PI * 2 + n.id;
          dummy.position.set(x + Math.cos(a) * n.radius * 0.45, 0.9, z + Math.sin(a) * n.radius * 0.45);
          dummy.rotation.set(0, -a, 0);
          dummy.scale.set(2.8, 1.1, 1.4);
          put(fish.current, nfi++);
        }
      } else if (n.type === 'food' && nb < NODE_CAP) {
        const r = n.radius * (n.max / n.baseMax) ** 0.5;
        dummy.position.set(x, r * 0.55, z);
        dummy.scale.set(r, r * 0.75, r);
        put(bush.current, nb++);
        const berries = Math.min(MAX_BERRIES, Math.floor(n.amount));
        for (let i = 0; i < berries; i++) {
          const a = (i / MAX_BERRIES) * Math.PI * 2 + n.id;
          dummy.position.set(x + Math.cos(a) * r * 0.62, r * (0.75 + 0.25 * ((i * 7) % 3) * 0.3), z + Math.sin(a) * r * 0.62);
          dummy.scale.setScalar(1.7);
          put(berry.current, nf++);
        }
      } else if (n.type === 'timber' && nt < NODE_CAP) {
        const s = 0.55 + 0.45 * fill;
        dummy.position.set(x, 5 * s, z);
        dummy.scale.set(s, s, s);
        put(trunk.current, nt);
        dummy.position.set(x, 10 * s + 9 * s, z);
        put(crown.current, nt++);
      } else if (n.type === 'stone' && ns < NODE_CAP) {
        const r = n.radius * (0.5 + 0.5 * fill);
        dummy.position.set(x, r * 0.4, z);
        dummy.scale.set(r, r * 0.7, r);
        put(stone.current, ns++);
      }
    }
    for (const [mesh, count] of [
      [bush.current, nb],
      [berry.current, nf],
      [fish.current, nfi],
      [trunk.current, nt],
      [crown.current, nt],
      [stone.current, ns],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={bush} args={[undefined, undefined, NODE_CAP]} castShadow receiveShadow frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#1f4a35" roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={berry} args={[undefined, undefined, NODE_CAP * MAX_BERRIES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color={RESOURCE_COLORS.food} emissive={RESOURCE_COLORS.food} emissiveIntensity={0.25} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={fish} args={[undefined, undefined, NODE_CAP * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#8ce0ff" emissive="#5ac8fa" emissiveIntensity={0.25} roughness={0.25} />
      </instancedMesh>
      <instancedMesh ref={trunk} args={[undefined, undefined, NODE_CAP]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1.4, 2, 10, 6]} />
        <meshStandardMaterial color="#5a3d26" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, NODE_CAP]} castShadow receiveShadow frustumCulled={false}>
        <coneGeometry args={[9, 22, 7]} />
        <meshStandardMaterial color="#2f6b47" roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh ref={stone} args={[undefined, undefined, NODE_CAP]} castShadow receiveShadow frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#8a93a6" roughness={0.8} flatShading />
      </instancedMesh>
    </>
  );
}

// ───────────────────────────── Settlements ─────────────────────────────

/** Structures, territories, labels and campfires. Re-rendered a few times a second as camps change. */
function Settlements({
  engine,
  selectedTribeId,
  onSelectTribe,
}: {
  engine: SimulationEngine;
  selectedTribeId: number | null;
  onSelectTribe?: (id: number | null) => void;
}) {
  const [, setVersion] = useState(0);
  const last = useRef(0);
  useFrame((state) => {
    if (state.clock.elapsedTime - last.current < 0.3) return;
    last.current = state.clock.elapsedTime;
    setVersion((v) => v + 1);
  });
  const L = engine.config.arenaSize;
  const camps = engine.structures.filter((s) => s.type === 'townCenter');
  return (
    <>
      {engine.structures.map((s) => (
        <StructureMesh
          key={s.id}
          s={s}
          tribe={engine.tribes[s.tribeId]}
          engine={engine}
          onClick={
            s.type === 'townCenter' && onSelectTribe
              ? () => onSelectTribe(s.tribeId === selectedTribeId ? null : s.tribeId)
              : undefined
          }
        />
      ))}
      {camps.map((s) => {
        const t = engine.tribes[s.tribeId];
        const realm = engine.realms[t.realmId];
        const inRealm = !t.extinct && realm && realm.tier !== 'chiefdom';
        const cap = inRealm && realm.capitalId !== t.id ? engine.tribes[realm.capitalId] : null;
        return (
          <group key={`camp-${s.id}`}>
            <group position={[s.x - L / 2, 0, s.y - L / 2]}>
              {!t.extinct && (
                <mesh rotation-x={-Math.PI / 2} position-y={0.6}>
                  <circleGeometry args={[165, 48]} />
                  <meshBasicMaterial color={t.color} transparent opacity={0.07} depthWrite={false} />
                </mesh>
              )}
              {inRealm && (
                <mesh rotation-x={-Math.PI / 2} position-y={0.8}>
                  <ringGeometry args={[162, realm.capitalId === t.id ? 166 : 164.5, 48]} />
                  <meshBasicMaterial color={realm.color} transparent opacity={realm.capitalId === t.id ? 0.45 : 0.25} depthWrite={false} />
                </mesh>
              )}
              {!t.extinct &&
                (() => {
                  const pop = engine.blobs.filter((b) => b.tribeId === t.id && b.state === 'active').length;
                  const tier = engine.settlementTier(pop, t.id);
                  if (tier !== 'town' && tier !== 'city' && tier !== 'metropolis') return null;
                  return (
                    <mesh rotation-x={-Math.PI / 2} position-y={0.85}>
                      <ringGeometry args={[116, 119.5, 48]} />
                      <meshBasicMaterial color={tier === 'metropolis' ? '#6ed2ff' : '#9aa4b8'} transparent opacity={0.34} depthWrite={false} />
                    </mesh>
                  );
                })()}
              {!t.extinct && <Campfire engine={engine} />}
            </group>
            {cap &&
              !cap.extinct &&
              !engine.roads.some(
                (rd) =>
                  (rd.fromTribeId === t.id && rd.toTribeId === cap.id) || (rd.fromTribeId === cap.id && rd.toTribeId === t.id),
              ) && (
                <RealmLink from={[s.x - L / 2, 1.1, s.y - L / 2]} to={[cap.basePosition.x - L / 2, 1.1, cap.basePosition.y - L / 2]} color={realm.color} />
              )}
          </group>
        );
      })}
      {engine.roads.map((rd) => {
        const a = engine.tribes[rd.fromTribeId]?.basePosition;
        const b = engine.tribes[rd.toTribeId]?.basePosition;
        if (!a || !b) return null;
        return (
          <RoadMesh
            key={`road-${rd.id}`}
            from={[a.x - L / 2, 0.7, a.y - L / 2]}
            to={[b.x - L / 2, 0.7, b.y - L / 2]}
            built={rd.built}
            paved={!!rd.paved}
          />
        );
      })}
      <Vehicles3D engine={engine} />
      <DiplomacyLinks engine={engine} />
    </>
  );
}

function DiplomacyLinks({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const caravans = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const active = [...engine.relations.values()].filter((rel) => {
    if (rel.stance === 'neutral') return false;
    const ra = engine.realms[rel.a];
    const rb = engine.realms[rel.b];
    if (!ra || !rb) return false;
    const capA = engine.tribes[ra.capitalId];
    const capB = engine.tribes[rb.capitalId];
    return Boolean(capA && capB && !capA.extinct && !capB.extinct);
  });

  useFrame((state) => {
    if (!caravans.current) return;
    const time = state.clock.elapsedTime;
    let c = 0;
    for (const rel of active) {
      if ((rel.stance !== 'trade' && rel.stance !== 'alliance') || c + 2 > 64) continue;
      const capA = engine.tribes[engine.realms[rel.a].capitalId];
      const capB = engine.tribes[engine.realms[rel.b].capitalId];
      const ax = capA.basePosition.x - L / 2;
      const az = capA.basePosition.y - L / 2;
      const bx = capB.basePosition.x - L / 2;
      const bz = capB.basePosition.y - L / 2;
      for (const dir of [0, 0.5]) {
        const u = (time * 0.14 + dir + rel.a * 0.17) % 1;
        const t = dir === 0 ? u : 1 - u;
        dummy.position.set(ax + (bx - ax) * t, 3.2, az + (bz - az) * t);
        dummy.scale.setScalar(3.4);
        dummy.updateMatrix();
        caravans.current.setMatrixAt(c++, dummy.matrix);
      }
    }
    caravans.current.count = c;
    caravans.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {active.map((rel) => {
        const capA = engine.tribes[engine.realms[rel.a].capitalId];
        const capB = engine.tribes[engine.realms[rel.b].capitalId];
        const ax = capA.basePosition.x - L / 2;
        const az = capA.basePosition.y - L / 2;
        const bx = capB.basePosition.x - L / 2;
        const bz = capB.basePosition.y - L / 2;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        const angle = Math.atan2(dx, dz);
        const lineColor = rel.stance === 'alliance' ? '#6fe39a' : rel.stance === 'trade' ? '#ffd166' : '#ff6b6b';
        return (
          <mesh key={`dip-${rel.a}-${rel.b}`} position={[(ax + bx) / 2, 1.5, (az + bz) / 2]} rotation={[0, angle, 0]}>
            <boxGeometry args={[rel.stance === 'war' ? 1.4 : 1.9, 0.25, len]} />
            <meshBasicMaterial color={lineColor} transparent opacity={rel.stance === 'war' ? 0.24 : 0.34} depthWrite={false} />
          </mesh>
        );
      })}
      <instancedMesh ref={caravans} args={[undefined, undefined, 64]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb703" emissiveIntensity={0.4} roughness={0.35} />
      </instancedMesh>
    </>
  );
}

function RoadMesh({ from, to, built, paved }: { from: [number, number, number]; to: [number, number, number]; built: boolean; paved: boolean }) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  return (
    <group position={[(from[0] + to[0]) / 2, 0.9, (from[2] + to[2]) / 2]} rotation={[0, angle, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[paved ? 14 : built ? 11 : 5, 0.7, len]} />
        <meshStandardMaterial
          color={paved ? '#2f3747' : built ? '#9aa4b8' : '#737d91'}
          transparent={!built}
          opacity={built ? 0.96 : 0.6}
          roughness={paved ? 0.65 : 0.88}
        />
      </mesh>
      {paved && (
        <mesh position-y={0.4}>
          <boxGeometry args={[1.1, 0.1, len]} />
          <meshBasicMaterial color="#ffd166" />
        </mesh>
      )}
    </group>
  );
}

function Vehicles3D({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const cars = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    if (!cars.current) return;
    const time = state.clock.elapsedTime;
    let c = 0;
    for (const rd of engine.roads) {
      if (!rd.built || !rd.paved || c + 2 > 128) continue;
      const a = engine.tribes[rd.fromTribeId]?.basePosition;
      const b = engine.tribes[rd.toTribeId]?.basePosition;
      if (!a || !b) continue;
      const ax = a.x - L / 2;
      const az = a.y - L / 2;
      const bx = b.x - L / 2;
      const bz = b.y - L / 2;
      const ang = Math.atan2(bx - ax, bz - az);
      for (const dir of [0, 0.5]) {
        const u = (time * 0.28 + dir + rd.id * 0.13) % 1;
        const t = dir === 0 ? u : 1 - u;
        dummy.position.set(ax + (bx - ax) * t, 2.4, az + (bz - az) * t);
        dummy.rotation.set(0, ang + (dir === 0 ? 0 : Math.PI), 0);
        dummy.scale.set(4.5, 2.6, 8);
        dummy.updateMatrix();
        cars.current.setMatrixAt(c, dummy.matrix);
        cars.current.setColorAt(c++, color.set(dir === 0 ? '#6aa8ff' : '#ff8a7a'));
      }
    }
    cars.current.count = c;
    cars.current.instanceMatrix.needsUpdate = true;
    if (cars.current.instanceColor) cars.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={cars} args={[undefined, undefined, 128]} castShadow frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.3} metalness={0.4} />
    </instancedMesh>
  );
}

function RealmLink({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  return (
    <mesh position={[(from[0] + to[0]) / 2, 1.1, (from[2] + to[2]) / 2]} rotation={[0, angle, 0]}>
      <boxGeometry args={[1.6, 0.2, len]} />
      <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

function Campfire({ engine }: { engine: SimulationEngine }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);
  const smoke1 = useRef<THREE.Mesh>(null);
  const smoke2 = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const { dusk } = worldClock(engine);
    const t = state.clock.elapsedTime;
    const flicker = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 7.3);
    if (light.current) light.current.intensity = dusk * 9000 * flicker;
    if (flame.current) flame.current.scale.setScalar(0.6 + dusk * flicker);
    const active = dusk > 0.05 || engine.season === 'winter';
    for (const [idx, s] of [smoke1.current, smoke2.current].entries()) {
      if (!s) continue;
      s.visible = active;
      if (!active) continue;
      const p = (t * 0.4 + idx * 0.5) % 1;
      s.position.set(Math.sin(t * 1.5 + idx) * 4 * p, 14 + p * 34, Math.cos(t * 1.3 + idx) * 3 * p);
      s.scale.setScalar(2.2 + p * 4.5);
    }
  });
  return (
    <group position={[0, 0, 34]}>
      <pointLight ref={light} color="#ffb067" distance={170} decay={2} position-y={14} />
      <mesh ref={flame} position-y={4}>
        <coneGeometry args={[3.5, 9, 6]} />
        <meshBasicMaterial color="#ffb067" />
      </mesh>
      <mesh ref={smoke1} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#cfd8e8" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh ref={smoke2} visible={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#cfd8e8" transparent opacity={0.18} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Effects3D({ engine }: { engine: SimulationEngine }) {
  const L = engine.config.arenaSize;
  const bolts = useRef<THREE.InstancedMesh>(null);
  const rings = useRef<THREE.InstancedMesh>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    if (!bolts.current || !rings.current || !sparks.current) return;
    let nb = 0;
    for (const sh of engine.towerShots) {
      if (nb >= 32) break;
      const age = engine.tick - sh.tick;
      if (age < 0 || age > 12) continue;
      const x1 = sh.x1 - L / 2;
      const z1 = sh.y1 - L / 2;
      const x2 = sh.x2 - L / 2;
      const z2 = sh.y2 - L / 2;
      const dx = x2 - x1;
      const dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      dummy.position.set((x1 + x2) / 2, 18, (z1 + z2) / 2);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.scale.set(1.4, 1.4, len);
      dummy.updateMatrix();
      bolts.current.setMatrixAt(nb, dummy.matrix);
      bolts.current.setColorAt(nb++, color.set(sh.color));
    }
    bolts.current.count = nb;
    bolts.current.instanceMatrix.needsUpdate = true;
    if (bolts.current.instanceColor) bolts.current.instanceColor.needsUpdate = true;

    let nr = 0;
    let ns = 0;
    const dayTicks = engine.config.dayTicks;
    for (const fx of engine.visualFx) {
      const age = (engine.day - fx.day) * dayTicks + (engine.tick - fx.tick);
      const maxAge = fx.kind === 'firework' ? 50 : 18;
      const u = age / maxAge;
      if (u < 0 || u >= 1) continue;
      if ((fx.kind === 'clash' || fx.kind === 'splash') && nr < 64) {
        const px = (fx.tx ?? fx.x) - L / 2;
        const pz = (fx.ty ?? fx.y) - L / 2;
        dummy.position.set(px, 2.2, pz);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(6 + u * 22);
        dummy.updateMatrix();
        rings.current.setMatrixAt(nr, dummy.matrix);
        rings.current.setColorAt(nr++, color.set(fx.color));
      } else if (fx.kind === 'firework' && ns + 10 <= 128) {
        const bx = fx.x - L / 2;
        const bz = fx.y - L / 2;
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const d = u * 44;
          dummy.position.set(bx + Math.cos(a) * d, 26 + u * 34, bz + Math.sin(a) * d);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(2.8 * (1 - u * 0.5));
          dummy.updateMatrix();
          sparks.current.setMatrixAt(ns, dummy.matrix);
          sparks.current.setColorAt(ns++, color.set(i % 2 === 0 ? fx.color : '#ffd166'));
        }
      }
    }
    rings.current.count = nr;
    sparks.current.count = ns;
    rings.current.instanceMatrix.needsUpdate = true;
    sparks.current.instanceMatrix.needsUpdate = true;
    if (rings.current.instanceColor) rings.current.instanceColor.needsUpdate = true;
    if (sparks.current.instanceColor) sparks.current.instanceColor.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bolts} args={[undefined, undefined, 32]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.9} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[undefined, undefined, 64]} frustumCulled={false}>
        <ringGeometry args={[0.8, 1, 24]} />
        <meshBasicMaterial transparent opacity={0.7} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={sparks} args={[undefined, undefined, 128]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial />
      </instancedMesh>
    </>
  );
}

function StructureMesh({
  s,
  tribe,
  engine,
  onClick,
}: {
  s: Structure;
  tribe: Tribe;
  engine: SimulationEngine;
  onClick?: () => void;
}) {
  const L = engine.config.arenaSize;
  const group = useRef<THREE.Group>(null);
  const flash = useRef<THREE.MeshStandardMaterial>(null);
  const r = s.radius;
  const ruined = tribe.extinct;
  const main = ruined ? RUIN : tribe.color;
  const opacity = s.built ? 1 : 0.4;

  useFrame(() => {
    if (group.current) group.current.scale.y = s.built ? 1 : 0.15 + 0.85 * (s.progress / s.buildTicks);
    if (flash.current) flash.current.emissiveIntensity = engine.tick - s.lastHitTick < 10 && engine.phase === 'day' ? 0.9 : 0;
  });

  const mat = (color: THREE.ColorRepresentation, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => (
    <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={0.8} {...extra} />
  );
  let body: ReactNode;
  if (s.type === 'townCenter') {
    const w = r * 1.5;
    body = (
      <>
        <mesh position-y={9} castShadow receiveShadow>
          <boxGeometry args={[w, 18, w * 0.8]} />
          <meshStandardMaterial ref={flash} color="#2a3346" emissive="#ff5a4a" emissiveIntensity={0} roughness={0.9} />
        </mesh>
        {!ruined && (
          <>
            <mesh position-y={26} rotation-y={Math.PI / 4} castShadow>
              <coneGeometry args={[w * 0.82, 17, 4]} />
              {mat(main)}
            </mesh>
            <mesh position={[0, 44, 0]}>
              <cylinderGeometry args={[0.6, 0.6, 20, 5]} />
              <meshStandardMaterial color="#c8d0df" />
            </mesh>
            <mesh position={[5, 50, 0]}>
              <boxGeometry args={[10, 6, 0.6]} />
              <meshStandardMaterial color={tribe.color} emissive={tribe.color} emissiveIntensity={0.3} side={THREE.DoubleSide} />
            </mesh>
          </>
        )}
      </>
    );
  } else if (s.type === 'granary') {
    body = (
      <>
        <mesh position-y={r * 0.6} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.75, r * 0.8, r * 1.2, 12]} />
          {mat('#6b4f33')}
        </mesh>
        <mesh position-y={r * 1.2} castShadow>
          <sphereGeometry args={[r * 0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'shelter') {
    body = (
      <mesh position-y={r * 0.7} castShadow receiveShadow>
        <coneGeometry args={[r, r * 1.4, 6]} />
        {mat(main, { flatShading: true })}
      </mesh>
    );
  } else if (s.type === 'farm') {
    body = (
      <>
        <mesh position-y={1} receiveShadow>
          <boxGeometry args={[r * 2, 2, r * 1.5]} />
          {mat('#3d2c1e')}
        </mesh>
        {[-0.4, 0, 0.4].map((f, i) => (
          <mesh key={i} position={[0, 2.5, f * r]} castShadow>
            <boxGeometry args={[r * 1.6, 1.6, r * 0.22]} />
            {mat('#5fa862')}
          </mesh>
        ))}
      </>
    );
  } else if (s.type === 'workshop') {
    body = (
      <>
        <mesh position-y={r * 0.55} castShadow receiveShadow>
          <boxGeometry args={[r * 1.6, r * 1.1, r * 1.2]} />
          {mat('#394152')}
        </mesh>
        <mesh position-y={r * 1.3} rotation-y={Math.PI / 4} castShadow>
          <coneGeometry args={[r * 1.15, r * 0.7, 4]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'market') {
    body = (
      <>
        <mesh position-y={r * 0.35} castShadow receiveShadow>
          <boxGeometry args={[r * 1.9, r * 0.7, r * 1.3]} />
          {mat('#5c4028')}
        </mesh>
        <mesh position-y={r * 0.95} castShadow>
          <boxGeometry args={[r * 2.1, r * 0.28, r * 1.45]} />
          {mat('#ffd166')}
        </mesh>
        <mesh position={[0, r * 1.12, 0]}>
          <boxGeometry args={[r * 0.85, r * 0.14, r * 1.48]} />
          {mat('#e05d5d')}
        </mesh>
      </>
    );
  } else if (s.type === 'dock') {
    body = (
      <>
        <mesh position-y={1.6} castShadow receiveShadow>
          <boxGeometry args={[r * 1.8, 1.4, r * 1.3]} />
          {mat('#785536')}
        </mesh>
        <mesh position={[0, 4.5, 0]} castShadow>
          <cylinderGeometry args={[0.8, 0.8, 6, 6]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'bridge') {
    const tc = tribe.basePosition;
    const a = Math.atan2(s.y - tc.y, s.x - tc.x);
    body = (
      <group rotation-y={-a}>
        <mesh position-y={2.4} castShadow receiveShadow>
          <boxGeometry args={[r * 2.2, 1.6, r * 1.1]} />
          {mat('#8f6b47')}
        </mesh>
        <mesh position={[0, 3.8, r * 0.5]} castShadow>
          <boxGeometry args={[r * 2.2, 1.4, 1.2]} />
          {mat(main)}
        </mesh>
        <mesh position={[0, 3.8, -r * 0.5]} castShadow>
          <boxGeometry args={[r * 2.2, 1.4, 1.2]} />
          {mat(main)}
        </mesh>
      </group>
    );
  } else if (s.type === 'factory') {
    body = (
      <>
        <mesh position-y={r * 0.55} castShadow receiveShadow>
          <boxGeometry args={[r * 2, r * 1.1, r * 1.4]} />
          {mat('#3c4352')}
        </mesh>
        <mesh position={[-r * 0.5, r * 1.4, 0]} castShadow>
          <cylinderGeometry args={[r * 0.16, r * 0.22, r * 1.1, 8]} />
          {mat('#242934')}
        </mesh>
        <mesh position={[r * 0.35, r * 1.4, 0]} castShadow>
          <cylinderGeometry args={[r * 0.16, r * 0.22, r * 1.1, 8]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'powerPlant') {
    body = (
      <>
        <mesh position-y={r * 0.45} castShadow receiveShadow>
          <boxGeometry args={[r * 1.8, r * 0.9, r * 1.3]} />
          {mat('#1d2d44')}
        </mesh>
        <mesh position-y={r * 1.05} castShadow>
          <cylinderGeometry args={[r * 0.45, r * 0.55, r * 0.6, 12]} />
          <meshStandardMaterial color="#5fe0e0" emissive="#5fe0e0" emissiveIntensity={0.55} roughness={0.2} />
        </mesh>
      </>
    );
  } else if (s.type === 'lab') {
    body = (
      <>
        <mesh position-y={r * 0.45} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.85, r * 0.95, r * 0.9, 12]} />
          {mat('#28354a')}
        </mesh>
        <mesh position-y={r * 0.95} castShadow>
          <sphereGeometry args={[r * 0.68, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#8fd3ff" emissive="#5aa9ff" emissiveIntensity={0.35} roughness={0.25} />
        </mesh>
      </>
    );
  } else if (s.type === 'hospital') {
    body = (
      <>
        <mesh position-y={r * 0.6} castShadow receiveShadow>
          <boxGeometry args={[r * 1.7, r * 1.2, r * 1.3]} />
          {mat('#e7edf6')}
        </mesh>
        <mesh position-y={r * 1.25}>
          <boxGeometry args={[r * 0.9, r * 0.18, r * 0.28]} />
          <meshStandardMaterial color="#ff5a5f" emissive="#ff5a5f" emissiveIntensity={0.3} />
        </mesh>
        <mesh position-y={r * 1.25}>
          <boxGeometry args={[r * 0.28, r * 0.18, r * 0.9]} />
          <meshStandardMaterial color="#ff5a5f" emissive="#ff5a5f" emissiveIntensity={0.3} />
        </mesh>
      </>
    );
  } else if (s.type === 'skyscraper') {
    body = (
      <>
        <mesh position-y={r * 2.4} castShadow receiveShadow>
          <boxGeometry args={[r * 1.5, r * 4.8, r * 1.5]} />
          <meshStandardMaterial color="#2b4061" emissive="#4a7ab5" emissiveIntensity={0.2} metalness={0.55} roughness={0.22} />
        </mesh>
        <mesh position-y={r * 4.95} castShadow>
          <boxGeometry args={[r * 1.1, r * 0.4, r * 1.1]} />
          {mat(main)}
        </mesh>
        <mesh position-y={r * 5.6}>
          <cylinderGeometry args={[0.4, 0.5, r * 1.2, 6]} />
          <meshStandardMaterial color="#ffe082" emissive="#ffe082" emissiveIntensity={0.6} />
        </mesh>
      </>
    );
  } else if (s.type === 'watchtower') {
    body = (
      <>
        <mesh position-y={r * 1.4} castShadow receiveShadow>
          <cylinderGeometry args={[r * 0.65, r * 0.85, r * 2.8, 8]} />
          <meshStandardMaterial ref={flash} color="#586377" emissive="#ff5a4a" emissiveIntensity={0} roughness={0.85} />
        </mesh>
        <mesh position-y={r * 2.95} castShadow>
          <cylinderGeometry args={[r * 0.85, r * 0.75, r * 0.45, 8]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'monument') {
    body = (
      <>
        <mesh position-y={r * 0.35} castShadow receiveShadow>
          <boxGeometry args={[r * 1.4, r * 0.7, r * 1.4]} />
          {mat('#6a7488')}
        </mesh>
        <mesh position-y={r * 1.6} castShadow>
          <cylinderGeometry args={[r * 0.12, r * 0.42, r * 2.2, 4]} />
          {mat(main)}
        </mesh>
      </>
    );
  } else if (s.type === 'palace') {
    const w = r * 1.65;
    body = (
      <>
        <mesh position-y={10} castShadow receiveShadow>
          <boxGeometry args={[w, 20, w * 0.85]} />
          {mat('#2f384e')}
        </mesh>
        <mesh position-y={23} castShadow>
          <sphereGeometry args={[w * 0.36, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          {mat('#f5c451', { metalness: 0.3, roughness: 0.4 })}
        </mesh>
        <mesh position-y={33}>
          <cylinderGeometry args={[0.5, 0.5, 14, 5]} />
          <meshStandardMaterial color="#f5c451" />
        </mesh>
        <mesh position={[4, 38, 0]}>
          <boxGeometry args={[8, 5, 0.6]} />
          <meshStandardMaterial color={tribe.color} emissive={tribe.color} emissiveIntensity={0.35} side={THREE.DoubleSide} />
        </mesh>
      </>
    );
  } else {
    const tc = tribe.basePosition;
    const a = Math.atan2(s.y - tc.y, s.x - tc.x) + Math.PI / 2;
    body = (
      <group rotation-y={-a}>
        <mesh position-y={r * 0.55} castShadow receiveShadow>
          <boxGeometry args={[r * 2.6, r * 1.1, r * 0.5]} />
          {mat('#6e5034')}
        </mesh>
        <mesh position-y={r * 1.15}>
          <boxGeometry args={[r * 2.6, r * 0.12, r * 0.55]} />
          {mat(main)}
        </mesh>
      </group>
    );
  }
  return (
    <group
      position={[s.x - L / 2, 0, s.y - L / 2]}
      onClick={
        onClick
          ? (ev) => {
              if (ev.delta > 5) return;
              ev.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <group ref={group}>{body}</group>
      {s.health < s.maxHealth && s.built && (
        <mesh position-y={r * 2 + 6} rotation-x={-Math.PI / 4}>
          <planeGeometry args={[r * 2 * (s.health / s.maxHealth), 2.5]} />
          <meshBasicMaterial color={s.health / s.maxHealth > 0.4 ? '#8be3b0' : '#ff8a7a'} />
        </mesh>
      )}
    </group>
  );
}

// ───────────────────────────── Blobs ─────────────────────────────

const JOB_HAT_COLOR = {
  forager: '#e6c37a',
  lumberjack: '#4ca968',
  miner: '#6e9be6',
  builder: '#f5c451',
  soldier: '#c6d2e4',
  carrier: '#d4a373',
  scout: '#5fe0e0',
} as const;
const JOB_ACCENT_COLOR = {
  forager: '#ff7a6b',
  lumberjack: '#8be3b0',
  miner: '#fff3b0',
  builder: '#232a38',
  soldier: '#ff6b6b',
  carrier: '#ffd166',
  scout: '#0f282a',
} as const;

function Blobs({ engine, hoverId, onPick }: { engine: SimulationEngine; hoverId: RefObject<number | null>; onPick: (id: number) => void }) {
  const body = useRef<THREE.InstancedMesh>(null);
  const eyes = useRef<THREE.InstancedMesh>(null);
  const pupils = useRef<THREE.InstancedMesh>(null);
  const packs = useRef<THREE.InstancedMesh>(null);
  const hats = useRef<THREE.InstancedMesh>(null);
  const crests = useRef<THREE.InstancedMesh>(null);
  const glows = useRef<THREE.InstancedMesh>(null);
  const ids = useMemo(() => new Int32Array(BLOB_CAP), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const camera = useThree((s) => s.camera);

  useFrame((state) => {
    if (!body.current || !eyes.current || !pupils.current || !packs.current || !hats.current || !crests.current || !glows.current) return;
    const L = engine.config.arenaSize;
    const t = state.clock.elapsedTime;
    const night = engine.nightProgress;
    const detail = camera.position.y < L * DETAIL_HEIGHT_FRACTION;
    let n = 0;
    let e = 0;
    let p = 0;
    let h = 0;
    let c = 0;
    let g = 0;
    for (const b of engine.blobs) {
      if (n >= BLOB_CAP) break;
      const dead = b.state === 'dead';
      if (dead && night > 0.7) continue;
      const grow = b.newborn ? Math.max(0, easeOutBack(Math.min(1, night * 2.2))) : 1;
      if (grow <= 0.01) continue;
      const r = b.radius * grow;
      const x = b.x - L / 2;
      const z = b.y - L / 2;
      const squash = dead ? 0.3 : 0.85;
      const bob = dead || engine.phase !== 'day' ? 0 : Math.abs(Math.sin(t * 9 + b.id)) * b.throttle * r * 0.3;
      const cy = r * squash + bob;
      dummy.position.set(x, cy, z);
      dummy.rotation.set(0, -b.angle, 0);
      dummy.scale.set(r, r * squash, r);
      dummy.updateMatrix();
      body.current.setMatrixAt(n, dummy.matrix);
      body.current.setColorAt(n, dead ? DEAD : color.set(engine.tribes[b.tribeId].color));
      ids[n++] = b.id;
      if (dead) continue;
      if (b.genes.intelligence >= 1.25 || ((b.job === 'scout' || b.job === 'carrier') && worldClock(engine).dusk > 0.1)) {
        const boost = b.genes.intelligence >= 1.25 ? Math.min(1, (b.genes.intelligence - 1.25) / 1.0) : 0.3;
        dummy.position.set(x, 0.9, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(r * (1.55 + boost * 0.45));
        dummy.updateMatrix();
        glows.current.setMatrixAt(g, dummy.matrix);
        glows.current.setColorAt(g++, color.set(b.genes.intelligence >= 1.25 ? '#c792ea' : '#ffd166'));
      }

      // Job headgear on top of the blob (visible at overview zoom too).
      dummy.rotation.set(0, -b.angle, 0);
      if (b.job === 'forager') {
        dummy.position.set(x, cy + r * 0.92, z);
        dummy.scale.set(r * 0.95, r * 0.22, r * 0.95);
      } else if (b.job === 'soldier') {
        dummy.position.set(x, cy + r * 0.92, z);
        dummy.scale.set(r * 0.72, r * 0.42, r * 0.72);
      } else if (b.job === 'scout') {
        dummy.position.set(x, cy + r * 0.95, z);
        dummy.scale.set(r * 0.65, r * 0.45, r * 0.85);
      } else {
        dummy.position.set(x, cy + r * 0.92, z);
        dummy.scale.set(r * 0.7, r * 0.34, r * 0.7);
      }
      dummy.updateMatrix();
      hats.current.setMatrixAt(h, dummy.matrix);
      hats.current.setColorAt(h++, color.set(JOB_HAT_COLOR[b.job]));

      if (b.job === 'soldier') {
        dummy.position.set(x, cy + r * 1.22, z);
        dummy.scale.set(r * 0.75, r * 0.4, r * 0.26);
      } else if (b.job === 'miner') {
        dummy.position.set(x + Math.cos(b.angle) * r * 0.56, cy + r * 0.98, z + Math.sin(b.angle) * r * 0.56);
        dummy.scale.setScalar(r * 0.26);
      } else if (b.job === 'builder') {
        dummy.position.set(x + Math.cos(b.angle) * r * 0.46, cy + r * 0.86, z + Math.sin(b.angle) * r * 0.46);
        dummy.scale.set(r * 0.34, r * 0.14, r * 0.55);
      } else if (b.job === 'lumberjack' || b.job === 'carrier') {
        dummy.position.set(x, cy + r * 1.12, z);
        dummy.scale.set(r * 0.3, r * 0.28, r * 0.3);
      } else if (b.job === 'scout') {
        dummy.position.set(x - Math.cos(b.angle) * r * 0.42, cy + r * 1.15, z - Math.sin(b.angle) * r * 0.42);
        dummy.scale.set(r * 0.24, r * 0.45, r * 0.24);
      } else {
        dummy.position.set(x, cy + r * 1.08, z);
        dummy.scale.set(r * 0.42, r * 0.22, r * 0.42);
      }
      dummy.updateMatrix();
      crests.current.setMatrixAt(c, dummy.matrix);
      crests.current.setColorAt(c++, color.set(JOB_ACCENT_COLOR[b.job]));

      if (!detail) continue;

      dummy.rotation.set(0, 0, 0);
      for (const side of [-1, 1]) {
        const a = b.angle + side * 0.42;
        const ex = x + Math.cos(a) * r * 0.66;
        const ez = z + Math.sin(a) * r * 0.66;
        const ey = cy + r * 0.3;
        dummy.position.set(ex, ey, ez);
        dummy.scale.setScalar(r * 0.27);
        dummy.updateMatrix();
        eyes.current.setMatrixAt(e++, dummy.matrix);
        dummy.position.set(ex + Math.cos(b.angle) * r * 0.17, ey + r * 0.02, ez + Math.sin(b.angle) * r * 0.17);
        dummy.scale.setScalar(r * 0.14);
        dummy.updateMatrix();
        pupils.current.setMatrixAt(e - 1, dummy.matrix);
      }
      if (b.cargo.type) {
        const s = 2.4 + b.cargo.amount * 1.1;
        dummy.position.set(x - Math.cos(b.angle) * r * 0.85, cy + r * 0.35, z - Math.sin(b.angle) * r * 0.85);
        dummy.rotation.set(0, -b.angle, 0);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        packs.current.setMatrixAt(p, dummy.matrix);
        packs.current.setColorAt(p++, color.set(RESOURCE_COLORS[b.cargo.type]));
      }
    }
    body.current.count = n;
    eyes.current.count = e;
    pupils.current.count = e;
    packs.current.count = p;
    hats.current.count = h;
    crests.current.count = c;
    glows.current.count = g;
    for (const m of [body.current, eyes.current, pupils.current, packs.current, hats.current, crests.current, glows.current]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // Instances move every frame, so the cached bounds used for picking must be recomputed.
    body.current.boundingSphere = null;
  });

  const pick = (ev: ThreeEvent<PointerEvent | MouseEvent>) => (ev.instanceId === undefined ? null : ids[ev.instanceId]);
  return (
    <>
      <instancedMesh
        ref={body}
        args={[undefined, undefined, BLOB_CAP]}
        castShadow
        frustumCulled={false}
        onPointerMove={(ev) => {
          ev.stopPropagation();
          hoverId.current = pick(ev);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          hoverId.current = null;
          document.body.style.cursor = '';
        }}
        onClick={(ev) => {
          if (ev.delta > 5) return;
          ev.stopPropagation();
          const id = pick(ev);
          if (id !== null) onPick(id);
        }}
      >
        <sphereGeometry args={[1, 18, 14]} />
        <meshStandardMaterial roughness={0.45} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={eyes} args={[undefined, undefined, BLOB_CAP * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#f4f7fb" roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={pupils} args={[undefined, undefined, BLOB_CAP * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#131924" />
      </instancedMesh>
      <instancedMesh ref={packs} args={[undefined, undefined, BLOB_CAP]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={hats} args={[undefined, undefined, BLOB_CAP]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.9, 1.05, 1, 12]} />
        <meshStandardMaterial roughness={0.55} />
      </instancedMesh>
      <instancedMesh ref={crests} args={[undefined, undefined, BLOB_CAP]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={glows} args={[undefined, undefined, BLOB_CAP]} frustumCulled={false}>
        <circleGeometry args={[1, 18]} />
        <meshBasicMaterial transparent opacity={0.24} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/** Sense ring and perception lines for the pinned (or hovered) blob. */
function Selection({ engine, pinnedRef, hoverId }: { engine: SimulationEngine; pinnedRef: RefObject<number | null>; hoverId: RefObject<number | null> }) {
  const group = useRef<THREE.Group>(null);
  const sense = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const lines = useRef<THREE.LineSegments>(null);
  const { positions, colors } = useMemo(() => ({ positions: new Float32Array(6 * 2 * 3), colors: new Float32Array(6 * 2 * 3) }), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const L = engine.config.arenaSize;
    const id = pinnedRef.current ?? hoverId.current;
    const b: Blob | undefined = id === null ? undefined : engine.blobs.find((x) => x.id === id);
    if (!group.current || !sense.current || !halo.current || !lines.current) return;
    group.current.visible = !!b;
    if (!b) return;
    const x = b.x - L / 2;
    const z = b.y - L / 2;
    sense.current.position.set(x, 0.8, z);
    sense.current.scale.setScalar(b.genes.senseRadius);
    (sense.current.material as THREE.MeshBasicMaterial).color.set(engine.tribes[b.tribeId].color);
    halo.current.position.set(x, 0.9, z);
    halo.current.scale.setScalar(b.radius + 4);

    let k = 0;
    const seg = (pt: { x: number; y: number } | null, color: string) => {
      if (!pt || b.state !== 'active') return;
      tmp.set(color);
      positions.set([x, 3, z, pt.x - L / 2, 3, pt.y - L / 2], k * 6);
      colors.set([tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b], k * 6);
      k++;
    };
    seg(b.sensed.food, RESOURCE_COLORS.food);
    seg(b.sensed.timber, RESOURCE_COLORS.timber);
    seg(b.sensed.stone, RESOURCE_COLORS.stone);
    seg(b.sensed.ally, engine.tribes[b.tribeId].color);
    seg(b.sensed.threat, '#ff6e64');
    if (b.cargo.type) seg(engine.tribes[b.tribeId].basePosition, '#e7edf6');
    const geo = lines.current.geometry;
    geo.setDrawRange(0, k * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={sense} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.985, 1, 96]} />
        <meshBasicMaterial transparent opacity={0.8} depthWrite={false} />
      </mesh>
      <mesh ref={halo} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.8, 1, 48]} />
        <meshBasicMaterial color="#f4f7fb" transparent opacity={0.9} depthWrite={false} />
      </mesh>
      <lineSegments ref={lines} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial vertexColors transparent opacity={0.85} />
      </lineSegments>
    </group>
  );
}

// ───────────────────────────── Minimap ─────────────────────────────

const MINIMAP = 168;

/** Top-down overview: camps, blobs and the camera's focus. Click or drag to move the camera. */
function Minimap({
  engine,
  controlsRef,
  onFocus,
}: {
  engine: SimulationEngine;
  controlsRef: RefObject<Controls | null>;
  onFocus: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const last = useRef(0);

  useAnimationFrame((now) => {
    if (now - last.current < 80) return;
    last.current = now;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const L = engine.config.arenaSize;
    const dpr = canvas.width / MINIMAP;
    const k = (MINIMAP / L) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(14,19,30,0.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // Water on minimap.
    ctx.strokeStyle = '#255e8a';
    ctx.lineCap = 'round';
    for (const seg of engine.river) {
      ctx.lineWidth = seg.width;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }
    for (const lk of engine.lakes) {
      ctx.fillStyle = '#255e8a';
      ctx.beginPath();
      ctx.arc(lk.x, lk.y, lk.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const n of engine.nodes) {
      if (n.amount < 1) continue;
      ctx.fillStyle = n.type === 'food' ? 'rgba(182,243,107,0.45)' : n.type === 'timber' ? 'rgba(47,107,71,0.8)' : 'rgba(170,179,197,0.6)';
      ctx.fillRect(n.x - 6, n.y - 6, 12, 12);
    }
    for (const t of engine.tribes) {
      if (t.extinct) continue;
      ctx.fillStyle = t.color;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(t.basePosition.x, t.basePosition.y, 165, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillRect(t.basePosition.x - 14, t.basePosition.y - 14, 28, 28);
    }
    for (const b of engine.blobs) {
      if (b.state !== 'active') continue;
      ctx.fillStyle = engine.tribes[b.tribeId].color;
      ctx.fillRect(b.x - 7, b.y - 7, 14, 14);
    }
    const c = controlsRef.current;
    if (c) {
      const tx = c.target.x + L / 2;
      const ty = c.target.z + L / 2;
      const span = Math.max(60, c.object.position.distanceTo(c.target) * 0.8);
      ctx.strokeStyle = 'rgba(244,247,251,0.85)';
      ctx.lineWidth = 2 / (k / dpr);
      ctx.strokeRect(tx - span / 2, ty - span / 2, span, span);
    }
  });

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const L = engine.config.arenaSize;
    onFocus(((e.clientX - rect.left) / rect.width) * L, ((e.clientY - rect.top) / rect.height) * L);
  };

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP * 2}
      height={MINIMAP * 2}
      className="absolute right-2 bottom-2 cursor-crosshair rounded-lg border border-ink-600/70 shadow-xl shadow-black/40"
      style={{ width: MINIMAP, height: MINIMAP }}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => dragging.current && move(e)}
      onPointerUp={() => (dragging.current = false)}
    />
  );
}
