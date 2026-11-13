import { PRESETS } from '../src/engine/config';
import { SimulationEngine } from '../src/engine/SimulationEngine';

const days = Number(process.argv[2] ?? 60);
const overrides = JSON.parse(process.argv[3] ?? '{}');
const only = process.argv[4];
const seeds = Array.from({ length: Number(process.env.SEEDS ?? 5) }, (_, i) => i + 1);
const checkpoints = [1, 5, 10, 15, 20, 30, 40, 60, 100, 200];

for (const preset of PRESETS) {
  if (only && preset.id !== only) continue;
  console.log(`\n=== ${preset.name} ===`);
  for (const seed of seeds) {
    const engine = new SimulationEngine({ ...preset.config, ...overrides, seed });
    const t0 = performance.now();
    for (let d = 0; d < days && engine.phase !== 'extinct'; d++) engine.advanceDay();
    const ms = performance.now() - t0;
    const h = engine.history;
    const emergence = h.findIndex(
      (_, i) => i >= 5 && h.slice(i - 4, i + 1).reduce((s, x) => s + x.homeRate, 0) / 5 >= 0.5,
    );
    const row = checkpoints
      .filter((i) => i < h.length)
      .map((i) => {
        const s = h[i];
        return `d${s.day}:${s.population}/h${Math.round(s.homeRate * 100)}%/f${s.avgFood.toFixed(1)}${s.backfilled ? `/b${s.backfilled}` : ''}`;
      })
      .join(' ');
    const last = h[h.length - 1];
    console.log(
      `seed ${seed} [${ms.toFixed(0)}ms${engine.phase === 'extinct' ? ' EXTINCT' : ''}] emerge@${emergence < 0 ? '–' : h[emergence].day} ${row}  traits v${last.avgSpeed.toFixed(2)} s${last.avgSize.toFixed(2)} r${last.avgSense.toFixed(0)}`,
    );
  }
}
