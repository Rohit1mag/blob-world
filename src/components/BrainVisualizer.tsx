import { useMemo, useRef } from 'react';
import { INPUT_LABELS, OUTPUT_LABELS, type NeuralNet } from '../engine/NeuralNet';
import { useAnimationFrame } from './useAnimationFrame';

const POS = [94, 234, 212];
const NEG = [255, 127, 106];

const W = 240;
const ROW = 9.5;
const X_IN = 50;
const X_HID = 114;
const X_OUT = 168;
const TOP = 6;

function column(n: number, height: number): number[] {
  const step = (height - TOP * 2) / n;
  return Array.from({ length: n }, (_, i) => TOP + step * (i + 0.5));
}

function activationFill(a: number): string {
  const c = a >= 0 ? POS : NEG;
  const m = Math.min(1, Math.abs(a));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.12 + 0.88 * m).toFixed(3)})`;
}

function coopLabel(v: number): string {
  if (v <= -0.3) return 'raid';
  if (v >= 0.2) return 'build';
  return 'gather';
}

interface Synapse {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  weight: number;
  /** Which source activation modulates this line's live opacity. */
  layer: 'input' | 'hidden';
  source: number;
}

/**
 * Live diagram of a blob's brain, sized from the network's own shape. Topology and weights
 * render through React (they only change when a different blob is selected); activations
 * are pushed straight to the DOM every frame.
 */
export function BrainVisualizer({ net }: { net: NeuralNet }) {
  const { inputs: nIn, hidden: nHid, outputs: nOut } = net.shape;
  const height = Math.round(nIn * ROW + TOP * 2);

  const layout = useMemo(() => {
    const yIn = column(nIn, height);
    const yHid = column(nHid, height);
    const yOut = column(nOut, height);
    const synapses: Synapse[] = [];
    for (let h = 0; h < nHid; h++) {
      for (let i = 0; i < nIn; i++) {
        synapses.push({ x1: X_IN, y1: yIn[i], x2: X_HID, y2: yHid[h], weight: net.inputWeight(h, i), layer: 'input', source: i });
      }
    }
    for (let o = 0; o < nOut; o++) {
      for (let h = 0; h < nHid; h++) {
        synapses.push({ x1: X_HID, y1: yHid[h], x2: X_OUT, y2: yOut[o], weight: net.outputWeight(o, h), layer: 'hidden', source: h });
      }
    }
    return { yIn, yHid, yOut, synapses };
  }, [net, nIn, nHid, nOut, height]);

  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const inRefs = useRef<(SVGCircleElement | null)[]>([]);
  const hidRefs = useRef<(SVGCircleElement | null)[]>([]);
  const outRefs = useRef<(SVGCircleElement | null)[]>([]);
  const outText = useRef<(SVGTextElement | null)[]>([]);

  useAnimationFrame(() => {
    for (let i = 0; i < nIn; i++) inRefs.current[i]?.setAttribute('fill', activationFill(net.input[i]));
    for (let h = 0; h < nHid; h++) hidRefs.current[h]?.setAttribute('fill', activationFill(net.hidden[h]));
    for (let o = 0; o < nOut; o++) outRefs.current[o]?.setAttribute('fill', activationFill(net.output[o]));
    const [turn, throttle, coop] = outText.current;
    const out = net.output;
    if (turn) turn.textContent = `${out[0] >= 0 ? '+' : ''}${out[0].toFixed(2)}`;
    if (throttle) throttle.textContent = `${Math.round(((out[1] + 1) / 2) * 100)}%`;
    if (coop) coop.textContent = `${out[2] >= 0 ? '+' : ''}${out[2].toFixed(2)} ${coopLabel(out[2])}`;
    const { synapses } = layout;
    for (let k = 0; k < synapses.length; k++) {
      const s = synapses[k];
      const a = s.layer === 'input' ? net.input[s.source] : net.hidden[s.source];
      const mag = Math.min(1, Math.abs(s.weight) / 2);
      lineRefs.current[k]?.setAttribute('stroke-opacity', (0.03 + mag * (0.12 + 0.65 * Math.min(1, Math.abs(a)))).toFixed(3));
    }
  });

  return (
    <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="block">
      {layout.synapses.map((s, k) => {
        const c = s.weight >= 0 ? POS : NEG;
        return (
          <line
            key={k}
            ref={(el) => void (lineRefs.current[k] = el)}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            stroke={`rgb(${c[0]},${c[1]},${c[2]})`}
            strokeWidth={0.3 + Math.min(3, Math.abs(s.weight)) * 0.45}
            strokeOpacity={0.15}
          />
        );
      })}
      {layout.yIn.map((y, i) => (
        <g key={`i${i}`}>
          <text x={X_IN - 7} y={y} dy="0.32em" textAnchor="end" className="fill-ink-400 font-mono text-[7px]">
            {INPUT_LABELS[i] ?? `in ${i}`}
          </text>
          <circle ref={(el) => void (inRefs.current[i] = el)} cx={X_IN} cy={y} r={3.4} stroke="#55617c" strokeWidth={0.6} />
        </g>
      ))}
      {layout.yHid.map((y, h) => (
        <circle
          key={`h${h}`}
          ref={(el) => void (hidRefs.current[h] = el)}
          cx={X_HID}
          cy={y}
          r={4.2}
          stroke="#55617c"
          strokeWidth={0.6}
        />
      ))}
      {layout.yOut.map((y, o) => (
        <g key={`o${o}`}>
          <circle ref={(el) => void (outRefs.current[o] = el)} cx={X_OUT} cy={y} r={5.5} stroke="#7d89a3" strokeWidth={0.8} />
          <text x={X_OUT + 9} y={y - 4} className="fill-ink-400 font-mono text-[7.5px]">
            {OUTPUT_LABELS[o] ?? `out ${o}`}
          </text>
          <text ref={(el) => void (outText.current[o] = el)} x={X_OUT + 9} y={y + 6} className="fill-ink-200 font-mono text-[8px]" />
        </g>
      ))}
    </svg>
  );
}
