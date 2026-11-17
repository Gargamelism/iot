# S3 sound upgrades, step 2: linearly interpolated table reads

Parent: `plans/2026-11-16_s3_sound_upgrades.md`, step 2. Builds on step 1 (done).

## Context

`Oscillator::nextSample()` (`synth/oscillator.cpp:186-193`) reads `table_[phase_ >> 22]`. It
keeps the top 10 bits of the 32-bit phase and throws away the other 22. That rounds the phase
down by up to one table step (2π/1024). For a 32000-peak sine that is an error of up to about
196 LSB, about 80 LSB RMS (measured: 80.2 at 1 kHz; truncation floors, so the error is
one-sided, A·Δ/√6 rather than the A·Δ/√12 of rounding). The error is periodic, so it shows up as spurs, not as hiss, and you
hear it as grain on `SPREAD_SINE` (SINE, FLT) and on low notes.

Linear interpolation between `table[i]` and `table[i+1]` brings that error down to the
table's curvature error. For a sine that is about A·(2π/1024)²/8 ≈ 0.15 LSB, which is below
int16 quantization. Composite tables with many harmonics gain less, but they always gain.

Measured on the host (scratch probe against the current tables, 1 kHz `SPREAD_SINE`, mip
level 3, 44100 samples, ideal = `lround(32000·sin)`): truncated **80.2 LSB RMS**, interpolated
**1.53 LSB RMS**. The interpolated figure is not interpolation error: the table itself is
**1.22 LSB RMS** off the ideal, because `initSineTable()` truncates toward zero and
`buildTable()`'s `>> VOLUME_Q15_SHIFT` and rescale floor again (a ~−1.5 LSB bias on the
positive half). The floor in the interpolation shift adds ~−0.5 LSB of bias on top.

Facts the design relies on (verified):
- Tables hold full-scale samples bounded by ±`SINE_TABLE_AMPLITUDE` (32000, `pins.h:99`). They
  are malloc'd in `initWavetables()` (`oscillator.cpp:156`), each `WAVETABLE_SIZE` (1024)
  `int16_t`.
- `wavetableBytesAllocated()` (`oscillator.cpp:72-80`) counts `WAVETABLE_SIZE * 2` per table,
  and `test_oscillator.cpp:16` checks the total against `WAVETABLE_RAM_BUDGET_BYTES` (128 KB).
- Nothing else reads the wavetables. `g_sineTable` is used only to build them, so it needs no
  guard sample.
- The walk test (`test_oscillator.cpp:72-84`) runs at 44100/1024 Hz. Its phase increment is
  exactly 2^22, so the fractional bits are always 0. Interpolation returns `table[i]` exactly,
  so the test stays valid unchanged.
- RAM: today 60 tables are built = 122880 bytes against the 131072 budget (measured). The
  guard adds 120 bytes → 123000, still 8072 under budget.
- Overflow headroom: the largest adjacent-entry delta across all 60 built tables is 6843
  (measured), so the 64000 worst case below is a bound, not a near miss.
- `audio_task.cpp` only calls `Oscillator::nextSample()`; no `.cpp/.h/.ino` outside
  `oscillator.cpp` touches `g_wavetable` or `table_` (grepped).
- Baseline: `bash synth/test/run.sh` today → `test_oscillator` 71872/71872, `test_envelope`
  68/70 (lines 101, 106), all others pass.

## Design

**Guard sample.** Each table gets `WAVETABLE_SIZE + 1` entries, with `table[WAVETABLE_SIZE] =
table[0]`. Reading `table[i+1]` then needs no wrap mask on the audio path. This costs 2 bytes per
table, which is noise against the budget.

**Interpolation, 15-bit fraction.**

```cpp
const uint32_t i    = phase_ >> PHASE_INDEX_SHIFT;                 // top 10 bits
const int32_t frac  = (phase_ >> PHASE_FRAC_SHIFT) & PHASE_FRAC_MASK; // next 15 bits
const int32_t a = table_[i], b = table_[i + 1];
const int16_t sample = (int16_t)(a + (((b - a) * frac) >> PHASE_FRAC_BITS));
```

with `PHASE_FRAC_BITS = 15`, `PHASE_FRAC_SHIFT = PHASE_INDEX_SHIFT - PHASE_FRAC_BITS` (7) and
`PHASE_FRAC_MASK = (1 << 15) - 1`.

