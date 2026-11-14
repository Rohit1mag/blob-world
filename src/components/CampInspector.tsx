import type { SimulationEngine } from '../engine/SimulationEngine';
import type { DiplomaticStance, StructureType } from '../engine/types';

interface CampInspectorProps {
  engine: SimulationEngine;
  tribeId: number;
  onClose: () => void;
  onAction: () => void;
}

const STRUCTURE_LABEL: Record<StructureType, string> = {
  townCenter: 'Town Hall',
  granary: 'Granary',
  shelter: 'Shelter',
  barricade: 'Barricade',
  farm: 'Farm',
  workshop: 'Workshop',
  market: 'Market',
  dock: 'Dock',
  bridge: 'Bridge',
  watchtower: 'Tower',
  monument: 'Monument',
  palace: 'Palace',
  factory: 'Factory',
  powerPlant: 'Power Grid',
  lab: 'Research Lab',
  hospital: 'Hospital',
  skyscraper: 'Skyscraper',
};

export function CampInspector({ engine, tribeId, onClose, onAction }: CampInspectorProps) {
  const tribe = engine.tribes[tribeId];
  if (!tribe) return null;
  const realm = engine.realms[tribe.realmId];
  const alive = engine.blobs.filter((b) => b.tribeId === tribeId && b.state === 'active');
  const tier = engine.settlementTier(alive.length, tribeId);
  const structures = engine.structures.filter((s) => s.tribeId === tribeId);
  const builtCounts = new Map<StructureType, number>();
  for (const s of structures) {
    if (s.type === 'townCenter' || !s.built) continue;
    builtCounts.set(s.type, (builtCounts.get(s.type) ?? 0) + 1);
  }
  const otherRealms = engine.realms.filter(
    (r) => r.id !== realm?.id && engine.tribes.some((t) => !t.extinct && t.realmId === r.id),
  );

  const run = (fn: () => void) => {
    fn();
    onAction();
  };

  return (
    <div className="absolute bottom-3 left-3 z-20 w-72 rounded-xl border border-ink-600/80 bg-ink-900/92 p-3 text-[11px] shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: tribe.color }} />
          <div>
            <div className="font-semibold text-ink-200" style={{ color: tribe.color }}>
              {tribe.name}
              {!tribe.extinct && realm && realm.capitalId === tribe.id && realm.tier !== 'chiefdom' && (
                <span className="ml-1 text-amber-300">♛</span>
              )}
            </div>
            <div className="text-[10px] text-ink-400">
              {tribe.extinct
                ? `Ruins · fell day ${tribe.fallenDay}`
                : `${tier} · ${alive.length}/${engine.housing(tribe.id)} pop · ${
                    realm ? `${realm.name} (${realm.tier})` : 'independent'
                  }`}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-[11px] text-ink-500 hover:bg-ink-800 hover:text-ink-200"
          title="Close"
        >
          ✕
        </button>
      </div>

      {!tribe.extinct && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-lg bg-ink-950/60 px-2.5 py-1.5 font-mono text-[10.5px] tabular-nums">
            <div>
              <span className="text-ink-500">Food </span>
              <span className="text-ink-200">{Math.floor(tribe.stockpile.food)}</span>
            </div>
            <div>
              <span className="text-ink-500">Wood </span>
              <span className="text-ink-200">{Math.floor(tribe.stockpile.timber)}</span>
            </div>
            <div>
              <span className="text-ink-500">Stone </span>
              <span className="text-ink-200">{Math.floor(tribe.stockpile.stone)}</span>
            </div>
          </div>

          {realm && realm.capitalId !== tribe.id && (
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-400">
              <span>Loyalty to {realm.name}</span>
              <span className="font-mono text-ink-200">{Math.round(tribe.loyalty * 100)}%</span>
            </div>
          )}

          {builtCounts.size > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {[...builtCounts.entries()].map(([type, count]) => (
                <span key={type} className="rounded bg-ink-800/80 px-1.5 py-0.5 text-[9.5px] text-ink-300">
                  {count > 1 ? `${count}× ` : ''}
                  {STRUCTURE_LABEL[type]}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2.5 border-t border-ink-700/60 pt-2">
            <div className="mb-1 text-[9.5px] font-medium tracking-wider text-ink-500 uppercase">God Tools</div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => run(() => engine.blessHarvest(tribe.id))}
                className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-400/20"
              >
                + Bless Harvest
              </button>
              <button
                type="button"
                onClick={() => run(() => engine.sponsorRoad(tribe.id))}
                className="rounded-md border border-slate-400/30 bg-slate-400/10 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-400/20"
              >
                + Build Road
              </button>
              <button
                type="button"
                onClick={() => run(() => engine.triggerFestival(tribe.id))}
                className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200 hover:bg-amber-400/20"
              >
                ★ Festival
              </button>
            </div>
          </div>

          {realm && otherRealms.length > 0 && (
            <div className="mt-2 border-t border-ink-700/60 pt-2">
              <div className="mb-1 text-[9.5px] font-medium tracking-wider text-ink-500 uppercase">Diplomacy</div>
              <div className="max-h-24 space-y-1 overflow-y-auto pr-0.5">
                {otherRealms.map((other) => {
                  const stance = engine.getStance(realm.id, other.id);
                  const nextAction: { label: string; to: DiplomaticStance; cls: string } =
                    stance === 'war'
                      ? { label: 'Peace', to: 'neutral', cls: 'text-emerald-300 border-emerald-400/30' }
                      : stance === 'neutral'
                        ? { label: 'Trade', to: 'trade', cls: 'text-amber-300 border-amber-400/30' }
                        : stance === 'trade'
                          ? { label: 'Ally', to: 'alliance', cls: 'text-emerald-300 border-emerald-400/30' }
                          : { label: 'War', to: 'war', cls: 'text-rose-300 border-rose-400/30' };
                  return (
                    <div key={other.id} className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate font-medium" style={{ color: other.color }}>
                        {other.name}
                        <span className="ml-1 text-ink-500">({stance})</span>
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => run(() => engine.setDiplomacy(realm.id, other.id, nextAction.to))}
                          className={`rounded border px-1.5 py-0.25 hover:bg-ink-800 ${nextAction.cls}`}
                        >
                          {nextAction.label}
                        </button>
                        {stance !== 'war' && (
                          <button
                            type="button"
                            onClick={() => run(() => engine.setDiplomacy(realm.id, other.id, 'war'))}
                            className="rounded border border-rose-400/30 px-1.5 py-0.25 text-rose-300 hover:bg-ink-800"
                          >
                            War
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
