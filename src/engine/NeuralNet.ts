export interface NetShape {
  inputs: number;
  hidden: number;
  outputs: number;
}

/** Tribal brain: 13 senses + 7 job flags → 8 hidden → turn, throttle, coopAction. */
export const BRAIN_SHAPE: NetShape = { inputs: 20, hidden: 8, outputs: 3 };

export const INPUT_LABELS = [
  'food ∠',
  'food d',
  'wood ∠',
  'wood d',
  'stone ∠',
  'stone d',
  'ally ∠',
  'threat ∠',
  'home ∠',
  'home d',
  'season',
  'cargo',
  'energy',
  'forager',
  'woodcut',
  'miner',
  'builder',
  'soldier',
  'carrier',
  'scout',
] as const;
export const OUTPUT_LABELS = ['turn', 'throttle', 'coop'] as const;

/** Per-synapse probability of a full re-roll during mutation. */
const RESET_CHANCE = 0.003;

export interface RandomSource {
  next(): number;
  gaussian(): number;
}

const mathRandom: RandomSource = {
  next: Math.random,
  gaussian() {
    let u = 0;
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  },
};

/**
 * Fixed-topology feed-forward net (inputs → tanh hidden → tanh outputs). All parameters
 * live in one flat buffer laid out as [W1 (hidden×input) | b1 | W2 (output×hidden) | b2],
 * and `forward` writes into preallocated activation buffers so the hot loop never allocates.
 */
export class NeuralNet {
  readonly shape: NetShape;
  readonly params: Float32Array;
  /** Activations from the most recent `forward` call, kept for visualisation. */
  readonly input: Float32Array;
  readonly hidden: Float32Array;
  readonly output: Float32Array;

  private readonly b1: number;
  private readonly w2: number;
  private readonly b2: number;

  constructor(shape: NetShape = BRAIN_SHAPE, params?: Float32Array) {
    this.shape = shape;
    const { inputs, hidden, outputs } = shape;
    this.b1 = hidden * inputs;
    this.w2 = this.b1 + hidden;
    this.b2 = this.w2 + outputs * hidden;
    const count = this.b2 + outputs;
    if (params && params.length !== count) throw new Error(`Expected ${count} params, got ${params.length}`);
    this.params = params ?? new Float32Array(count);
    this.input = new Float32Array(inputs);
    this.hidden = new Float32Array(hidden);
    this.output = new Float32Array(outputs);
  }

  static random(shape: NetShape = BRAIN_SHAPE, rng: RandomSource = mathRandom): NeuralNet {
    const net = new NeuralNet(shape);
    for (let i = 0; i < net.params.length; i++) net.params[i] = rng.next() * 2 - 1;
    return net;
  }

  forward(inputs: ArrayLike<number>): Float32Array {
    const { inputs: nIn, hidden: nHid, outputs: nOut } = this.shape;
    const p = this.params;
    const x = this.input;
    const h = this.hidden;
    const y = this.output;
    for (let i = 0; i < nIn; i++) x[i] = inputs[i];
    for (let j = 0; j < nHid; j++) {
      let sum = p[this.b1 + j];
      const row = j * nIn;
      for (let i = 0; i < nIn; i++) sum += p[row + i] * x[i];
      h[j] = Math.tanh(sum);
    }
    for (let k = 0; k < nOut; k++) {
      let sum = p[this.b2 + k];
      const row = this.w2 + k * nHid;
      for (let j = 0; j < nHid; j++) sum += p[row + j] * h[j];
      y[k] = Math.tanh(sum);
    }
    return y;
  }

  /**
   * Copy with each parameter nudged by N(0, strength) with probability `mutationRate`,
   * plus a 1% chance per synapse of being re-rolled uniformly in [-1, 1].
   */
  cloneAndMutate(mutationRate: number, mutationStrength: number, rng: RandomSource = mathRandom): NeuralNet {
    const child = new NeuralNet(this.shape, new Float32Array(this.params));
    if (mutationRate <= 0 && mutationStrength <= 0) return child;
    const p = child.params;
    for (let i = 0; i < p.length; i++) {
      if (rng.next() < RESET_CHANCE) {
        p[i] = rng.next() * 2 - 1;
      } else if (rng.next() < mutationRate) {
        p[i] += rng.gaussian() * mutationStrength;
      }
    }
    return child;
  }

  inputWeight(hidden: number, input: number): number {
    return this.params[hidden * this.shape.inputs + input];
  }

  outputWeight(output: number, hidden: number): number {
    return this.params[this.w2 + output * this.shape.hidden + hidden];
  }
}
