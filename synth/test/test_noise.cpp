#include "../noise.h"
#include "../tone.h" // toneCoefficientQ16
#include "../pins.h" // SAMPLE_RATE_HZ, VOLUME_Q15_ONE
#include "../voices.h" // kPatches
#include "framework.h"
#include <cmath>
#include <complex>
#include <cstdint>
#include <cstdlib>

// A NoiseGenerator for one band, with an envelope that sits at full scale
// from noteOn() on.
static NoiseGenerator makeGenerator(uint8_t levelPercent, uint16_t lowHz, uint16_t highHz) {
  NoiseGenerator generator;
  generator.configure({{0, 0, 100, 0}, levelPercent, lowHz, highHz});
  return generator;
}

// The float digital response of the same cascade, in dB.
static double cascadeDb(uint16_t lowHz, uint16_t highHz, double hz) {
  const double k1 = toneCoefficientQ16(highHz) / 65536.0;
  const double k2 = toneCoefficientQ16(lowHz) / 65536.0;
  const std::complex<double> z1 = std::polar(1.0, -2.0 * M_PI * hz / SAMPLE_RATE_HZ); // z^-1
  const std::complex<double> lp1 = k1 / (1.0 - (1.0 - k1) * z1);
  const std::complex<double> lp2 = k2 / (1.0 - (1.0 - k2) * z1);
  return 20.0 * std::log10(std::abs(lp1 * (1.0 - lp2)));
}

// Measured gain of a 16000-amplitude sine through the fixed-point cascade, in
// dB, from the RMS over the second of two seconds (the first settles).
static double measuredDb(uint16_t lowHz, uint16_t highHz, double hz) {
  NoiseGenerator band = makeGenerator(10, lowHz, highHz);
  const int n = 2 * SAMPLE_RATE_HZ;
  double sumSq = 0.0;
  for (int i = 0; i < n; i++) {
    const int16_t x = (int16_t)(16000.0 * std::sin(2.0 * M_PI * hz * i / SAMPLE_RATE_HZ));
    const int32_t y = band.bandPass(x);
    if (i >= n / 2) sumSq += (double)y * y;
  }
  const double amplitude = std::sqrt(sumSq / (n / 2)) * std::sqrt(2.0);
  return 20.0 * std::log10(amplitude / 16000.0);
}

static void runTests() {
  // Deterministic: two sources produce the same sequence.
  {
    NoiseSource a, b;
    bool same = true;
    for (int i = 0; i < 1000; i++) same &= (a.next() == b.next());
    CHECK(same);
  }

  // Roughly zero-mean and spans most of the int16 range (not stuck).
  {
    NoiseSource noise;
    const int n = 44100;
    int64_t sum = 0;
    int16_t lo = 0, hi = 0;
    for (int i = 0; i < n; i++) {
      int16_t x = noise.next();
      sum += x;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    CHECK(std::abs((double)sum / n) < 500.0);
    CHECK(lo < -30000);
    CHECK(hi > 30000);
  }

  // The bands voices.h uses.
  const uint16_t bands[][2] = {{800, 6000}, {1500, 5000}, {800, 4000}, {2000, 10000}, {100, 1500}, {2000, 8000}};

  // Level: at full envelope and full master volume, the generator's band
  // sample x its block gain at level 10 measures 10% RMS +-0.5 dB over 1 s,
  // after 0.1 s of settling.
  for (const auto &b : bands) {
    NoiseGenerator generator = makeGenerator(10, b[0], b[1]);
    generator.noteOn();
    const int32_t gain = generator.nextBlockGainQ15(VOLUME_Q15_ONE, AUDIO_BLOCK_FRAMES);
    const int settle = SAMPLE_RATE_HZ / 10;
    double sumSq = 0.0;
    for (int i = 0; i < settle + SAMPLE_RATE_HZ; i++) {
      const int32_t y = (generator.nextBandSample() * gain) >> VOLUME_Q15_SHIFT;
      if (i >= settle) sumSq += (double)y * y;
    }
    const double rmsDb = 20.0 * std::log10(std::sqrt(sumSq / SAMPLE_RATE_HZ) / 32768.0);
    CHECK_NEAR(rmsDb, 20.0 * std::log10(0.10), 0.5);
  }

  // Band shape: the fixed-point cascade matches the float response at both
  // corners and a decade below, where it's well down. (A decade above highHz
  // is past Nyquist for all but 100-1500, so not checked.)
  for (const auto &b : bands) {
    for (double hz : {(double)b[0], (double)b[1], b[0] / 10.0}) {
      CHECK_NEAR(measuredDb(b[0], b[1], hz), cascadeDb(b[0], b[1], hz), 0.5);
    }
    CHECK(measuredDb(b[0], b[1], b[0] / 10.0) <= -15.0);
  }

  // Every patch's makeup fits Q15 unclamped.
  for (int p = 0; p < NUM_PATCHES; p++) {
    const NoiseConfig &n = kPatches[p].noise;
    if (n.levelPercent > 0) {
      CHECK(noiseMakeupQ15(n.levelPercent, n.lowHz, n.highHz) < VOLUME_Q15_ONE);
    }
  }
  CHECK(noiseMakeupQ15(0, 800, 6000) == 0);

  // Gain is 0 before any note, and drops to 0 on a switch to a patch
  // without noise mid-note.
  {
    NoiseGenerator generator = makeGenerator(10, 800, 6000);
    CHECK(generator.nextBlockGainQ15(VOLUME_Q15_ONE, AUDIO_BLOCK_FRAMES) == 0);
    generator.noteOn();
    CHECK(generator.nextBlockGainQ15(VOLUME_Q15_ONE, AUDIO_BLOCK_FRAMES) > 0);
    generator.configure(kNoiseNone);
    CHECK(generator.nextBlockGainQ15(VOLUME_Q15_ONE, AUDIO_BLOCK_FRAMES) == 0);
  }

  // No overflow: a full-scale square wave, the worst case for x - LP(x),
  // keeps band x VOLUME_Q15_ONE inside int32.
  for (const auto &b : bands) {
    NoiseGenerator band = makeGenerator(10, b[0], b[1]);
    int64_t worst = 0;
    for (int i = 0; i < SAMPLE_RATE_HZ; i++) {
      const int16_t x = ((i / 50) & 1) ? 32767 : -32768;
      const int64_t y = (int64_t)band.bandPass(x) * VOLUME_Q15_ONE;
      if (std::llabs(y) > worst) worst = std::llabs(y);
    }
    CHECK(worst <= INT32_MAX);
  }
}

TEST_MAIN()
