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

  // Interleaved L/R 32-bit slots. Static so its 2 KB lives in .bss, not on
  // the 4096 B task stack.
  static int32_t buffer[AUDIO_BLOCK_FRAMES * 2];
  float freq[MAX_VOICES];
  uint8_t voiceCount = kPatches[0].voiceCount;    // matches audioTaskBegin()'s
  DistortionType distortion = kPatches[0].distortion; // initial applyPatch(0)
  bool distortionEnabled = false;
  uint8_t lastPatchIndex = 0;
  bool lastNoteHeld = false;
  uint8_t lastRetriggerSeq = 0;
  int32_t prevGainQ30 = 0;   // last block's env·master gain, for the per-sample ramp below
  int32_t targetGainQ30 = 0; // this block's env·master gain target
  int16_t masterQ15 = 0;     // matches controls.cpp's initial volume = 0

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
        // Rebuild s_voiceLevelQ15 for the new patch before this block's mix
        // reads s_voiceLevelQ15 — otherwise this block would scale the new
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
      }
      voiceCount = liveVoiceCount;

      // noteHeld going true (or a new diatonic root, controls.cpp) is a
      // note-on candidate; noteHeld going false is a note-off. A pot sweep
      // still counts as a candidate while the switch is open (so the
      // envelope starts fresh from wherever the pot lands once the switch
      // does close), but only actually sounds — calls noteOn() — while
      // noteHeld is true: otherwise sweeping the pot would play notes with
      // the switch off.
      if (retriggerSeq != lastRetriggerSeq) {
        lastRetriggerSeq = retriggerSeq;
        if (noteHeld) {
          s_ampEnvelope.noteOn();
          s_filterEnvelope.noteOn();
          s_vibrato.noteOn();
        }
      }
      if (!noteHeld && lastNoteHeld) {
        s_ampEnvelope.noteOff();
        s_filterEnvelope.noteOff();
      }
      lastNoteHeld = noteHeld;
      s_vibrato.advanceBlock(AUDIO_BLOCK_FRAMES);
      const int16_t envGainQ15 = (int16_t)(s_ampEnvelope.nextBlockGainQ15(AUDIO_BLOCK_FRAMES) *
                                           s_vibrato.amplitudeMultiplier());
      const float filterEnvGain =
          s_filterEnvelope.nextBlockGainQ15(AUDIO_BLOCK_FRAMES) / (float)VOLUME_Q15_ONE;
      s_toneFilter.setCoefficientQ16(
          toneCoefficientQ16(toneCutoffHz(kPatches[patchIndex].tone, filterEnvGain, volume)));

      // Convert the master volume to Q15 once per block (not per sample) so
      // the only float math left is off the per-sample hot path. Muting is
      // now the envelope's job (its release ramps to 0), not noteHeld. The
      // master volume is part of the ramped output gain, applied last.
      masterQ15 = (int16_t)(volume * VOLUME_Q15_ONE + 0.5f);
      targetGainQ30 = (int32_t)envGainQ15 * masterQ15; // <= 32767² < 2^30
      const float pitchMultiplier = s_vibrato.pitchMultiplier();
      for (int voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        s_osc[voiceIndex].setFrequency(freq[voiceIndex] * pitchMultiplier);
      }
    }

    // Per-sample linear ramp of the combined env·master gain from last
    // block's value to this block's target. Held directly in Q30, so no
    // extra fractional bits are needed — and no zipper on envelope moves or
    // volume-pot turns (see envelope.h).
    int32_t gainQ30 = prevGainQ30;
    const int32_t gainStepQ30 = (targetGainQ30 - prevGainQ30) / AUDIO_BLOCK_FRAMES;

    int16_t samples[MAX_VOICES];
    for (int frameIndex = 0; frameIndex < AUDIO_BLOCK_FRAMES; frameIndex++) {
      for (int voiceIndex = 0; voiceIndex < voiceCount; voiceIndex++) {
        samples[voiceIndex] = s_osc[voiceIndex].nextSample();
#if defined(DISTORTION_STAGE_PRE_MIX)
        // Each voice is distorted at full scale, before its level shrinks it
        // (the master volume is applied last, in scaleToOutputQ31) — so the drive gain means the same thing
        // whatever the voice count. Skipped entirely (not called with
        // DIST_NONE) when the encoder has toggled distortion off.
        if (distortionEnabled) {
          samples[voiceIndex] = applyDistortion(samples[voiceIndex], distortion);
        }
#endif
      }
      int16_t mixed = mixOscillators(samples, s_voiceLevelQ15, voiceCount);
#if defined(DISTORTION_STAGE_POST_MIX)
      // Sees the full-level mix whatever the master volume, so the volume
      // pot no longer changes its drive.
      if (distortionEnabled) {
        mixed = applyDistortion(mixed, distortion);
      }
#endif
      mixed = s_toneFilter.process(mixed);
      const int32_t out = scaleToOutputQ31(mixed, gainQ30);
      gainQ30 += gainStepQ30;

      buffer[frameIndex * 2 + 0] = out; // L
      buffer[frameIndex * 2 + 1] = out; // R
    }
    prevGainQ30 = targetGainQ30;

    // Blocking write paces the loop to real time; no delay() needed. If the
    // write comes up short (I2S not started, or a driver error) this
    // max-priority task would otherwise spin Core 0 and starve its idle
    // task, tripping the task watchdog. Yield instead.
    size_t written = s_i2s.write((uint8_t *)buffer, sizeof(buffer));
    if (written < sizeof(buffer)) {
      vTaskDelay(1);
    }
  }
}

void audioTaskBegin() {
  s_i2s.setPins(PIN_I2S_BCK, PIN_I2S_LRCK, PIN_I2S_DOUT);
  s_i2s.begin(I2S_MODE_STD, SAMPLE_RATE_HZ, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);

  applyPatch(0); // matches controls.cpp's initial patchIndex
  s_ampEnvelope.configure(kPatches[0].amp);
  s_filterEnvelope.configure(kPatches[0].tone.filter);
  s_vibrato.configure(kPatches[0].vibrato);

  // The audio task's stack holds the per-voice frequency and sample arrays,
  // sized to MAX_VOICES since any patch can become active at runtime
  // (~200 B); the 2 KB output buffer is static, in .bss, so 4096 B leaves
  // ample room.
  xTaskCreatePinnedToCore(audioTask, "audio", 4096, nullptr, configMAX_PRIORITIES - 1, nullptr, 0);
}
