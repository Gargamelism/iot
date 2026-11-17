# S3 sound upgrades, step 1: 32-bit I2S output, master volume last

Parent: `plans/2026-11-16_s3_sound_upgrades.md`, step 1.

## Context

Today's chain in `audioTask()` (`synth/audio_task.cpp:137-185`) is:

```
voice sample (int16) → [pre-mix distortion] → × (level·master) >>15 → Σ, clamp int16
  → [post-mix distortion] → × envGain >>15 → OnePoleLowpass (int16) → L = R, 16-bit slot
```

The master volume is folded into each voice's Q15 level (`volQ15`, line 143) and the envelope gain
is applied with another `>> 15`, so every attenuation throws away low bits before the DAC. At
10% volume the output carries about 12 effective bits, and during a release tail it carries
fewer still. The filter runs on that already-shrunken int16 signal. The volume pot also steps
once per block, with no ramp.

Relevant constants (all in `synth/pins.h`): `SAMPLE_RATE_HZ = 44100` (line 92),
`AUDIO_BLOCK_FRAMES = 256` (line 100), `VOLUME_Q15_SHIFT = 15`, `VOLUME_Q15_ONE = 32767`
(lines 115-116). Distortion is compiled as `DISTORTION_STAGE_PRE_MIX` (`synth/distortion.h:26`);
`POST_MIX` is the commented-out alternative.

Ranges the design relies on (verified):
- `Envelope::nextBlockGainQ15()` returns 0 .. `VOLUME_Q15_ONE` (`envelope.h:39-41`).
- `Vibrato::amplitudeMultiplier()` is `1 − onset·tremolo%·(0.5+0.5·lfo)` (`vibrato.cpp:32`), so
  it is in [0, 1] and `envGainQ15` stays ≤ 32767.
- `volume` is clamped to [0, 1] in `controls.cpp:232`, so `masterQ15` is 0 .. 32767.

## Design

Keep the whole signal path at full scale in int16, as it is now, and make a single combined
gain multiply the last step. That multiply widens the signal into a 32-bit slot:

```
voice sample → [pre-mix distortion] → × level >>15 → Σ, clamp int16      (full level)
  → [post-mix distortion] → OnePoleLowpass (int16, full level)
  → × gainQ30 (env · tremolo · master, ramped per sample) → int32, top of a 32-bit slot
```

- **`mixOscillators()` is unchanged.** It is passed `s_voiceLevelQ15` directly instead of
  `volQ15`. Normalized levels already guarantee that the full-level mix can't clip
  (`test_oscillator.cpp:97-117`), so the int16 mix loses nothing. This deviates from the parent
  plan's "`mixOscillators()` returns `int32_t`, clamping moves to the end of the chain":
  that change would force the filter and post-mix distortion to int32 as well, without buying
  any resolution, because the mix is already at full scale.
- **The filter moves ahead of the gain.** It is linear, and the gain ramp changes slowly, so
  the sound is the same. The filter now sees a full-scale signal, which also removes its own
  quantization at low gain. `OnePoleLowpass` (`tone.h:27-44`) is unchanged: its Q8 state
  (`x · 256` in int32) has ample room for a full-scale int16 input. One side effect: today the
  filter also smooths the envelope's gain ramp; after the move it doesn't. That's harmless,
  because the gain is already ramped linearly across each 256-frame (5.8 ms) block.
- **Post-mix distortion (only when `DISTORTION_STAGE_POST_MIX` is defined; not the current
  build) now sees the full-level mix whatever the master volume.** Today a lower volume pot
  also lowers its drive. The new behavior matches the pre-mix stage's stated intent ("the drive
  gain means the same thing whatever …"). This change is intended, and the comment notes it.
- **One Q30 gain.** At block rate, `targetGainQ30 = envGainQ15(×tremolo) × masterQ15`. Both
  factors are ≤ 32767, so the product is ≤ 32767² = 1 073 676 289 < 2^30. Because the ramp runs
  directly in Q30 (`step = (target − prev) / AUDIO_BLOCK_FRAMES`), it already has more than
  enough resolution, and `kGainRampFracBits` / `kGainRampFracScale` and their comment
  (`audio_task.cpp:30-36`) are deleted.
  - Edge cases of the ramp:
    - `target − prev` is within ±2^30, so it fits in int32 with no overflow.
    - Integer division truncates toward zero, so a block can end up to 255 Q30 units
      (≈ 2.4·10⁻⁷ of full scale) short of its target. The next block starts from
      `prevGainQ30 = targetGainQ30`, so the error never accumulates. A release that reaches 0
      gives `prev = target = 0` on the next block: exact silence.
    - If the mutex isn't taken, `targetGainQ30` keeps last block's value, so the ramp is flat.
      Today's behavior is the same.
  - The master volume now ramps per sample along with the envelope, which also removes the
    per-block zipper when the volume pot is turned.
