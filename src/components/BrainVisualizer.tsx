import { useMemo, useRef } from 'react';
import { INPUT_LABELS, NN_HIDDEN, NN_INPUTS, NN_OUTPUTS, OUTPUT_LABELS, type NeuralNet } from '../engine/NeuralNet';
import { useAnimationFrame } from './useAnimationFrame';

const POS = [94, 234, 212];
const NEG = [255, 127, 106];

const W = 224;
const H = 112;
const X_IN = 46;
const X_HID = 118;
const X_OUT = 178;
const TOP = 8;
const BOTTOM = H - 8;

function column(n: number): number[] {
  const step = (BOTTOM - TOP) / n;
  return Array.from({ length: n }, (_, i) => TOP + step * (i + 0.5));
}
const Y_IN = column(NN_INPUTS);
const Y_HID = column(NN_HIDDEN);
const Y_OUT = column(NN_OUTPUTS).map((y, i) => y + (i === 0 ? 14 : -14));

function activationFill(a: number): string {
  const c = a >= 0 ? POS : NEG;
  const m = Math.min(1, Math.abs(a));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.12 + 0.88 * m).toFixed(3)})`;
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
 * Live 8 → 6 → 2 diagram of a blob's brain. Topology and weights render through React
 * (they only change when a different blob is selected); activations are pushed straight
 * to the DOM every frame.
 */
export function BrainVisualizer({ net }: { net: NeuralNet }) {
  const synapses = useMemo<Synapse[]>(() => {
    const out: Synapse[] = [];
    for (let h = 0; h < NN_HIDDEN; h++) {
      for (let i = 0; i < NN_INPUTS; i++) {
        out.push({ x1: X_IN, y1: Y_IN[i], x2: X_HID, y2: Y_HID[h], weight: net.inputWeight(h, i), layer: 'input', source: i });
      }
    }
    for (let o = 0; o < NN_OUTPUTS; o++) {
      for (let h = 0; h < NN_HIDDEN; h++) {
        out.push({ x1: X_HID, y1: Y_HID[h], x2: X_OUT, y2: Y_OUT[o], weight: net.outputWeight(o, h), layer: 'hidden', source: h });
      }
    }
    return out;
  }, [net]);

  const lineRefs = useRef<(SVGLineElement | null)[]>([]);
  const inRefs = useRef<(SVGCircleElement | null)[]>([]);
  const hidRefs = useRef<(SVGCircleElement | null)[]>([]);
  const outRefs = useRef<(SVGCircleElement | null)[]>([]);
  const outText = useRef<(SVGTextElement | null)[]>([]);

  useAnimationFrame(() => {
    for (let i = 0; i < NN_INPUTS; i++) inRefs.current[i]?.setAttribute('fill', activationFill(net.input[i]));
    for (let h = 0; h < NN_HIDDEN; h++) hidRefs.current[h]?.setAttribute('fill', activationFill(net.hidden[h]));
    for (let o = 0; o < NN_OUTPUTS; o++) outRefs.current[o]?.setAttribute('fill', activationFill(net.output[o]));
    const turn = outText.current[0];
    const throttle = outText.current[1];
    if (turn) turn.textContent = `${net.output[0] >= 0 ? '+' : ''}${net.output[0].toFixed(2)}`;
    if (throttle) throttle.textContent = `${Math.round(((net.output[1] + 1) / 2) * 100)}%`;
    for (let k = 0; k < synapses.length; k++) {
      const s = synapses[k];
      const a = s.layer === 'input' ? net.input[s.source] : net.hidden[s.source];
      const mag = Math.min(1, Math.abs(s.weight) / 2);
      lineRefs.current[k]?.setAttribute('stroke-opacity', (0.04 + mag * (0.15 + 0.7 * Math.min(1, Math.abs(a)))).toFixed(3));
    }
  });

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
      {synapses.map((s, k) => {
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
            strokeWidth={0.4 + Math.min(3, Math.abs(s.weight)) * 0.55}
            strokeOpacity={0.2}
          />
        );
      })}
      {Y_IN.map((y, i) => (
        <g key={`i${i}`}>
          <text x={X_IN - 8} y={y} dy="0.32em" textAnchor="end" className="fill-ink-400 font-mono text-[7.5px]">
            {INPUT_LABELS[i]}
          </text>
          <circle ref={(el) => void (inRefs.current[i] = el)} cx={X_IN} cy={y} r={4} stroke="#55617c" strokeWidth={0.6} />
        </g>
      ))}
      {Y_HID.map((y, h) => (
        <circle
          key={`h${h}`}
          ref={(el) => void (hidRefs.current[h] = el)}
          cx={X_HID}
          cy={y}
          r={4.5}
          stroke="#55617c"
          strokeWidth={0.6}
        />
      ))}
      {Y_OUT.map((y, o) => (
        <g key={`o${o}`}>
          <circle ref={(el) => void (outRefs.current[o] = el)} cx={X_OUT} cy={y} r={5.5} stroke="#7d89a3" strokeWidth={0.8} />
          <text x={X_OUT + 9} y={y - 4} className="fill-ink-400 font-mono text-[7.5px]">
            {OUTPUT_LABELS[o]}
          </text>
          <text
            ref={(el) => void (outText.current[o] = el)}
            x={X_OUT + 9}
            y={y + 6}
            className="fill-ink-200 font-mono text-[8.5px]"
          />
        </g>
      ))}
    </svg>
  );
}
