#include "../oscillator.h"
#include "../voices.h"
#include "framework.h"
#include <cstring>

// Expected harmonic count per mip level: level L covers the half-octave
// [80 * 2^(L/2), 80 * 2^((L+1)/2)) Hz and keeps only the harmonics that stay
// under Nyquist at the TOP of that range, capped at NUM_HARMONICS (64).
static const int kExpectedHarmonics[WAVETABLE_MIP_LEVELS] = {
    64, 64, 64, 64, 48, 34, 24, 17, 12, 8, 6, 4, 3, 2, 1, 1, 1, 1};

static void runTests() {
  initSineTable();
  CHECK(initWavetables());

  // Phase 0: only the mip levels a patch can actually reach get built.
  // Adding a patch that needs more headroom must fail here, not on the board.
  CHECK(wavetableBytesAllocated() <= (size_t)WAVETABLE_RAM_BUDGET_BYTES);

  // Sine table at the four quadrant boundaries.
  CHECK_NEAR(g_sineTable[0], 0, 5);
  CHECK_NEAR(g_sineTable[SINE_TABLE_SIZE / 4], SINE_TABLE_AMPLITUDE, 5);
  CHECK_NEAR(g_sineTable[SINE_TABLE_SIZE / 2], 0, 5);
  CHECK_NEAR(g_sineTable[3 * SINE_TABLE_SIZE / 4], -SINE_TABLE_AMPLITUDE, 5);

  // Band-limiting: every level's harmonic count matches the pyramid above,
  // and (bar the top level, which keeps a bare fundamental) the highest
  // harmonic stays under Nyquist across the whole level.
  for (int level = 0; level < WAVETABLE_MIP_LEVELS; level++) {
    const int count = harmonicsForMipLevel(level);
    CHECK(count == kExpectedHarmonics[level]);
    const float topHz = WAVETABLE_MIP_BASE_HZ * exp2f((float)(level + 1) / WAVETABLE_MIPS_PER_OCTAVE);
    CHECK(count == 1 || count * topHz < SAMPLE_RATE_HZ / 2.0f);
    // The step's goal: a note at the level's BOTTOM still reaches Nyquist/sqrt2
    // (the next harmonic up would be past it), not Nyquist/2 as with one level
    // per octave.
    if (count > 1 && count < NUM_HARMONICS) {
      const float bottomHz = WAVETABLE_MIP_BASE_HZ * exp2f((float)level / WAVETABLE_MIPS_PER_OCTAVE);
      CHECK(count * bottomHz >= SAMPLE_RATE_HZ / 2.0f / sqrtf(2.0f) - bottomHz);
    }
  }

  // Mip selection over the pyramid's range, including the clamps at both ends.
  CHECK(mipLevelForFreq(80.0f) == 0);
  CHECK(mipLevelForFreq(40.0f) == 0);
  CHECK(mipLevelForFreq(120.0f) == 1); // mid-octave: only half-octave levels split it
  CHECK(mipLevelForFreq(640.0f) == 6);
  CHECK(mipLevelForFreq(1280.0f) == 8);
  CHECK(mipLevelForFreq(21000.0f) == 16);

  // Sharing: a level identical to the one below shares its table, so two
  // distinct non-null pointers on adjacent levels must hold different data.
  // The byte count is checked against an independent distinct-pointer count,
  // not the "differs from below" rule wavetableBytesAllocated() uses.
  {
    const size_t tableBytes = WAVETABLE_TABLE_ENTRIES * sizeof(int16_t);
    size_t uniqueTables = 0;
    bool anyShared = false;
    for (int s = 0; s < SPREAD_COUNT; s++) {
      for (int level = 0; level < WAVETABLE_MIP_LEVELS; level++) {
        const int16_t *table = g_wavetable[s][level];
        if (table == nullptr) continue;
        if (level > 0) {
          const int16_t *below = g_wavetable[s][level - 1];
          if (below != nullptr && below != table) CHECK(memcmp(table, below, tableBytes) != 0);
        }
        bool seen = false;
        for (int prev = 0; prev < level; prev++) {
          if (g_wavetable[s][prev] == table) seen = true;
        }
        if (!seen) uniqueTables++;
      }
      if (g_wavetable[s][0] != nullptr && g_wavetable[s][1] == g_wavetable[s][0]) anyShared = true;
    }
    CHECK(wavetableBytesAllocated() == uniqueTables * tableBytes);
    CHECK(anyShared);
  }

  // Headroom invariant: each table's harmonic weights are normalized to sum
  // to VOLUME_Q15_ONE, so no entry may exceed SINE_TABLE_AMPLITUDE — the
  // bound mixOscillators assumes every voice respects. The guard sample at
  // index WAVETABLE_SIZE is bounds-checked too, and must equal table[0] so
  // the interpolated read of table[i + 1] wraps seamlessly.
  for (int spread = 0; spread < SPREAD_COUNT; spread++) {
    for (int level = 0; level < WAVETABLE_MIP_LEVELS; level++) {
      const int16_t *table = g_wavetable[spread][level];
      if (table == nullptr) continue; // spread not referenced by any kPatches entry
      for (int i = 0; i < WAVETABLE_TABLE_ENTRIES; i++) {
        CHECK(table[i] >= -SINE_TABLE_AMPLITUDE && table[i] <= SINE_TABLE_AMPLITUDE);
      }
      CHECK(table[WAVETABLE_SIZE] == table[0]);
    }
  }

  // Every spread (referenced by a patch or not) yields finite, non-negative
  // weights, and keeps some energy at every mip level — a level whose
  // retained harmonics all weigh 0 would divide by zero in buildTable().
  for (int spread = 0; spread < SPREAD_COUNT; spread++) {
    for (int level = 0; level < WAVETABLE_MIP_LEVELS; level++) {
      const float centreHz = mipLevelCentreHz(level);
      for (int h = 0; h < NUM_HARMONICS; h++) {
        const float w = harmonicWeightTerm(spread, h, (h + 1) * centreHz);
        CHECK(w >= 0.0f && w <= 1.0f);
      }
      float sum = 0.0f;
      for (int h = 0; h < harmonicsForMipLevel(level); h++) {
        sum += harmonicWeightTerm(spread, h, (h + 1) * centreHz);
      }
      CHECK(sum > 0.0f);
    }
  }

  // At freq = SAMPLE_RATE_HZ / WAVETABLE_SIZE the phase increment is exactly
  // 2^32 / WAVETABLE_SIZE, so each nextSample() advances the table index by
  // exactly 1 and the oscillator must walk its table in order, then wrap.
  // kPatches[0].voices[0] is SPREAD_VIOLA, whose weights depend on Hz, so its
  // levels are never shared — the "next level" check below relies on that.
  const HarmonicSpread spread = (HarmonicSpread)kPatches[0].voices[0].spread;
  const float walkHz = (float)SAMPLE_RATE_HZ / WAVETABLE_SIZE;
  const int16_t *walkTable = g_wavetable[spread][mipLevelForFreq(walkHz)];
  Oscillator osc;
  osc.begin(spread);
  osc.setFrequency(walkHz);
  for (int i = 0; i < WAVETABLE_SIZE; i++) {
    CHECK(osc.nextSample() == walkTable[i]);
  }
  CHECK(osc.nextSample() == walkTable[0]); // wrapped

  // Clarity: a 1 kHz SPREAD_SINE read with interpolation must have at least
  // 20 dB less total error against an ideal sine than the old truncated read
  // (table[phase >> 22]). Total residual power bounds the largest spur, so
  // this needs no FFT. Measured: truncated ~80 LSB RMS, interpolated ~1.5,
  // mostly the table's own build error.
  {
    const float clarityHz = 1000.0f;
    const int16_t *table = g_wavetable[SPREAD_SINE][mipLevelForFreq(clarityHz)];
    CHECK(table != nullptr);
    if (table != nullptr) {
      Oscillator sine;
      sine.begin(SPREAD_SINE);
      sine.setFrequency(clarityHz);
      // Same parenthesization as setFrequency(), so the mirrored phase never drifts.
      const uint32_t inc = (uint32_t)((double)clarityHz * (PHASE_ACCUMULATOR_RANGE / SAMPLE_RATE_HZ));
      uint32_t phase = 0;
      double sumInterp = 0.0, sumTrunc = 0.0;
      bool bounded = true;
      for (int n = 0; n < SAMPLE_RATE_HZ; n++) {
        const double ideal = (double)std::lround(
            SINE_TABLE_AMPLITUDE * std::sin(2.0 * M_PI * phase / PHASE_ACCUMULATOR_RANGE));
        const int16_t interp = sine.nextSample();
        const double eInterp = interp - ideal;
        const double eTrunc = table[phase >> 22] - ideal;
        sumInterp += eInterp * eInterp;
        sumTrunc += eTrunc * eTrunc;
        if (interp < -SINE_TABLE_AMPLITUDE || interp > SINE_TABLE_AMPLITUDE) bounded = false;
        phase += inc;
      }
      const double rmsInterp = std::sqrt(sumInterp / SAMPLE_RATE_HZ);
      const double rmsTrunc = std::sqrt(sumTrunc / SAMPLE_RATE_HZ);
      CHECK(rmsInterp * 10.0 <= rmsTrunc);
      CHECK(rmsInterp < 3.0);
      CHECK(bounded);
    }
  }

  // A voice picks its table from the frequency, so the same oscillator reads
  // a shorter harmonic series once it climbs into the next octave.
  osc.setFrequency(FREQ_MAX_HZ);
  CHECK(g_wavetable[spread][mipLevelForFreq(FREQ_MAX_HZ)] != walkTable);

  // freq = 0 (post-begin(), pre-setFrequency) never advances the phase, so
  // every call returns the same table entry.
  Oscillator silent;
  silent.begin(spread);
  CHECK(silent.nextSample() == silent.nextSample());

  // Headroom, the part that made more voices possible: normalized levels sum
  // to at most VOLUME_Q15_ONE, so a full-scale mix of MAX_VOICES voices at
  // full master volume must not reach the clipping rails.
  {
    uint8_t levels[MAX_VOICES];
    int16_t volumes[MAX_VOICES];
    int16_t samples[MAX_VOICES];
    for (int i = 0; i < MAX_VOICES; i++) {
      levels[i] = (uint8_t)(i + 1); // deliberately lopsided
    }
    normalizeVoiceLevelsQ15(levels, MAX_VOICES, volumes);

    int32_t sum = 0;
    for (int i = 0; i < MAX_VOICES; i++) sum += volumes[i];
    CHECK(sum <= VOLUME_Q15_ONE);

    for (int i = 0; i < MAX_VOICES; i++) samples[i] = SINE_TABLE_AMPLITUDE;
    CHECK(mixOscillators(samples, volumes, MAX_VOICES) < INT16_MAX);
    for (int i = 0; i < MAX_VOICES; i++) samples[i] = -SINE_TABLE_AMPLITUDE;
    CHECK(mixOscillators(samples, volumes, MAX_VOICES) > INT16_MIN);
  }

  // A single voice at full level keeps all of the master volume.
  {
    uint8_t levels[1] = {7};
    int16_t volumes[1];
    normalizeVoiceLevelsQ15(levels, 1, volumes);
    CHECK(volumes[0] == VOLUME_Q15_ONE);
  }

  // mixOscillators: positive/negative clipping at the int16_t range.
  {
    int16_t samples[3] = {30000, 30000, 30000};
    int16_t volumes[3] = {VOLUME_Q15_ONE, VOLUME_Q15_ONE, VOLUME_Q15_ONE};
    CHECK(mixOscillators(samples, volumes, 3) == INT16_MAX);
  }
  {
    int16_t samples[3] = {-30000, -30000, -30000};
    int16_t volumes[3] = {VOLUME_Q15_ONE, VOLUME_Q15_ONE, VOLUME_Q15_ONE};
    CHECK(mixOscillators(samples, volumes, 3) == INT16_MIN);
  }
  // mixOscillators: normal (non-clipping) sum, including a muted voice.
  // Q15 volumes: 16384 == 0.5, 8192 == 0.25, 0 == muted.
  {
    int16_t samples[3] = {1000, -1000, 500};
    int16_t volumes[3] = {16384, 16384, 0};
    CHECK(mixOscillators(samples, volumes, 3) == 0);
  }
  {
    int16_t samples[1] = {1000};
    int16_t volumes[1] = {8192};
    CHECK(mixOscillators(samples, volumes, 1) == 250);
  }

  // scaleToOutputQ31: unity gain fills the 32-bit slot without wrapping, and
  // its top 16 bits match the old 16-bit output to within 2 LSB.
  {
    const int32_t g = (int32_t)VOLUME_Q15_ONE * VOLUME_Q15_ONE;
    CHECK(scaleToOutputQ31(32767, g) == 2147287045);
    CHECK(scaleToOutputQ31(-32768, g) == -2147352578);
    CHECK((scaleToOutputQ31(32767, g) >> 16) == 32765);
    CHECK((scaleToOutputQ31(-32768, g) >> 16) == -32767);
  }
  // Quiet playing keeps its low bits: at ~1% master, 1000 and 1001 stay
  // distinct (the old two-step >>15 path gave 9 for both).
  {
    const int32_t g1 = (int32_t)VOLUME_Q15_ONE * 327;
    CHECK(scaleToOutputQ31(1000, g1) == 653980);
    CHECK(scaleToOutputQ31(1001, g1) == 654634);
  }
  // Gain 0 is exact silence.
  CHECK(scaleToOutputQ31(32767, 0) == 0);
  CHECK(scaleToOutputQ31(-32768, 0) == 0);
}

TEST_MAIN()
