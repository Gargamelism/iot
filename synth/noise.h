#pragma once

#include <stdint.h>
#include "envelope.h" // EnvelopeConfig, Envelope
#include "tone.h"     // OnePoleLowpass

// Per-patch noise (voices.h: Patch::noise): white noise from a linear
// congruential generator, band-passed, scaled to a fixed RMS
// (noiseMakeupQ15) and shaped by its own envelope — a chiff, pick click or
// hammer thump at the note's start, then optional steady breath.
// NoiseGenerator below bundles all of it; audio_task.cpp ramps its block gain
// per sample and adds it after the tone filter, so the noise can lead the tone.
//
// Kept free of Arduino headers so test/run.sh can build it on the host.

struct NoiseConfig {
  EnvelopeConfig env;    // A = rise to peak (ms), D = decay τ (ms), S = steady % of peak, R = release τ (ms)
  uint8_t  levelPercent; // RMS at the envelope peak, % of full scale (0 = off, <= 25)
  uint16_t lowHz;        // high-pass corner
  uint16_t highHz;       // low-pass corner (> lowHz, <= SAMPLE_RATE_HZ / 2)
};
static constexpr NoiseConfig kNoiseNone = {{0, 0, 0, 0}, 0, 20, 20000}; // band unused at level 0

// The Q15 gain that brings LCG noise, low-passed at highHz then high-passed
// at lowHz (each a tone.h OnePoleLowpass; high-pass = x - LP(x)), to
// levelPercent % of full scale RMS. Exact for the digital cascade, from its
// closed-form noise-power gain. Float; call on patch switch, not per sample.
// Clamped to VOLUME_Q15_ONE.
int16_t noiseMakeupQ15(uint8_t levelPercent, uint16_t lowHz, uint16_t highHz);

class NoiseSource {
public:
  // Each call advances the state once and returns its top 16 bits — an
  // LCG's low bits have short periods (bit 0 just alternates).
  int16_t next() {
    state_ = state_ * kMultiplier + kIncrement;
    return (int16_t)(state_ >> 16);
  }

private:
  // Numerical Recipes constants. Full 2^32 period (Hull-Dobell: c odd,
  // a - 1 divisible by 4), and the multiplier scores well on Knuth's
  // spectral test, so consecutive samples are nearly uncorrelated.
  static const uint32_t kMultiplier = 1664525u;
  static const uint32_t kIncrement = 1013904223u;
  // Arbitrary: with a full period every seed is on the same cycle. Fixed
  // so the output is reproducible.
  static const uint32_t kSeed = 22222u;

  uint32_t state_ = kSeed;
};

// One patch's noise: source, band-pass, makeup and envelope. Block rate:
// configure() / noteOn() / noteOff() / nextBlockGainQ15(). Sample rate:
// nextBandSample(), scaled by a per-sample ramp of the block gain.
class NoiseGenerator {
public:
  // Swaps in a patch's band, level and envelope shape. The envelope is
  // reconfigured in place, not re-triggered, like the amp envelope.
  void configure(const NoiseConfig &config);

  void noteOn() { envelope_.noteOn(); }
  void noteOff() { envelope_.noteOff(); }

  // Advances the envelope one block and returns the Q15 gain to reach by the
  // block's end: envelope x makeup x master. Call every block on every patch,
  // even one without noise, so a patch switch mid-note picks the envelope up
  // in a live state; a 0 makeup just makes the gain 0.
  int16_t nextBlockGainQ15(int16_t masterQ15, int frames);

  // The next noise sample through bandPass().
  int32_t nextBandSample() { return bandPass(source_.next()); }

  // Low-passes x at highHz, then high-passes at lowHz as x - LP(x). int32:
  // the difference of two int16s spans +-65535, and times a Q15 gain
  // <= VOLUME_Q15_ONE it peaks just under 2^31. Public so tests can drive it
  // with a sine.
  int32_t bandPass(int16_t x) {
    const int16_t low = lowpass_.process(x);
    return (int32_t)low - highpassLow_.process(low);
  }

private:
  NoiseSource source_;
  OnePoleLowpass lowpass_;     // at highHz
  OnePoleLowpass highpassLow_; // at lowHz; the high-pass is x minus this
  Envelope envelope_;
  int16_t makeupQ15_ = 0;
};
