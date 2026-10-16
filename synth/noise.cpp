#include "noise.h"
#include "tone.h" // toneCoefficientQ16
#include "pins.h" // VOLUME_Q15_ONE
#include <math.h>

static const float kQ16One = 65536.0f;        // toneCoefficientQ16's 1.0
static const float kQ15One = 32768.0f;        // 1.0 for a gain applied with >> VOLUME_Q15_SHIFT
static const float kInt16FullScale = 32768.0f;
// RMS of a uniform distribution over [-1, 1): 1 / sqrt(3). The LCG's top
// 16 bits are uniform over int16.
static const float kUniformRms = 0.57735027f;
static const float kPercent = 100.0f;

int16_t noiseMakeupQ15(uint8_t levelPercent, uint16_t lowHz, uint16_t highHz) {
  if (levelPercent == 0) {
    return 0;
  }
  // The filters' actual Q16 coefficients, so the gain matches the hardware.
  const float a1 = 1.0f - toneCoefficientQ16(highHz) / kQ16One; // low-pass pole
  const float a2 = 1.0f - toneCoefficientQ16(lowHz) / kQ16One;  // high-pass pole
  // LP(highHz) * (1 - LP(lowHz)) = (1-a1)*a2*(1 - z^-1) / ((1 - a1 z^-1)(1 - a2 z^-1)),
  // so h[n] = (1-a1)*a2*(A a1^n + B a2^n), and the noise-power gain
  // G = sum h[n]^2 is three geometric series. lowHz < highHz keeps a1 != a2.
  const float A = (a1 - 1.0f) / (a1 - a2);
  const float B = (a2 - 1.0f) / (a2 - a1);
  const float scale = (1.0f - a1) * a2;
  const float G = scale * scale *
      (A * A / (1.0f - a1 * a1) + 2.0f * A * B / (1.0f - a1 * a2) + B * B / (1.0f - a2 * a2));

  const float bandRms = kInt16FullScale * kUniformRms * sqrtf(G);
  const float targetRms = levelPercent / kPercent * kInt16FullScale;
  const float gainQ15 = targetRms / bandRms * kQ15One;
  return gainQ15 >= VOLUME_Q15_ONE ? VOLUME_Q15_ONE : (int16_t)(gainQ15 + 0.5f);
}

void NoiseGenerator::configure(const NoiseConfig &config) {
  lowpass_.setCoefficientQ16(toneCoefficientQ16(config.highHz));
  highpassLow_.setCoefficientQ16(toneCoefficientQ16(config.lowHz));
  makeupQ15_ = noiseMakeupQ15(config.levelPercent, config.lowHz, config.highHz);
  envelope_.configure(config.env);
}

int16_t NoiseGenerator::nextBlockGainQ15(int16_t masterQ15, int frames) {
  const int32_t envQ15 = envelope_.nextBlockGainQ15(frames);
  const int32_t levelQ15 = (envQ15 * makeupQ15_) >> VOLUME_Q15_SHIFT;
  return (int16_t)((levelQ15 * masterQ15) >> VOLUME_Q15_SHIFT);
}
