# S3 sound upgrades, step 3: half-octave mip levels

Parent: `plans/2026-11-16_s3_sound_upgrades.md`, step 3. Builds on steps 1 and 2 (done).

## Context

Each mip level is band-limited for the *top* of its octave (`harmonicsForMipLevel()`,
`synth/oscillator.cpp:28-35`). A note at the bottom of a level therefore stops at Nyquist/2
(11 kHz) instead of Nyquist. Sweeping the pitch pot makes the brightness step at every octave
boundary: 80, 160, 320, 640 and 1280 Hz, all inside the playable range (`FREQ_MIN_HZ` 80 to
`FREQ_MAX_HZ` 1000, plus voice offsets). With two levels per octave, a note at the bottom of
a level keeps harmonics up to Nyquist/√2 (15.6 kHz). The steps are half as large and twice as
frequent.

Measured on the host (a scratch copy with the changes below applied, current `kPatches`):

| | levels | tables built | bytes |
|---|---|---|---|
| today (1/octave) | 9 | 60 | 123,000 |
| 2/octave, no sharing | 18 | 112 | 229,600 |
| 2/octave, identical levels shared | 18 | 71 unique | **145,550** |

41 of the 112 tables are byte-identical to the level below them. Levels 0-3 all keep 64
harmonics (the `NUM_HARMONICS` cap), and SINE, HAMMOND_TIBIA and HAMMOND_TRUMPET use so few
harmonics that every level they can reach comes out identical. Spreads whose weights depend on Hz (VIOLA,
CLARINET, FLUTE, TRUMPET) are never shared. Sharing a pointer instead of keeping a duplicate
saves 84 KB, which is what makes this step fit next to step 5's reverb.

New harmonic counts per level (measured): `64 64 64 64 48 34 24 17 12 8 6 4 3 2 1 1 1 1`.

Facts the design relies on (verified):
- `mipLevelForFreq()`, `harmonicsForMipLevel()` and `mipLevelCentreHz()` are the only
  places that turn a level into Hz. `maxMipLevelForSpread()` goes through
  `mipLevelForFreq()`, so building only the reachable levels scales with no change.
- The only code that uses `WAVETABLE_MIP_LEVELS` is `oscillator.{h,cpp}` and
  `test_oscillator.cpp`.
- No code frees a wavetable, so pointers that alias each other are safe.
- Per-sample cost is unchanged. The mip level is picked once per block in `setFrequency()`.
- With the prototype applied, every `test_oscillator` check passes except the budget check
  (145,550 > 131,072). Baseline: `test_envelope` already fails 2 checks (lines 101 and 106),
  and nothing else fails.

## Decisions

- **No 2048-point tables.** They would double RAM to about 291 KB for no audible gain. The
  only thing they would improve is the linear-interpolation droop on the 64th harmonic,
  sinc²(64/1024) = −0.11 dB. That harmonic is already about −36 dB on a saw, and its
  interpolation images sit near −60 dB.
