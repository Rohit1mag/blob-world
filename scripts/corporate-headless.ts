import { CULTURE_PRESETS, CorporateEngine, FLOORS } from '../src/engine/CorporateEngine';

const quarters = Number(process.argv[2] ?? 60);
const overrides = JSON.parse(process.argv[3] ?? '{}');
const seeds = Array.from({ length: Number(process.env.SEEDS ?? 2) }, (_, i) => i + 1);
const f2 = (v: number) => v.toFixed(2);

for (const preset of CULTURE_PRESETS) {
  console.log(`\n=== ${preset.name} ===`);
  for (const seed of seeds) {
    const engine = new CorporateEngine({ ...overrides, culture: preset.id, seed });
    const t0 = performance.now();
    for (let q = 0; q < quarters; q++) engine.advanceQuarter();
    console.log(`seed ${seed} [${(performance.now() - t0).toFixed(0)}ms]`);
    for (const h of engine.history) {
      if (h.quarter === 0 || h.quarter % 15 !== 0) continue;
      const t = h.topDna;
      console.log(
        `  Q${String(h.quarter).padStart(3)} rev ${h.revenue.toFixed(0).padStart(5)} vis ${h.visibility.toFixed(0).padStart(5)} pol ${h.politicalCredit.toFixed(0).padStart(5)}` +
          ` burn ${Math.round(h.avgBurnout * 100)}% med ${h.medicalLeaves} promo ${h.promotions} demo ${h.demotions} pip ${h.pips} lay ${h.layoffs} hire ${h.hires}` +
          ` | top exe ${f2(t.execution)} cha ${f2(t.charisma)} pol ${f2(t.politics)} res ${f2(t.resilience)}`,
      );
    }
    const dna = engine.floorDna();
    console.log(
      '  floors ' +
        dna.map((d, i) => `F${i + 1}(${d.count}/${FLOORS[i].capacity}) ${f2(d.execution)}/${f2(d.charisma)}/${f2(d.politics)}`).join('  '),
    );
    const pivots = engine.events.filter((e) => e.kind === 'pivot').length;
    if (pivots) console.log(`  pivots in last ${engine.events.length} events: ${pivots}`);
  }
}
