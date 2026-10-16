#include "audio_task.h"
#include <ESP_I2S.h>
#include "pins.h"
#include "oscillator.h"
#include "voices.h"
#include "controls.h"
#include "distortion.h"
#include "envelope.h"
#include "tone.h"
#include "vibrato.h"
#include "noise.h"

static I2SClass s_i2s;
static Oscillator s_osc[MAX_VOICES];
// The active patch's relative levels, normalized so the summed mix cannot
// clip however many voices the patch has (see normalizeVoiceLevelsQ15).
// Rebuilt by applyPatch() whenever the encoder switches patches.
static int16_t s_voiceLevelQ15[MAX_VOICES];
// One amplitude envelope for the whole active patch — its voices all
// trigger together (see voices.h: Patch::amp), so they share one gain
// applied to the mixed sample rather than each voice tracking its own.
static Envelope s_ampEnvelope;
// Phase 2 brightness: a second envelope, triggered alongside s_ampEnvelope,
// sweeps the cutoff of one low-pass on the mixed signal (see tone.h).
static Envelope s_filterEnvelope;
static OnePoleLowpass s_toneFilter;
// One LFO for the patch, scaling every voice's pitch (vibrato) and the amp
// envelope's gain (tremolo); restarted at each note-on (see vibrato.h).
static Vibrato s_vibrato;
// Chiff/pick/hammer/breath noise: LCG white noise, band-passed per patch and
// shaped by its own envelope, triggered alongside s_ampEnvelope (see noise.h).
static NoiseGenerator s_noise;

// (Re)points every active voice's oscillator at patchIndex's wavetables and
// rebuilds s_voiceLevelQ15 for its voice count. Called once at startup and
// again whenever audioTask() sees patchIndex change — never on the
// per-sample path. Oscillator::begin() resets phase, so this causes a
// small audible click across affected voices on a patch change (acceptable,
// mirrors what already happens at startup).
static void applyPatch(uint8_t patchIndex) {
  const Patch &patch = kPatches[patchIndex];
  uint8_t levels[MAX_VOICES];
  for (int voiceIndex = 0; voiceIndex < patch.voiceCount; voiceIndex++) {
    levels[voiceIndex] = patch.voices[voiceIndex].level;
    s_osc[voiceIndex].begin((HarmonicSpread)patch.voices[voiceIndex].spread);
  }
  normalizeVoiceLevelsQ15(levels, patch.voiceCount, s_voiceLevelQ15);
}