- **No random harmonic phases (the parent plan's carry-over), so drop it from step 3.** The
  claim was that random phases lower the crest factor. Measured on level 0 with a fixed LCG
  draw, after the per-table peak rescale, RMS changes by: TRUMPET +7.2 dB, CLARINET +3.2,
  HAMMOND_TRUMPET +1.1, VIOLA +0.2, TRIANGLE −0.3, HAMMOND_TIBIA −0.2, GUITAR −0.7,
  PIANO −0.9, FLUTE −1.3, SQUARE −3.4, PULSATING −3.4. That makes it a per-spread loudness
  rebalance, not a free clarity gain, and it would also change METL's clip character. If it
  is wanted later, it should be a per-spread opt-in, as its own step.
- **`WAVETABLE_MIPS_PER_OCTAVE = 2` as a named constant**, so the formulas read as "level /
  mips per octave" and stay correct if it changes.

## Steps

Every step edits a different file, so they can all be written at the same time:

- **Group A, code (steps 1-4, in parallel):** `oscillator.h`, `oscillator.cpp`, `pins.h` and
  `test_oscillator.cpp`. They only build and pass together, because the header's
  `WAVETABLE_MIPS_PER_OCTAVE` is used by the other three. Land them as one commit.
- **Group B, docs (step 5, in parallel with A):** text only, with no build dependency.
- **Group C, parent plan (step 6, sequential):** do this only after Verification 1-4 pass
  and the user confirms the A/B listening test. That is what "ships" means here.

1. **`synth/oscillator.h`**
   - Add `const int WAVETABLE_MIPS_PER_OCTAVE = 2;` and set `WAVETABLE_MIP_LEVELS = 9 *
     WAVETABLE_MIPS_PER_OCTAVE;`, which covers the same 80 Hz to Nyquist range as before.
   - Header comment (lines 13-15): level L covers
     `[base·2^(L/2), base·2^((L+1)/2))`, a half-octave. Also note that a level identical to
     the one below it shares that one's table.
   - `initWavetables()` comment (line 33): change "9 per spread" to "up to
     WAVETABLE_MIP_LEVELS per spread, levels identical to the one below share its table".
   - `mipLevelCentreHz()` comment: "Geometric centre of level `level`'s half-octave".
   - `wavetableBytesAllocated()` comment: it counts unique tables.

2. **`synth/oscillator.cpp`**
   - `harmonicsForMipLevel()`: `topHz = WAVETABLE_MIP_BASE_HZ * exp2f((float)(level + 1) /
     WAVETABLE_MIPS_PER_OCTAVE)`. In the comment at lines 31-32, change "the level's
     octave" to "the level's range". The rest (`count` floor, clamp to 1..`NUM_HARMONICS`)
     stays as it is.
   - `mipLevelForFreq()`: `floorf(WAVETABLE_MIPS_PER_OCTAVE * log2f(freqHz /
     WAVETABLE_MIP_BASE_HZ))`.
   - `mipLevelCentreHz()`: `exp2f((level + 0.5f) / WAVETABLE_MIPS_PER_OCTAVE)`.
   - `initWavetables()` (lines 157-166, the inner `level` loop): after `buildTable()`, if
     `level > 0` and `g_wavetable[spread][level - 1]` is non-null and `memcmp(table, below,
     WAVETABLE_TABLE_ENTRIES * sizeof(int16_t)) == 0`, call `free(table)`, set
     `g_wavetable[spread][level] = below`, and `continue`. Identical levels are always
     contiguous from level 0 (measured), so comparing with the level directly below is
     enough. Add `#include <string.h>` next to `<stdlib.h>` (line 4). Edge cases:
     - If a `malloc` fails, that level stays null and `ok = false`, as it does today. The
       next level then sees a null below, so it is kept and not shared, which is correct.
     - The existing `if (g_wavetable[spread][level] != nullptr) continue;` guard stays. A
       second call to `initWavetables()` is still a no-op.
     - This only runs at boot, and peak heap during the build is one extra table.
     ```
     for level in 0..maxLevel[spread]:
       if g_wavetable[spread][level]: continue
       table = malloc(...); if !table: ok = false; continue
       buildTable(table, spread, harmonicsForMipLevel(level), mipLevelCentreHz(level))
       below = level > 0 ? g_wavetable[spread][level-1] : null
       if below && memcmp(table, below, bytes) == 0: free(table); g_wavetable[spread][level] = below; continue
       g_wavetable[spread][level] = table
     ```
   - `wavetableBytesAllocated()` (lines 74-81): count a table only if it is non-null **and**
     (`level == 0` or its pointer differs from `g_wavetable[spread][level - 1]`). Pointers
     never alias across spreads, so a per-spread check is enough.

3. **`synth/pins.h:110`**: `WAVETABLE_RAM_BUDGET_BYTES = 160 * 1024`. That is 145,550
   measured plus about 18 KB of room for patch edits. Update the comment to state the
   measured figure.

4. **`synth/test/test_oscillator.cpp`**
   - `kExpectedHarmonics` (line 8): the 18 values above. Update the comment at lines 5-7 to
     describe half-octave levels.
   - Band-limit loop (line 30): `topHz` uses the same `exp2f` formula as step 2.
   - Mip selection (lines 35-39): 80 → 0, 40 → 0, 640 → 6, 1280 → 8, 21000 → 16. Add
     `mipLevelForFreq(120.0f) == 1`, a mid-octave value that only finer levels can tell
     apart. Avoid exact half-octave edges (80·√2·2^k), because they fall on float rounding.
   - **New check (the step's goal):** for every level whose count is below
     `NUM_HARMONICS` and above 1, the highest kept harmonic at the level's *bottom*
     frequency reaches at least Nyquist/√2 − bottomHz. Here bottomHz = `WAVETABLE_MIP_BASE_HZ
     · exp2f((float)level / WAVETABLE_MIPS_PER_OCTAVE)`. This is the "missing band halved"
     claim as a test. With 1 level per octave it would fail.
   - **Sharing:** for every spread and every level > 0, if both pointers are non-null and
     differ, the two tables also differ (`memcmp != 0`). That proves no duplicate was kept.
     Also check that `wavetableBytesAllocated()` equals the unique-pointer count ×
     `WAVETABLE_TABLE_ENTRIES` × `sizeof(int16_t)`. The test recomputes the count itself:
     for each spread, count the distinct non-null pointers in `g_wavetable[spread][*]`
     with an O(n²) scan over 18 entries. Do not reuse the "differs from below" rule. An
     independent count catches a sharing bug that the rule would hide.
     And check that sharing actually happens: at least one spread has
     `g_wavetable[s][1] == g_wavetable[s][0]`. Levels 0 and 1 both keep 64 harmonics, so
     every spread whose weights do not depend on Hz qualifies.
   - The clarity test (1 kHz `SPREAD_SINE`, now level 7), the walk test and the per-table
     bounds loop need no change. They were run against the prototype and pass. The walk
     test's "climbs into the next level" check (`g_wavetable[spread][mipLevelForFreq(
     FREQ_MAX_HZ)] != walkTable`) holds under sharing, because `kPatches[0].voices[0]` is
     `SPREAD_VIOLA` (`voices.h:39`), whose weights depend on Hz, so it is never shared.
     Add a one-line comment saying so, so a later patch reorder that puts SINE first
     fails loudly instead of puzzling someone. The all-spreads weights loop (lines 60-73)
     now runs over 18 levels. Level 17's centre (~34 kHz) is above Nyquist, as level 8's
     (~29 kHz) already was, so nothing new comes up there.
   - The exact octave edges 640 and 1280 are already in today's test and pass with
     `log2f`. They are exact powers of two times 80, so `2·log2f` gives an exact 6.0 / 8.0.

5. **Docs** (statements of the shipped design only, not course exercises):
   - `CLAUDE.md` line 12: change "precomputed per spread per octave" to "precomputed per spread
     per half-octave".
   - `synth/test/README.md`: no change needed ("band-limiting per mip level").
   - `synth_course/modules/07-band-limited-wavetables.mdx` line 209 (spoiler notes, which
     today read "`harmonicsForMipLevel()` band-limits against the **top** of each octave."):
     "band-limits against the **top** of each half-octave level (two per octave). Levels
     that come out identical share one table".
   - Grep-confirmed that nothing else in `synth/` or `CLAUDE.md` mentions one level per
     octave. `synth/scale.h:37` and module 09/15 hits are about musical octaves, not
     mips.
   - Leave unchanged: module 07's exercises, design questions and stretch goals, the notebooks,
     and the Harmonic Lab playground. They teach one-per-octave as the student's design
     choice and pose finer levels as a question.

6. **Parent plan** (`plans/2026-11-16_s3_sound_upgrades.md`): mark step 3 done when it ships,
   link this plan, replace the RAM cell for row 3 with the measured 145.5 KB, and update the
   carry-over section with the measured result above (it is deferred, not done with step 3).
   The exact spots:
   - Line 11: "`WAVETABLE_RAM_BUDGET_BYTES` is still the C3's 128 KB" → 160 KB (step 3).
   - Line 34 (table row 3): "up to 4× tables, inside a ~256 KB budget" → "145.5 KB tables
     (+22.5 KB), 160 KB budget; 2048-pt tables dropped".
   - Step 3 section (around lines 78-86): add "**Done** — see
     `plans/2026-11-18_s3_step3_half_octave_mips.md`". Mark the "Optionally, 2048-point
     tables" bullet as rejected, with the −0.11 dB reason.
   - Carry-over section (lines 171-175): replace "Do it alongside step 3" with the measured
     per-spread RMS deltas, and say it is deferred as a per-spread opt-in.

## Verification

1. `bash synth/test/run.sh`: `test_oscillator` passes all checks. `test_envelope` keeps its
   2 known failures.
2. `arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc synth` builds cleanly.
   "Global variables" goes up by 576 bytes (9 more pointers × 16 spreads × 4 bytes). The
   tables live on the heap.
3. Free-heap check (a printout, no flashing): the firmware running now prints `free heap` in
   `setup()`. Step 3 lowers it by about 22.5 KB (145,550 − 123,000). The parent plan wants
   ≥ 64 KB left for step 5, so today's reading must be ≥ about 87 KB. Read it off the serial
   console before uploading. The source is `synth/synth.ino:31`, the line `wavetables: N
   bytes (budget B), free heap F bytes`, printed right after `initWavetables()`. Open
   the serial monitor (`arduino-cli monitor -p <port> -c baudrate=<SERIAL_BAUD_RATE>`)
   and press the board's reset button so `setup()` runs again. That does not write flash.
   If F < 87 KB, stop and report before uploading. Step 3 would then leave less than step 5
   needs, and that is a decision for the user. Note that the budget is not enforced at
   runtime. Only `test_oscillator` checks it.
4. On the board (**ask before uploading, every time**): the `wavetables:` line reads 145550
   bytes against a budget of 163840.
5. Listening A/B: sweep the pitch pot slowly on TPT and SAW-based patches. The brightness step
   at 160/320/640 Hz should be about half as large. GTR, PNO and SINE should otherwise sound
   unchanged.
