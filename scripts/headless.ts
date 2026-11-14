import { PRESETS } from '../src/engine/config';
import { SimulationEngine } from '../src/engine/SimulationEngine';

const days = Number(process.argv[2] ?? 200);
const overrides = JSON.parse(process.argv[3] ?? '{}');
const only = process.argv[4];
const seeds = Array.from({ length: Number(process.env.SEEDS ?? 3) }, (_, i) => i + 1);
const checkpoints = (process.env.CHECK ?? '1,10,25,50,80,100,150,200,300').split(',').map(Number);
const verbose = process.env.VERBOSE === '1';

for (const preset of PRESETS) {
  if (only && preset.id !== only) continue;
  console.log(`\n=== ${preset.name} ===`);
  for (const seed of seeds) {
    const engine = new SimulationEngine({ ...preset.config, ...overrides, seed });
    const t0 = performance.now();
    for (let d = 0; d < days && !engine.finished; d++) engine.advanceDay();
    const ms = performance.now() - t0;
    const h = engine.history;
    const outcome =
      engine.phase === 'extinct'
        ? ` EXTINCT d${engine.day}`
        : engine.phase === 'won'
          ? ` ${engine.tribes[engine.winnerId!].name.toUpperCase()} WINS d${engine.day}`
          : ` d${engine.day} alive, ${engine.tribes.filter((t) => !t.extinct).length}/${engine.tribes.length} tribes living`;
    console.log(`seed ${seed} [${ms.toFixed(0)}ms${outcome}]`);
    for (const c of checkpoints) {
      const s = h.find((x) => x.day === c);
      if (!s) continue;
      const delivered = s.delivered.food + s.delivered.timber + s.delivered.stone;
      const roles = s.roles;
      const working = roles.gatherer + roles.builder + roles.warrior + roles.idle || 1;
      const pops = s.tribes.map((t) => t.population).filter((p) => p > 0);
      console.log(
        `  d${String(s.day).padStart(4)} ${s.season.padEnd(6)} pop ${String(s.population).padStart(3)} tribes ${s.livingTribes} [${pops.join('/')}]` +
          ` deliv ${String(delivered).padStart(3)} stock f${s.stockpile.food.toFixed(0)} t${s.stockpile.timber} s${s.stockpile.stone} bld ${s.structures}` +
          ` roles g${Math.round((roles.gatherer / working) * 100)}% b${Math.round((roles.builder / working) * 100)}% w${Math.round((roles.warrior / working) * 100)}%` +
          ` deaths ${Object.entries(s.deaths).filter(([, v]) => v).map(([k, v]) => `${k.slice(0, 2)}${v}`).join(' ')} born ${s.born}`,
      );
    }
    for (const w of engine.winters) {
      const rates = w.tribeSurvival.filter((r): r is number => r !== null);
      console.log(
        `  winter y${w.year}: ${w.startPopulation} → ${w.endPopulation}, ${Math.round((w.survived / Math.max(1, w.startPopulation)) * 100)}% survived` +
          ` survival [${rates.map((r) => `${Math.round(r * 100)}%`).join(' ')}]`,
      );
    }
    const counts = { split: 0, wanderers: 0, fell: 0, realm: 0, vassal: 0, rebel: 0, trade: 0, alliance: 0, war: 0, peace: 0, festival: 0, road: 0 };
    for (const e of engine.events) counts[e.kind]++;
    console.log(
      `  events: ${counts.split} splits, ${counts.wanderers} wanderers, ${counts.fell} falls, ${counts.realm} realms, ${counts.vassal} vassals, ${counts.rebel} rebels, ${counts.trade} trade, ${counts.alliance} alliances, ${counts.war} war, ${counts.peace} peace, ${counts.festival} festivals (last ${engine.events.length})`,
    );
    if (verbose) for (const e of engine.events) console.log(`    d${e.day} ${e.text}`);
  }
}
