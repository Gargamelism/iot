# S3 sound upgrades: clarity and realism the C3 couldn't afford

## Context

The C3→S3 move (`plans/2026-11-12_c3_to_s3.md`) changed only pins and comments. The DSP is still
sized for the C3. The headroom is now:

- **CPU:** 240 MHz with Core 0 reserved for audio gives 5442 cycles per frame at 44.1 kHz,
  up from 3628 on the C3, and `loop()` no longer competes for that core. The 32-voice worst case
  costs about 416 cycles (about 8%).
- **RAM:** 512 KB SRAM. `WAVETABLE_RAM_BUDGET_BYTES` is still the C3's 128 KB. There is also
  2 MB of quad PSRAM (ESP32-S3FH4R2), but its cache-miss latency rules it out on the audio path.
- **Output:** the PCM5100 is a 32-bit stereo DAC, and the MAX98357A also accepts 32-bit slots.
  `audioTask()` still writes 16-bit samples with L = R.

The current signal chain is: one table read per voice (non-interpolated, 1024 points, one mip per
octave), master volume folded into each voice's Q15 level, a 16-bit mix, one shared amp
envelope, a one-pole low-pass, mono output in 16-bit.

Every step below keeps the DSP **integer-only per sample** (`CLAUDE.md`). Float stays at block
rate, as it is now. Steps are ordered by audible gain per unit of work. Each step can be shipped
and listened to on its own.

Not in this plan: the noise/breath layer (reverted in 9178d0f), splitting voices across
both cores (not needed at this load), the course.

## Cycle and RAM budget

| Step | Cycles/frame (32-voice worst case) | Static RAM |
|---|---|---|
| today | ~416 | 128 KB tables |
| 1. 32-bit output | +5 | 1 KB (buffer doubles) |
| 2. interpolated reads | +~320 | 0 |
| 3. half-octave mips / 2048-pt tables | 0 | up to 4× tables, inside a ~256 KB budget |
| 4. 2-pole resonant filter | +~25 | 0 |
| 5. stereo + reverb | +~250 | ~30 KB |
| 6. per-voice envelopes / strum | +~10 (block rate) | <1 KB |
| 7. attack→sustain spectral morph | +~15 per morphing voice | +1 table set per morphing spread |
| 8. additive partial engine | ~300-900 per note (patch-limited) | ~2 KB |
| 9. oversampled distortion | +~40 per distorted voice | <1 KB |

The worst case after step 7 is still under about 25% of the frame budget. Step 8 sets its own
voice cap.

## Steps

### 1. 32-bit I2S output, master volume last (clarity) — ✅ done 2026-11-17

Detailed plan: `plans/2026-11-17_s3_step1_32bit_output.md`.

The master volume is currently multiplied into each voice's Q15 level before the 16-bit mix
(`audio_task.cpp:140-144`). At 10% volume the signal reaches the DAC with about 12 effective
bits. The fix:

- Mix the voices at full level into an `int32_t` accumulator.
- Apply the envelope gain and master volume to that 32-bit value, then shift it into the top of
  a 32-bit slot.
- Change the I2S setup to `I2S_DATA_BIT_WIDTH_32BIT` and make `buffer` an `int32_t` array.

Quiet playing then keeps full resolution on the line out. `mixOscillators()` returns `int32_t`,
and clamping moves to the end of the chain. **Test:** extend `test_oscillator.cpp`'s mix tests
to cover a quiet mix that keeps its low bits.

### 2. Linear interpolation in `Oscillator::nextSample()` (clarity) — ✅ done 2026-11-17

Detailed plan: `plans/2026-11-17_s3_step2_interpolation.md`.

Truncating the 32-bit phase to a 10-bit index adds phase-truncation spurs about 60 dB down.
They are audible as a grainy edge on sines and low notes (`SPREAD_SINE`, `FLT`). The fix is
to read `table[i]` and `table[i+1]` and blend them using the next 15 bits of the phase (16 would overflow int32). The
wrap is free if each table gets one guard sample (`WAVETABLE_SIZE + 1` entries). The cost is
about 10 cycles per voice. **Test:** a 1 kHz `SPREAD_SINE` rendered on the host should have
its largest spur at least 20 dB lower than it is now.

### 3. Finer mip levels and longer tables (clarity, consistent brightness)

Each octave's table is band-limited for the *top* of that octave. A note near the bottom of
an octave therefore loses its top half-octave of harmonics, and sweeping the pitch pot
produces audible brightness steps at each octave boundary. The changes are:

- Two mip levels per octave (`WAVETABLE_MIP_LEVELS` 9 → 18, `mipLevelForFreq` uses
  `2·log2`). This halves the missing band.
- Optionally, 2048-point tables, which give more resolution to the 64-harmonic bass tables.
- Raise `WAVETABLE_RAM_BUDGET_BYTES` to whatever the `setup()` free-heap print supports.
  Leave at least 64 KB free for step 5. Phase 0's reachable-levels allocation already limits
  the real growth.

**Test:** the existing budget and all-spreads tests, updated to the new level count.

### 4. Two-pole resonant low-pass (realism)

Replace `OnePoleLowpass` with an integer Chamberlin state-variable filter (12 dB/oct) and add a
per-patch `resonanceQ` to `ToneConfig`. A 6 dB slope lets too much top end through even with
the filter closed. A 12 dB slope with mild resonance is what makes a pluck darken the way a
string does, and gives brass its "blat" as it opens. Coefficients stay at block rate through
`toneCutoffHz()`. Clamp the cutoff below about fs/6 for SVF stability, or run the filter
2× oversampled. **Test:** extend `test_tone.cpp` with DC gain = 1, the response at the cutoff,
and stability with Q at its maximum.

