// Shared playground engine (AudioWorklet). Integer DDS wavetable voices mixed
// in Q15, the way the firmware does it, so the labs sound like the hardware.
// Main thread -> worklet messages:
//   { type: "tables", set: "name", levels: Int16Array[], baseHz }   a table set; levels.length === 1 → no mip-mapping
//   { type: "voices", voices: [{ set, freqHz, level }] }             level 0..1 (relative)
//   { type: "master", gain }                                         0..1
// Worklet -> main: { type: "status", clipped, levels: [mip level per voice] } a few times a second.
const PHASE_SHIFT = 22; // 1024-entry tables: the top 10 bits of the 32-bit phase are the index
const PHASE_RANGE = 4294967296;
const Q15_ONE = 32767;
const STATUS_EVERY_BLOCKS = 32;

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sets = new Map();
    this.voices = []; // { set, phase, inc, table, levelQ15, mip }
    this.masterQ15 = Q15_ONE;
    this.clipped = false;
    this.blocks = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(msg) {
    if (msg.type === "tables") {
      this.sets.set(msg.set, { levels: msg.levels, baseHz: msg.baseHz ?? 80 });
      for (const v of this.voices) if (v.set === msg.set) this.retune(v, v.freqHz);
    } else if (msg.type === "voices") {
      // keep phases of voices that persist, so changing pitch never clicks
      this.voices = msg.voices.map((spec, i) => {
        const v = this.voices[i] ?? { phase: 0 };
        v.set = spec.set;
        v.levelQ15 = Math.round((spec.level ?? 1) * Q15_ONE);
        this.retune(v, spec.freqHz);
        return v;
      });
    } else if (msg.type === "master") {
      this.masterQ15 = Math.round(Math.max(0, Math.min(1, msg.gain)) * Q15_ONE);
    }
  }

  // Oscillator::setFrequency — new increment and mip level; the phase is untouched.
  retune(v, freqHz) {
    v.freqHz = freqHz;
    v.inc = Math.floor((freqHz * PHASE_RANGE) / sampleRate) >>> 0;
    const set = this.sets.get(v.set);
    if (!set) {
      v.table = null;
      return;
    }
    const n = set.levels.length;
    v.mip = n === 1 || freqHz <= set.baseHz ? 0 : Math.min(n - 1, Math.floor(Math.log2(freqHz / set.baseHz)));
    v.table = set.levels[v.mip];
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1];
    const voices = this.voices;
    for (let i = 0; i < left.length; i++) {
      let mix = 0; // int32 accumulator, as in mixOscillators()
      for (let k = 0; k < voices.length; k++) {
        const v = voices[k];
        if (!v.table) continue;
        mix += (v.table[v.phase >>> PHASE_SHIFT] * v.levelQ15) >> 15;
        v.phase = (v.phase + v.inc) >>> 0;
      }
      mix = (mix * this.masterQ15) >> 15;
      if (mix > 32767) {
        mix = 32767;
        this.clipped = true;
      } else if (mix < -32768) {
        mix = -32768;
        this.clipped = true;
      }
      left[i] = mix / 32768;
      if (right) right[i] = left[i];
    }
    if (++this.blocks % STATUS_EVERY_BLOCKS === 0) {
      this.port.postMessage({ type: "status", clipped: this.clipped, levels: voices.map((v) => v.mip ?? 0) });
      this.clipped = false;
    }
    return true;
  }
}

registerProcessor("engine", EngineProcessor);
