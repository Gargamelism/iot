// Band-limited composite wavetables, the module 07 design (mirrors
// synth/oscillator.cpp buildTable/harmonicsForMipLevel): one period of a
// harmonic sum per octave ("mip level"), each keeping only the harmonics that
// stay under Nyquist at the TOP of its octave, rescaled to a common peak.
import { SAMPLE_RATE_HZ } from "./firmware";

export const TABLE_SIZE = 1024;
export const TABLE_PEAK = 32000; // synth/pins.h SINE_TABLE_AMPLITUDE
export const MIP_BASE_HZ = 80;
export const MIP_LEVELS = 9;

// How many harmonics level `level` may keep (band-limited against its octave's top edge).
export function harmonicsForLevel(level: number, maxHarmonics: number, fs = SAMPLE_RATE_HZ): number {
  const topHz = MIP_BASE_HZ * 2 ** (level + 1);
  return Math.max(1, Math.min(maxHarmonics, Math.floor(fs / 2 / topHz)));
}

// Harmonics a single note at freqHz may keep (the "exact" mode: cut per note).
export function harmonicsForFreq(freqHz: number, maxHarmonics: number, fs = SAMPLE_RATE_HZ): number {
  return Math.max(1, Math.min(maxHarmonics, Math.floor(fs / 2 / freqHz)));
}

export function mipLevelForFreq(freqHz: number): number {
  if (freqHz <= MIP_BASE_HZ) return 0;
  return Math.min(MIP_LEVELS - 1, Math.floor(Math.log2(freqHz / MIP_BASE_HZ)));
}

// One period of Σ weights[h]·sin((h+1)·x) over the first `harmonics` entries,
// rescaled so its largest sample is exactly TABLE_PEAK. weights[0] is the fundamental.
export function buildTable(weights: number[], harmonics: number, size = TABLE_SIZE): Int16Array {
  const sum = new Float64Array(size);
  for (let h = 0; h < Math.min(harmonics, weights.length); h++) {
    const w = weights[h];
    if (w === 0) continue;
    for (let i = 0; i < size; i++) sum[i] += w * Math.sin(((h + 1) * 2 * Math.PI * i) / size);
  }
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(sum[i]));
  const table = new Int16Array(size);
  if (peak === 0) return table;
  for (let i = 0; i < size; i++) table[i] = Math.trunc((sum[i] * TABLE_PEAK) / peak); // truncate: never past the peak
  return table;
}

export function buildMipTables(weights: number[], levels = MIP_LEVELS): Int16Array[] {
  return Array.from({ length: levels }, (_, level) => buildTable(weights, harmonicsForLevel(level, weights.length)));
}

export const tableBytes = (tables: number, size = TABLE_SIZE) => tables * size * 2;
