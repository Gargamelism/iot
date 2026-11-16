// AudioWorklet for the web-sim playground: a port of the early 3-osc firmware's
// oscillator.h/.cpp (256-entry sine table, 32-bit phase-accumulator DDS) and
// mixOscillators. Output 0 is the stereo mix; outputs 1..3 are per-oscillator
// taps (pre-mix, post-volume) for the scopes.
const NUM_OSCILLATORS = 3;
const SINE_TABLE_SIZE = 256;
const SINE_TABLE_AMPLITUDE = 9000;
const PHASE_ACCUMULATOR_RANGE = 4294967296.0; // 2^32
const INT16_MAX = 32767;
const INT16_MIN = -32768;

class WebSimProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sineTable = new Int16Array(SINE_TABLE_SIZE);
    for (let i = 0; i < SINE_TABLE_SIZE; i++) {
      this.sineTable[i] = Math.round(Math.sin((2.0 * Math.PI * i) / SINE_TABLE_SIZE) * SINE_TABLE_AMPLITUDE);
    }
    this.phase = new Uint32Array(NUM_OSCILLATORS);
    this.phaseInc = new Uint32Array(NUM_OSCILLATORS);
    this.vol = new Float32Array(NUM_OSCILLATORS);
    this.samples = new Int16Array(NUM_OSCILLATORS);

    this.port.onmessage = (e) => {
      const { freqHz, volume } = e.data;
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        this.phaseInc[i] = freqHz[i] * (PHASE_ACCUMULATOR_RANGE / sampleRate); // Oscillator::setFrequency
        this.vol[i] = volume[i];
      }
    };
  }

  process(inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1];
    for (let frame = 0; frame < left.length; frame++) {
      let mixed = 0;
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        this.samples[i] = this.sineTable[(this.phase[i] >>> 24) & 0xff]; // top 8 bits
        this.phase[i] = (this.phase[i] + this.phaseInc[i]) >>> 0;
        mixed += this.samples[i] * this.vol[i];
      }
      if (mixed > INT16_MAX) mixed = INT16_MAX;
      if (mixed < INT16_MIN) mixed = INT16_MIN;
      left[frame] = mixed / 32768;
      if (right) right[frame] = left[frame];
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        const tap = outputs[i + 1];
        if (tap && tap[0]) tap[0][frame] = (this.samples[i] / SINE_TABLE_AMPLITUDE) * this.vol[i];
      }
    }
    return true;
  }
}

registerProcessor("web-sim-processor", WebSimProcessor);
