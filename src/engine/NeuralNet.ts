export const NN_INPUTS = 8;
export const NN_HIDDEN = 6;
export const NN_OUTPUTS = 2;

export const INPUT_LABELS = ['food ∠', 'food d', 'threat ∠', 'threat d', 'prey ∠', 'home ∠', 'energy', 'full'] as const;
export const OUTPUT_LABELS = ['turn', 'throttle'] as const;

const W1 = 0;
const B1 = W1 + NN_HIDDEN * NN_INPUTS;
const W2 = B1 + NN_HIDDEN;
const B2 = W2 + NN_OUTPUTS * NN_HIDDEN;
const PARAM_COUNT = B2 + NN_OUTPUTS;

/** Per-synapse probability of a full re-roll during mutation. */
const RESET_CHANCE = 0.01;

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
 * Fixed-topology feed-forward net (8 → 6 tanh → 2 tanh). All parameters live in one flat
 * buffer laid out as [W1 (hidden×input) | b1 | W2 (output×hidden) | b2], and `forward`
 * writes into preallocated activation buffers so the hot loop never allocates.
 */
export class NeuralNet {
  static readonly PARAM_COUNT = PARAM_COUNT;

  readonly params: Float32Array;
  /** Activations from the most recent `forward` call, kept for visualisation. */
  readonly input = new Float32Array(NN_INPUTS);
  readonly hidden = new Float32Array(NN_HIDDEN);
  readonly output = new Float32Array(NN_OUTPUTS);

  constructor(params?: Float32Array) {
    this.params = params ?? new Float32Array(PARAM_COUNT);
  }

  static random(rng: RandomSource = mathRandom): NeuralNet {
    const net = new NeuralNet();
    for (let i = 0; i < PARAM_COUNT; i++) net.params[i] = rng.next() * 2 - 1;
    return net;
  }

  forward(inputs: ArrayLike<number>): Float32Array {
    const p = this.params;
    const x = this.input;
    const h = this.hidden;
    const y = this.output;
    for (let i = 0; i < NN_INPUTS; i++) x[i] = inputs[i];
    for (let j = 0; j < NN_HIDDEN; j++) {
      let sum = p[B1 + j];
      const row = W1 + j * NN_INPUTS;
      for (let i = 0; i < NN_INPUTS; i++) sum += p[row + i] * x[i];
      h[j] = Math.tanh(sum);
    }
    for (let k = 0; k < NN_OUTPUTS; k++) {
      let sum = p[B2 + k];
      const row = W2 + k * NN_HIDDEN;
      for (let j = 0; j < NN_HIDDEN; j++) sum += p[row + j] * h[j];
      y[k] = Math.tanh(sum);
    }
    return y;
  }

  /**
   * Copy with each parameter nudged by N(0, strength) with probability `mutationRate`,
   * plus a 1% chance per synapse of being re-rolled uniformly in [-1, 1].
   */
  cloneAndMutate(mutationRate: number, mutationStrength: number, rng: RandomSource = mathRandom): NeuralNet {
    const child = new NeuralNet(new Float32Array(this.params));
    if (mutationRate <= 0 && mutationStrength <= 0) return child;
    const p = child.params;
    for (let i = 0; i < PARAM_COUNT; i++) {
      if (rng.next() < RESET_CHANCE) {
        p[i] = rng.next() * 2 - 1;
      } else if (rng.next() < mutationRate) {
        p[i] += rng.gaussian() * mutationStrength;
      }
    }
    return child;
  }

  inputWeight(hidden: number, input: number): number {
    return this.params[W1 + hidden * NN_INPUTS + input];
  }

  hiddenBias(hidden: number): number {
    return this.params[B1 + hidden];
  }

  outputWeight(output: number, hidden: number): number {
    return this.params[W2 + output * NN_HIDDEN + hidden];
  }

  outputBias(output: number): number {
    return this.params[B2 + output];
  }
}
