// JS ports of the firmware's control/display math, shared by every playground.
// Mirrors synth/notes.h and synth/controls_math.cpp; keep in sync by hand.

export const SAMPLE_RATE_HZ = 44100;
export const FREQ_MIN_HZ = 80.0;
export const FREQ_MAX_HZ = 1000.0;
export const ADC_RESOLUTION_BITS = 12;
export const ADC_MAX_COUNT = (1 << ADC_RESOLUTION_BITS) - 1; // 4095
export const ADC_EMA_ALPHA = 0.15;
export const ADC_HYSTERESIS_COUNTS = 4;
export const OLED_VISIBLE_WIDTH = 72;
export const OLED_VISIBLE_HEIGHT = 40;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// notes.h freqToNoteName
export function freqToNoteName(freqHz: number): string {
  const note = Math.round(12.0 * Math.log2(freqHz / 440.0) + 69.0);
  return NOTE_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
}

// controls_math.cpp smoothValue — state mutated in place like the C++ out-params.
export interface SmoothState {
  filtered: number;
  lastRaw: number;
}
export function smoothValue(raw: number, state: SmoothState, hysteresisCounts: number, emaAlpha: number): number {
  if (Math.abs(raw - state.lastRaw) >= hysteresisCounts) {
    state.filtered = state.filtered * (1.0 - emaAlpha) + raw * emaAlpha;
    state.lastRaw = raw;
  }
  return state.filtered;
}

// controls_math.cpp mapPitchHz
export function mapPitchHz(pitchNorm: number, freqMinHz: number, freqMaxHz: number): number {
  return freqMinHz * Math.pow(freqMaxHz / freqMinHz, pitchNorm);
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// A few counts of ADC noise, like a real analogRead(). It is also what lets
// smoothValue's hysteresis gate re-open and converge once a pot stops moving.
export function adcNoise(): number {
  return Math.floor(Math.random() * (2 * ADC_HYSTERESIS_COUNTS + 1)) - ADC_HYSTERESIS_COUNTS;
}
