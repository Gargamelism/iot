#pragma once

#include <stddef.h>
#include <stdint.h>
#include "pins.h"
#include "harmonic_spreads.h"  // HarmonicSpread + per-spread weights

// Composite wavetables: one full period of the harmonic sum, precomputed per
// spread per mip level. A voice costs two adjacent lookups, linearly
// interpolated, per sample instead of summing NUM_HARMONICS sine terms, which
// is what makes 32 voices affordable (~20 cycles/voice against a 5442 cycle/frame budget at 240 MHz).
//
// Mip levels band-limit against aliasing: level L covers the half-octave of
// base frequencies [WAVETABLE_MIP_BASE_HZ * 2^(L/2), * 2^((L+1)/2)) and is
// built with only the harmonics that stay under Nyquist across all of that
// range. A level identical to the one below it shares that one's table.
const int WAVETABLE_SIZE = SINE_TABLE_SIZE; // same size as the sine table, so
                                            // building a composite is an exact
                                            // lookup with no resampling
const int WAVETABLE_TABLE_ENTRIES = WAVETABLE_SIZE + 1; // +1 guard sample = table[0], so the
                                                        // interpolated read of table[i+1] never wraps
const int WAVETABLE_MIP_OCTAVES = 9;        // 80 Hz -> Nyquist is log2(22050/80) ~ 8.1 octaves
const int WAVETABLE_MIPS_PER_OCTAVE = 2;
const int WAVETABLE_MIP_LEVELS = WAVETABLE_MIP_OCTAVES * WAVETABLE_MIPS_PER_OCTAVE;
const float WAVETABLE_MIP_BASE_HZ = FREQ_MIN_HZ;

// g_wavetable[spread][level] is null unless some voice in some kPatches
// entry uses that spread — initWavetables() only allocates what any patch
// references.
extern const int16_t *g_wavetable[SPREAD_COUNT][WAVETABLE_MIP_LEVELS];

// Builds the wavetables for every spread any kPatches entry mentions (not
// just the one active at startup, since the encoder can switch patches at
// runtime). Returns false if an allocation failed (each table is
// WAVETABLE_TABLE_ENTRIES * 2 bytes, up to WAVETABLE_MIP_LEVELS per spread;
// levels identical to the one below share its table). Call once from
// setup(), after initSineTable().
bool initWavetables();

// Mip level for a playback frequency, clamped to the pyramid.
int mipLevelForFreq(float freqHz);

// How many harmonics level `level` keeps. Exposed for the band-limiting test.
int harmonicsForMipLevel(int level);

// Geometric centre of level `level`'s half-octave — the fundamental its table's
// harmonic weights are evaluated at.
float mipLevelCentreHz(int level);

// Highest mip level worth building for `spread`: the top of the range any
// kPatches voice using it can be pitched into (FREQ_MAX_HZ plus that voice's
// scale-degree/cents offset, plus vibrato/snap margin). initWavetables()
// only builds up to this per spread; exposed so test_oscillator.cpp can
// recompute the same total and check it against WAVETABLE_RAM_BUDGET_BYTES.
int maxMipLevelForSpread(int spread);

// Total bytes held by g_wavetable's unique non-null tables (a shared table
// counts once) — what initWavetables() actually allocated. setup() prints this next to free
// heap; test_oscillator.cpp checks it against WAVETABLE_RAM_BUDGET_BYTES.
size_t wavetableBytesAllocated();

// Phase-accumulator (DDS) wavetable oscillator, one instance per voice.
class Oscillator {
public:
  void begin(HarmonicSpread spread);
  // Also re-picks the mip level, so this must be called whenever the
  // frequency changes (once per block per voice, off the per-sample path).
  void setFrequency(float freqHz);
  // Linearly interpolated between adjacent table entries, so still bounded by +-SINE_TABLE_AMPLITUDE — the peak
  // mixOscillators assumes each voice respects.
  int16_t nextSample();

private:
  const int16_t *table_ = nullptr;
  uint32_t phase_ = 0;
  uint32_t phaseInc_ = 0;
  uint8_t spread_ = SPREAD_SAW;
};

// Full range of the 32-bit phase accumulator above (2^32), used to convert
// a frequency into a per-sample phase increment.
const double PHASE_ACCUMULATOR_RANGE = 4294967296.0;

// Shared sine lookup table, generated once in initSineTable(). Only used to
// build the wavetables above — nothing reads it on the audio path.
extern int16_t g_sineTable[SINE_TABLE_SIZE];
void initSineTable();

// Normalizes `count` relative voice levels (VoiceConfig::level) into Q15
// weights that sum to at most VOLUME_Q15_ONE. That is the headroom
// guarantee: with every voice at its normalized level, the mix peaks at
// SINE_TABLE_AMPLITUDE no matter how many voices there are, so
// mixOscillators can never clip. The master volume is applied after the mix
// (see scaleToOutputQ31).
void normalizeVoiceLevelsQ15(const uint8_t *levels, int count, int16_t *outQ15);

// Sums `count` oscillator samples, each scaled by its Q15 volume
// (0 .. VOLUME_Q15_ONE), into one clipped int16_t output sample. Integer-only
// by design, so it stays cheap in the per-sample audio loop.
int16_t mixOscillators(const int16_t *samples, const int16_t *volumesQ15, int count);

// Scales a full-level sample by a Q30 gain (0 .. VOLUME_Q15_ONE²) into the top of a
// 32-bit I2S slot, keeping the low bits that a 16-bit output would drop.
inline int32_t scaleToOutputQ31(int16_t x, int32_t gainQ30) {
  return (int32_t)(((int64_t)x * gainQ30) >> 14);
}