static void audioTask(void *arg) {
  (void)arg;

  int16_t buffer[AUDIO_BLOCK_FRAMES * 2]; // interleaved L/R
  float freq[MAX_VOICES];
  int16_t volQ15[MAX_VOICES] = {0};
  uint8_t voiceCount = kPatches[0].voiceCount;    // matches audioTaskBegin()'s
  DistortionType distortion = kPatches[0].distortion; // initial applyPatch(0)
  bool distortionEnabled = false;
  uint8_t lastPatchIndex = 0;
  bool lastNoteHeld = false;
  uint8_t seenRetriggerSeq = 0;
  int16_t prevGainQ15 = 0;  // last block's envelope gain, for the per-sample ramp below
  int16_t targetGainQ15 = 0; // this block's envelope gain target
  int16_t prevNoiseGainQ15 = 0;   // last block's noise gain (envelope x makeup x master)
  int16_t targetNoiseGainQ15 = 0; // this block's

  for (int voiceIndex = 0; voiceIndex < MAX_VOICES; voiceIndex++) {
    freq[voiceIndex] = FREQ_MIN_HZ;
  }

  for (;;) {
    // Pick up the latest control values without ever blocking the audio
    // loop; if the control task momentarily holds the mutex, just reuse
    // last block's values (inaudible at block granularity).
    if (xSemaphoreTake(g_paramsMutex, 0) == pdTRUE) {
      bool noteHeld = g_oscParams.noteHeld;
      uint8_t retriggerSeq = g_oscParams.retriggerSeq;
      float volume = g_oscParams.volume;
      uint8_t patchIndex = g_oscParams.patchIndex;
      distortionEnabled = g_oscParams.distortionEnabled;
      // patchIndex and freqHz[] were published together under the same
      // lock in controls.cpp, so reading voiceCount from kPatches here
      // (compile-time data, not shared mutable state) stays consistent
      // with the freqHz entries just copied below.
      const uint8_t liveVoiceCount = kPatches[patchIndex].voiceCount;
      for (int voiceIndex = 0; voiceIndex < liveVoiceCount; voiceIndex++) {
        freq[voiceIndex] = g_oscParams.freqHz[voiceIndex];
      }
      xSemaphoreGive(g_paramsMutex);

      if (patchIndex != lastPatchIndex) {
        // Rebuild s_voiceLevelQ15 for the new patch BEFORE computing this
        // block's volQ15 below — otherwise this block would scale the new
        // voice count against the old patch's stale normalized levels.
        applyPatch(patchIndex);
        lastPatchIndex = patchIndex;
        distortion = kPatches[patchIndex].distortion;
        // Swapped in place, not re-triggered: a patch switch mid-note keeps
        // whatever gain the envelope is currently at (see voices.h's
        // Patch::amp comment / the Phase 1 plan's design decisions).
        s_ampEnvelope.configure(kPatches[patchIndex].amp);
        s_filterEnvelope.configure(kPatches[patchIndex].tone.filter);
        s_vibrato.configure(kPatches[patchIndex].vibrato);
        s_noise.configure(kPatches[patchIndex].noise);
      }
      voiceCount = liveVoiceCount;

      // noteHeld going true (or a new diatonic root, controls.cpp) is a
      // note-on candidate; noteHeld going false is a note-off. A pot sweep
      // still counts as a candidate while the switch is open (so the
      // envelope starts fresh from wherever the pot lands once the switch
      // does close), but only actually sounds — calls noteOn() — while
      // noteHeld is true: otherwise sweeping the pot would play notes with
      // the switch off.
      if (retriggerSeq != seenRetriggerSeq) {
        seenRetriggerSeq = retriggerSeq;
        if (noteHeld) {
          s_ampEnvelope.noteOn();
          s_filterEnvelope.noteOn();
          s_vibrato.noteOn();
          s_noise.noteOn();
        }
      }
      if (!noteHeld && lastNoteHeld) {
        s_ampEnvelope.noteOff();
        s_filterEnvelope.noteOff();
        s_noise.noteOff();
      }
      lastNoteHeld = noteHeld;
      s_vibrato.advanceBlock(AUDIO_BLOCK_FRAMES);
      targetGainQ15 = (int16_t)(s_ampEnvelope.nextBlockGainQ15(AUDIO_BLOCK_FRAMES) *
                                s_vibrato.amplitudeMultiplier());
      const float filterEnvGain =
          s_filterEnvelope.nextBlockGainQ15(AUDIO_BLOCK_FRAMES) / (float)VOLUME_Q15_ONE;
      s_toneFilter.setCoefficientQ16(
          toneCoefficientQ16(toneCutoffHz(kPatches[patchIndex].tone, filterEnvGain, volume)));

      // Convert the master volume to Q15 once per block (not per sample) so
      // the only float math left is off the per-sample hot path. Muting is
      // now the envelope's job (its release ramps to 0), not noteHeld.
      int16_t masterQ15 = (int16_t)(volume * VOLUME_Q15_ONE + 0.5f);
      // Every block, every patch (see NoiseGenerator::nextBlockGainQ15): a
      // switch to a patch without noise makes the target 0, and the ramp
      // below fades the noise out.
      targetNoiseGainQ15 = s_noise.nextBlockGainQ15(masterQ15, AUDIO_BLOCK_FRAMES);
      const float pitchMultiplier = s_vibrato.pitchMultiplier();
      for (int voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        volQ15[voiceIndex] =
            (int16_t)(((int32_t)s_voiceLevelQ15[voiceIndex] * masterQ15) >> VOLUME_Q15_SHIFT);
        s_osc[voiceIndex].setFrequency(freq[voiceIndex] * pitchMultiplier);
      }
    }

    // Per-sample linear ramps from last block's gains to this block's
    // targets — no zipper noise at the block boundary (see envelope.h).
    GainRamp ampRamp;
    ampRamp.begin(prevGainQ15, targetGainQ15, AUDIO_BLOCK_FRAMES);
    GainRamp noiseRamp;
    noiseRamp.begin(prevNoiseGainQ15, targetNoiseGainQ15, AUDIO_BLOCK_FRAMES);
    // Silent at both ends means silent throughout: skip the noise branch.
    const bool noiseActive = prevNoiseGainQ15 != 0 || targetNoiseGainQ15 != 0;

    int16_t samples[MAX_VOICES];
    for (int frameIndex = 0; frameIndex < AUDIO_BLOCK_FRAMES; frameIndex++) {
      for (int voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        samples[voiceIndex] = s_osc[voiceIndex].nextSample();
#if defined(DISTORTION_STAGE_PRE_MIX)
        // Each voice is distorted at full scale, before its level and the
        // master volume shrink it — so the drive gain means the same thing
        // whatever the voice count. Skipped entirely (not called with
        // DIST_NONE) when the encoder has toggled distortion off.
        if (distortionEnabled) {
          samples[voiceIndex] = applyDistortion(samples[voiceIndex], distortion);
        }
#endif
      }
      int16_t mixed = mixOscillators(samples, volQ15, voiceCount);
#if defined(DISTORTION_STAGE_POST_MIX)
      if (distortionEnabled) {
        mixed = applyDistortion(mixed, distortion);
      }
#endif
      mixed = (int16_t)(((int32_t)mixed * ampRamp.next()) >> VOLUME_Q15_SHIFT);
      mixed = s_toneFilter.process(mixed);
      // Added last, after the amp envelope and tone filter, so only the noise
      // envelope shapes it (a chiff can lead the tone) and the clipper never
      // chews it.
      if (noiseActive) {
        const int32_t band = s_noise.nextBandSample();
        int32_t withNoise = mixed + ((band * noiseRamp.next()) >> VOLUME_Q15_SHIFT);
        if (withNoise > INT16_MAX) withNoise = INT16_MAX;
        if (withNoise < INT16_MIN) withNoise = INT16_MIN;
        mixed = (int16_t)withNoise;
      }

      buffer[frameIndex * 2 + 0] = mixed; // L
      buffer[frameIndex * 2 + 1] = mixed; // R
    }
    prevGainQ15 = targetGainQ15;
    prevNoiseGainQ15 = targetNoiseGainQ15;

    // Blocking write paces the loop to real time; no delay() needed. If the
    // write comes up short (I2S not started, or a driver error) this
    // max-priority task would otherwise spin Core 0 — the C3's only core —
    // and freeze loop(), the display, and the liveness LED. Yield instead.
    size_t written = s_i2s.write((uint8_t *)buffer, sizeof(buffer));
    if (written < sizeof(buffer)) {
      vTaskDelay(1);
    }
  }
}

void audioTaskBegin() {
  s_i2s.setPins(PIN_I2S_BCK, PIN_I2S_LRCK, PIN_I2S_DOUT);
  s_i2s.begin(I2S_MODE_STD, SAMPLE_RATE_HZ, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO);

  applyPatch(0); // matches controls.cpp's initial patchIndex
  s_ampEnvelope.configure(kPatches[0].amp);
  s_filterEnvelope.configure(kPatches[0].tone.filter);
  s_vibrato.configure(kPatches[0].vibrato);
  s_noise.configure(kPatches[0].noise);

  // The audio task's stack also holds the per-voice frequency, level and
  // sample arrays, sized to MAX_VOICES since any patch can become active at
  // runtime; 4096 B leaves ample room (MAX_VOICES=32 voices ~ 320 B of
  // arrays).
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, nullptr, configMAX_PRIORITIES - 1, nullptr, 0);
}