### 5. Stereo field and room reverb (realism)

This is the old plan's Phase 7, which is now affordable in stereo:

- **Pan per voice:** add a `pan` field to `VoiceConfig`. Spread detuned unisons (PNO, Pulse,
  Harsh) and chord tones across L/R. This costs one extra multiply-accumulate per voice.
- **Reverb:** a stereo Freeverb (8 combs + 4 all-passes per channel, `int16_t` lines, about
  30 KB of static SRAM, not PSRAM). Add a per-patch `reverbWet` (0-30%). It goes last in the
  chain, after the envelope, so the release tail rings into the room.

Cabling: the PCM5100 jack is unbalanced stereo (tip L, ring R). A TS plug drops R. A TRS cable
into one balanced input plays L−R, which cancels the centred voices. Stereo needs a TRS→2×TS
Y-cable into two inputs, or a stereo input. A mono TS listen still works, but it loses whatever
is panned right, so keep pans moderate. If the MAX98357A is wired back in, set its SD_MODE
resistor to (L+R)/2. **Test:** host tests confirm a silent
input stays silent and an impulse decays below −60 dB within the set RT60.

### 6. Per-voice envelopes: strum and per-string decay (realism)

All voices now share `s_ampEnvelope`, so chords start and stop as a single block. The change
gives each voice its own `Envelope` (stepped at block rate, so the per-sample cost is nothing
new) and adds two per-patch fields:

- `strumMs`: voice n starts n·strumMs after note-on (GTR2, Harmony, Tibia2).
- `decayScale`: higher voices decay faster, as real strings do.

This reuses `Envelope` as it is, and the per-sample gain ramp moves into the voice loop.
**Test:** extend `test_envelope.cpp` to check that delayed starts land on the expected frame.

### 7. Attack→sustain spectral morph (realism)

A low-pass can only darken a sound evenly. Real instruments lose specific partials at
different rates: a piano's upper partials die first, and brass gains its upper partials as
it gets louder. The change:

- Give a spread an optional second weight function (its "attack" spectrum) in
  `harmonic_spreads.h`.
- Build a second table set from it, and have the voice crossfade between the two tables, driven
  by the filter envelope.
- Enable it only for the spreads that gain from it: PIANO, GUITAR, TRUMPET.

This costs one more interpolated read per voice, and RAM for one more table set for each of
those spreads. **Test:** at morph 0 and morph 1 the output matches each table alone.

### 8. Additive partial engine for struck and plucked strings (biggest realism gain, biggest step)

The old plan listed piano inharmonicity as unachievable, but at 5442 cycles per frame it is
affordable. The change:

- Add an `AdditiveVoice` that sums N sine partials from `g_sineTable`. Each partial gets
  its own phase increment and its own exponential decay, both at block rate.
- Each partial's frequency is f·n·√(1+B·n²), the stretched partial series of a real string.
- Weights come from the existing `weightPiano`/`weightGuitar`, so the spectrum stays sourced.
- Use about 16-24 partials per string × 3 unison strings. The cost is about 12 cycles per
  partial, so roughly 600-900 cycles per piano note.

Patches choose between wavetable and additive voices with a flag. Additive patches have a
lower voice cap (`MAX_ADDITIVE_PARTIALS`), checked the same way `patchIsValid` checks voice
counts. Of everything here, this does the most to make PNO and GTR sound like a piano and a
guitar rather than organ stops. **Test:** check the partial frequencies against the formula,
check that the sum never exceeds full scale, and check that each partial's decay hits its
target level at its target time.

### 9. 2× oversampled distortion (clarity on the distorted patches)

`DISTORTION_DRIVE_GAIN 6` hard clipping aliases strongly on high notes. The change upsamples 2×
(zero-stuff plus a short integer half-band FIR), clips, then filters and decimates. Pre-mix
this costs about 40 cycles per distorted voice. That is fine for METL's 2 voices, and any
patch that enables distortion on many voices gets a cap. **Test:** a 3 kHz clipped sine
rendered on the host should have aliased components at least 20 dB lower.

### Carry-over: random harmonic phases (old Phase 6)

This doesn't need the S3, but it is a one-line change to `buildTable()`, and it lowers the
crest factor, which steps 1 and 9 both benefit from. Do it alongside step 3, since both
rebuild the tables.

## Suggested order

1 → 2 → 3 are pure clarity, low risk and can't be heard as "effects". Ship them together.
4 and 5 then do the most for realism per line of code. 6 and 7 follow. 8 is a project on
its own. 9 is only needed if the distorted patches matter.

## Verification

- Run `bash synth/test/run.sh` after each step. Each step lists its new or extended test.
- Run `arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc synth` and track the
  "Global variables" line.
- On the board (**upload only with explicit go-ahead, every time**): record the `setup()` free
  heap. Also add a one-time `Serial.printf` that reports the worst-case cycles per audio block
  (`esp_cpu_get_cycle_count()` around the frame loop) to confirm the budget table above.
  Remove it once the numbers are recorded.
- Listening A/B: SINE and FLT at low volume (steps 1-2), a slow pitch-pot sweep on TPT
  (step 3), GTR and PNO on the gate switch (steps 4, 6, 7, 8), line out on headphones
  (step 5), METL at the top of the pitch range (step 9).
