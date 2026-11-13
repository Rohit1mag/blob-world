import { PRESETS } from '../src/engine/config';
import { SimulationEngine } from '../src/engine/SimulationEngine';

const days = Number(process.argv[2] ?? 60);
const overrides = JSON.parse(process.argv[3] ?? '{}');
const only = process.argv[4];
const seeds = [1, 2, 3, 4, 5];

for (const preset of PRESETS) {
  if (only && preset.id !== only) continue;
  console.log(`\n=== ${preset.name} ===`);
  for (const seed of seeds) {
    const engine = new SimulationEngine({ ...overrides, ...preset.config, seed });
    const t0 = performance.now();
    for (let d = 0; d < days && engine.phase !== 'extinct'; d++) engine.advanceDay();
    const ms = performance.now() - t0;
    const h = engine.history;
    const pick = [0, 10, 20, 30, 40, 50, h.length - 1].filter((i, idx, a) => i < h.length && a.indexOf(i) === idx);
    const row = pick
      .map((i) => {
        const s = h[i];
        return `d${s.day}:${s.population}(v${s.avgSpeed.toFixed(2)} s${s.avgSize.toFixed(2)} r${s.avgSense.toFixed(0)} e${s.eaten})`;
      })
      .join('  ');
    console.log(`seed ${seed} [${ms.toFixed(0)}ms${engine.phase === 'extinct' ? ' EXTINCT' : ''}] ${row}`);
  }
}