- **Output:** `out = (int32_t)(((int64_t)x * gainQ30) >> 14)`. Computed extremes at unity gain
  (32767²): x = 32767 → 2 147 287 045, and x = −32768 → −2 147 352 578. Both are within
  [−2^31, 2^31−1] with no clamp. At full volume the top 16 bits are 32765 / −32767. These match
  today's 16-bit output, which loses the same ~1-2 LSB to its two `>>15` steps, so loudness
  doesn't change. On the S3 this costs one 32×32→64 multiply (2 instructions), a few cycles
  per frame.
- **I2S:** `I2S_DATA_BIT_WIDTH_32BIT`, `I2S_SLOT_MODE_STEREO`, `I2S_MODE_STD` (Philips). This
  gives a 32-bit slot, BCK = 64·fs = 2.822 MHz. The PCM5100 (BCK-PLL, SCK grounded) and the
  MAX98357A both accept 32-bit data at 64·fs. `I2SClass::begin(mode, rate, bits, ch)` is the
  4-argument call already used (`ESP_I2S.h:71`). Only the bit-width argument changes;
  `s_i2s.write()` still takes bytes, so it is passed `sizeof(buffer)` = 2048.

## Steps

Dependency order: **Step 1 first**, because steps 2 and 3 both use `scaleToOutputQ31`. After
that, **steps 2 and 3 are independent and can be done in parallel.** Step 3 runs on the host;
step 2 only builds for the ESP32.

1. **`synth/oscillator.h`** (sequential, ~10 lines).
   - Add the output stage as an inline function directly after the `mixOscillators()`
     declaration, which is the last line of the file (line 93; there is no include guard footer
     after it). That way the host tests can reach it without a new `.cpp`:

     ```cpp
     // Scales a full-level sample by a Q30 gain (0 .. VOLUME_Q15_ONE²) into the top of a
     // 32-bit I2S slot, keeping the low bits that a 16-bit output would drop.
     inline int32_t scaleToOutputQ31(int16_t x, int32_t gainQ30) {
       return (int32_t)(((int64_t)x * gainQ30) >> 14);
     }
     ```

   - Fix the comment on `normalizeVoiceLevelsQ15` (`oscillator.h:83-87`). Its "with every voice
     at its normalized level and the master volume at full" becomes "with every voice at its
     normalized level", plus a note that the master volume is applied after the mix (see
     `scaleToOutputQ31`).
   - The `mixOscillators()` comment (`oscillator.h:90-92`) doesn't mention the master volume,
     so it stays.