Why 15 bits and not the parent plan's 16: |b − a| can reach 64000. 64000 × 65535 overflows
int32, while 64000 × 32767 = 2.10e9 < 2^31. Fifteen bits of fraction is already well below the
int16 output resolution, so nothing is lost.

`>>` on a negative `int32_t` is implementation-defined before C++20; GCC (host and Xtensa)
defines it as arithmetic, and C++20 mandates it. No portability shim needed.

**Bound is preserved.** The result always lies between `a` and `b`. The arithmetic shift
floors, and since `frac < 2^15`, `floor((b−a)·frac / 2^15)` stays within [min(0, b−a),
max(0, b−a)]. So the output stays within ±`SINE_TABLE_AMPLITUDE`, and `mixOscillators()`'s
headroom guarantee holds with no change.

**Cost.** Two adjacent 16-bit loads, a subtract, a multiply, a shift and an add: about 6–10
extra cycles per voice, about 320 at 32 voices. The parent plan's budget already counts this.

## Steps

Three independent work units, writable **in parallel** (no unit edits another's file). The
only coupling is that A's `oscillator.cpp` and B's test both use `WAVETABLE_TABLE_ENTRIES`,
which A adds to `oscillator.h`; nothing compiles until A and B are both in, so run
Verification after all three.

- **Unit A** — steps 1 + 2 (`oscillator.cpp`, `oscillator.h`; one person, same API).
- **Unit B** — step 3 (`test/test_oscillator.cpp`).
- **Unit C** — step 4 (docs: `CLAUDE.md`, course modules 06/07).

1. **`synth/oscillator.cpp`**
   - Next to `PHASE_INDEX_SHIFT` (line 11), add `PHASE_FRAC_BITS`, `PHASE_FRAC_SHIFT` and
     `PHASE_FRAC_MASK`, plus a `static_assert(PHASE_FRAC_SHIFT >= 0)`. Replace the line 9-10
     comment so it describes the index plus fraction split.
   - Delete `getIndex()` (lines 15-17). Its only caller is the line `nextSample()` replaces.
   - `buildTable()`: after the final rescale loop (line 127-129), set
     `table[WAVETABLE_SIZE] = table[0];`.
   - `initWavetables()` line 156: `malloc(WAVETABLE_TABLE_ENTRIES * sizeof(int16_t))`.
   - `wavetableBytesAllocated()` line 76: count `WAVETABLE_TABLE_ENTRIES * sizeof(int16_t)`.
   - `nextSample()`: replace the single read with the interpolation above. Keep the
     `table_ == nullptr` guard, and keep `phase_ += phaseInc_` after the read (the sample
     returned is the one at the pre-increment phase, as today).
   - `buildTable()`'s other loops (lines 102, 123, 127) and the harmonic mask at line 107 stay
     on `WAVETABLE_SIZE`: they generate the 1024 real entries; only the guard write uses
     index `WAVETABLE_SIZE`. The peak scan (line 123) must not include the guard (it equals
     `table[0]` anyway, but it isn't written yet at that point).

2. **`synth/oscillator.h`**
   - After `WAVETABLE_SIZE`, add `const int WAVETABLE_TABLE_ENTRIES = WAVETABLE_SIZE + 1; // +1
     guard sample = table[0], so the interpolated read of table[i+1] never wraps`.
   - Header comment (line 10): "one lookup per sample … ~13 cycles/voice" becomes "two
     adjacent lookups, linearly interpolated … ~20 cycles/voice".
   - `nextSample()` comment (line 63): "One table lookup" becomes "Linearly interpolated
     between adjacent table entries, so still".
   - Line 30, "each table is WAVETABLE_SIZE * 2 bytes": change it to
     `WAVETABLE_TABLE_ENTRIES`.
   - `g_wavetable`'s declaration (line 25) is unchanged: still `const int16_t *`, just pointing
     at 1025 entries.

3. **`synth/test/test_oscillator.cpp`**: add one block after the walk test (line 84):
   - **Clarity, 1 kHz `SPREAD_SINE`.** `SPREAD_SINE` is built (patches `kVoicesCleanSine`,
     `kVoicesCleanSines` in `voices.h:109-118`); `mipLevelForFreq(1000.0f)` = 3, which exists
     for it. `CHECK(table != nullptr)` first and skip the block if null. Build the oscillator
     with `begin(SPREAD_SINE)` then `setFrequency(1000.0f)`. Mirror its phase in the test:
     `phase = 0`, `inc = (uint32_t)(1000.0 * (PHASE_ACCUMULATOR_RANGE / SAMPLE_RATE_HZ))` —
     **same parenthesization as `setFrequency()` (`oscillator.cpp:179`)**, or the last bit of
     `inc` can differ and the mirrored phase drifts from `osc`'s. Advance `phase += inc` after
     each sample, matching `nextSample()`. Use `double` sums and `std::lround`/`std::sin`/
     `std::sqrt`/`M_PI` (all via `<cmath>`, already pulled in by `framework.h`). For 44100
     samples, accumulate:
     - the interpolated error: `osc.nextSample() − round(A·sin(2π·phase/2^32))`
     - the truncated error: `table[phase >> 22] − the same ideal`, read straight from
       `g_wavetable[SPREAD_SINE][mipLevelForFreq(1000)]`. This is today's behaviour, kept as
       the reference.

     Here `A` is the table's peak (`SINE_TABLE_AMPLITUDE`). Then check:
     - `rmsInterp * 10 <= rmsTrunc`, which is ≥ 20 dB lower total error. Total residual
       power bounds the largest spur, so this is a stricter version of the parent plan's spur
       check, and it needs no FFT.
     - `rmsInterp < 3.0` in absolute terms. Measured 1.53, dominated by the table's own
       1.22 LSB build error (see Context), so 3.0 leaves margin without masking a real
       regression (truncation is 80).
     - Measured margins for the ratio check: 80.2 / 1.53 ≈ 52× against the required 10×.
     - Every interpolated sample lies within ±`SINE_TABLE_AMPLITUDE`.
   - **Guard sample.** For every non-null `g_wavetable[s][l]`, check `table[WAVETABLE_SIZE]
     == table[0]`. Put it in the existing per-table bounds loop (lines 44-52): change line 48's
     bound to `i < WAVETABLE_TABLE_ENTRIES` so the guard is also bounds-checked, and add the
     equality `CHECK` after the inner loop. Update the comment at lines 41-43 to mention the
     guard.

4. **Docs** (stale statements of "one lookup, no interpolation"; spoiler text only, no
   exercises change):
   - `CLAUDE.md` line 12, tech-stack "Audio out" line: change "a voice costs one lookup per
     sample" to "a voice costs two interpolated lookups per sample".
   - `synth_course/modules/06-dds-oscillator.mdx` lines 140-143 ("Compare (spoiler)"): drop
     "`getIndex()`," (deleted in step 1) and change "`nextSample()` is one lookup with no
     interpolation" to "`nextSample()` linearly interpolates adjacent entries with a 15-bit
     fraction, reading a guard sample instead of wrapping".
   - `synth_course/modules/07-band-limited-wavetables.mdx` lines 214-215: change "a single
     lookup with **no interpolation** into 1,024-entry tables" to "two adjacent lookups,
     **linearly interpolated**, into 1,024(+1 guard)-entry tables".
   - Leave untouched: course stretch goals (06:150, 07:225) and design questions, which pose
     interpolation as an exercise; `plans/2026-09-06_*` (historical record).

Out of scope: higher-order (cubic/Hermite) interpolation, since linear is already below int16
quantization on a sine. Also out of scope: the mip/table-length changes (step 3).

## Verification

1. `bash synth/test/run.sh`: `test_oscillator` passes with the new checks. (`test_envelope`
   has 2 known failures that don't come from this step, at lines 101 and 106.)
2. `arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc synth` builds cleanly. "Global
   variables" should not change (the tables are heap).
3. On the board (**ask before uploading, every time**):
   - `setup()`'s wavetable-bytes print grows by 2 bytes per table, and free heap shrinks by the
     same amount.
   - A/B listen: SINE and FLT, low notes, low volume. The grainy edge should be gone.
   - Optional: the parent plan's one-time cycle-count print, to confirm about +320 cycles per
     frame at 32 voices. Note the course's m06/m07 checklists set "≤ 20 cycles per voice per
     sample" (`06-dds-oscillator.mdx:12`, `07-band-limited-wavetables.mdx:16`); the ~20
     estimate sits right at that line, so report the measured figure. If it exceeds 20, say so
     in one line rather than changing the course criterion.