2. **`synth/audio_task.cpp`** (parallel with step 3).
   - Delete lines 30-36 (`kGainRampFracBits`, `kGainRampFracScale` and their comment).
   - Line 57: change `int16_t buffer[...]` to `static int32_t buffer[AUDIO_BLOCK_FRAMES * 2];`
     (function-local static, so it lands in .bss and stays private to `audioTask()`). At 2 KB it
     would take half of the 4096 B task stack.
   - Line 59: delete `volQ15[]`.
   - Lines 66-67: change to `int32_t prevGainQ30 = 0;` and `int32_t targetGainQ30 = 0;`. Add
     `int16_t masterQ15 = 0;` alongside them, outside the `for (;;)`. It is only refreshed when
     the mutex is taken, and it starts at 0 to match `g_oscParams.volume = 0.0f` (`controls.cpp:220`).
   - Lines 94-96: comment says "BEFORE computing this block's volQ15". Change it to "before
     this block's mix reads s_voiceLevelQ15".
   - Lines 130-131 and 137-146 become:

     ```
     const int16_t envGainQ15 = (int16_t)(nextBlockGainQ15(...) * amplitudeMultiplier());  // today's expression
     masterQ15 = (int16_t)(volume * VOLUME_Q15_ONE + 0.5f);   // assignment, not a new local
     targetGainQ30 = (int32_t)envGainQ15 * masterQ15;
     for each voice: setFrequency(freq * pitchMultiplier)    // level·master body removed
     ```

     Keep the "only float math off the hot path / muting is the envelope's job" comment. Add a
     line saying the master volume is now part of the ramped output gain.
   - Lines 149-157: the ramp becomes
     `int32_t gainQ30 = prevGainQ30; const int32_t gainStepQ30 = (targetGainQ30 - prevGainQ30) / AUDIO_BLOCK_FRAMES;`.
     The comment becomes: per-sample linear ramp of the combined env·master gain, held directly
     in Q30, so no extra fractional bits are needed, and no zipper on envelope moves or
     volume-pot turns. The "multiplication, not a shift" comment goes with the shift.
   - Frame loop (lines 173-185):

     ```
     mixed = mixOscillators(samples, s_voiceLevelQ15, voiceCount)
     [POST_MIX] mixed = applyDistortion(mixed, distortion)
     mixed = s_toneFilter.process(mixed)
     const int32_t out = scaleToOutputQ31(mixed, gainQ30)
     gainQ30 += gainStepQ30
     buffer[2f] = buffer[2f+1] = out
     ```

   - Line 187: `prevGainQ30 = targetGainQ30;`.
   - Lines 164-166 (pre-mix comment): "before its level and the master volume shrink it" becomes
     "before its level shrinks it (the master volume is applied last, in scaleToOutputQ31)".
     Add a comment at the post-mix block saying it now sees the full-level mix.
   - Line 202: `I2S_DATA_BIT_WIDTH_16BIT` becomes `I2S_DATA_BIT_WIDTH_32BIT`.
   - Lines 209-212 stack comment: the stack now holds only the per-voice frequency and sample
     arrays (`MAX_VOICES` floats + int16s, ~200 B). The 2 KB output buffer is a static, in
     .bss, so 4096 B leaves ample room. The stack size itself is unchanged.

3. **`synth/test/test_oscillator.cpp`** (parallel with step 2). Add a block at the end of
   `runTests()`, after the `mixOscillators` checks (before the closing `}` at line ~149). It
   uses the existing `CHECK` macro from `framework.h`. No `run.sh` change is needed, because
   the function is inline in a header the test already includes.
   - Unity gain `g = VOLUME_Q15_ONE * VOLUME_Q15_ONE` (as `int32_t`):
     - `scaleToOutputQ31(32767, g) == 2147287045` and `scaleToOutputQ31(-32768, g) == -2147352578`.
       Both are exact, both are within the int32 range, and there's no wraparound.
     - Top 16 bits (`>> 16`) are within 2 of the input: 32765 for 32767, and −32767 for −32768.
   - Quiet playing keeps its low bits: at about 1% gain, `g1 = VOLUME_Q15_ONE * 327`
     (master ≈ 1%, env = full):
     - `scaleToOutputQ31(1000, g1) == 653980` and `scaleToOutputQ31(1001, g1) == 654634`. The
       outputs differ.
     - For comparison, today's path gives 9 for both (`(x * (32767*327 >> 15)) >> 15`). A
       comment states this but no check needs it.
   - Gain 0: `scaleToOutputQ31(32767, 0) == 0` and `scaleToOutputQ31(-32768, 0) == 0`.

Out of scope: `player/player.ino` (it stays 16-bit, a standalone sketch), stereo (step 5),
the `pins.h:112-114` Q15 comment (still accurate: it describes per-voice levels). No course
MDX references `volQ15`, the gain ramp or the 16-bit output (grepped), so no docs change.

## Verification

Sequence: run 1 after steps 1+3, run 2 after step 2, and run 3 last, only with the user's
go-ahead.

1. `bash synth/test/run.sh` passes. The new `scaleToOutputQ31` checks are in the
   `test_oscillator` binary.
2. `arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc synth` builds cleanly with no
   new warnings. Note the "Global variables" change: expect about +2 KB, from the static
   `int32_t buffer` (2048 B) moving off the task stack.
3. On the board (**ask before uploading, every time**):
   - At full volume, the line out on headphones plays at the same level as before.
   - SINE and FLT at the bottom of the volume pot sound clean, with no grain or hiss floor.
   - A slow volume-pot sweep has no zipper.
   - A release tail fades smoothly to true silence.
   - The MAX98357A speaker still plays. This confirms both devices lock to 32-bit/64·fs.
