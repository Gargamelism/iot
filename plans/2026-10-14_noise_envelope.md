# Noise envelope: chiff, pick and hammer transients plus a steady breath, per patch

## Context

Phase 5 of `2026-09-11_realistic_instrument_dynamics.md` added one noise source
(`noise.h`). Today the only per-patch control is `Patch::noisePercent`, a level:

```
LCG -> 3 kHz one-pole LP -> x master * noisePercent -> + mix (post-distortion)
    -> x amp envelope (+ tremolo) -> patch tone filter -> I2S
```

So every patch gets the same coloured hiss, gated by the *tone's* envelope. Real instruments
differ in two ways that matter more than the level:

1. **Time shape.** The noise is mostly a transient at the start of the note: a flute's "chiff"
   (breath before the tone speaks), a guitar's pick click, a piano's hammer thump, a trumpet's
   tongued attack. After that comes a quieter steady part (flute breath, bow hiss) or nothing.
   The chiff often comes *before* the tone, but today the noise is multiplied by the amp
   envelope. That makes this impossible: FLT's 60 ms amp attack would swallow a 30 ms chiff.
   The tone filter also hides it, because FLT's filter envelope opens over 40 ms.
2. **Band.** A pick click is bright (2–10 kHz) and a hammer thump is low (100 Hz–1.5 kHz).
   Breath sits in between. A single 3 kHz low-pass can't do any of them.

It also fixes the meaning of the level. Today `noisePercent` is a fraction of the *raw* LCG
amplitude, and the low-pass then removes an amount that depends on its cutoff. 12 % works out
to roughly −30 dBFS RMS, which says nothing directly.

## Design

### Signal path

The noise gets its own branch, envelope and band. It joins the tone path at the very end:

```
tone:  voices -> mix -> distortion -> x amp env -> tone filter --+
                                                                 +-> saturate -> I2S
noise: LCG -> high-pass(lowHz) -> low-pass(highHz) -> x makeup -> x noise env x level x master --+
```

- **After the tone filter and the amp envelope.** The noise envelope alone shapes the noise, so
  a chiff can lead the tone. The patch's brightness sweep doesn't dull it either.
- **After distortion,** as today, so the clipper never chews it.
- **Saturating add** at the end, as today.
- **No tremolo:** the flute's amplitude wobble belongs to the tone.

### Band-pass from two one-poles

Reuse `OnePoleLowpass` (`tone.h`):

- **Low-pass at `highHz`, first:** `l = lp.process(x)`.
- **High-pass at `lowHz`, second:** `h = (int32_t)l − lp2.process(l)`.

`h` stays int32: the difference of two full-scale int16s spans ±65 535. Multiplied by a Q15
gain ≤ `VOLUME_Q15_ONE` it peaks at 65 535 × 32 767 = 2 147 385 345, just under 2³¹, so an
int32 product is safe. Note that in a comment, since a gain above 1.0 would overflow.

The coefficients are fixed per patch, set on patch switch, and cost nothing per block. Per frame
this adds one more `process()`, a subtract, and the noise ramp's add and shift over today:
roughly +10 cycles. Both slopes are a gentle 6 dB/oct, which is plenty for noise colour.

At high cutoffs the digital one-pole is far from its analog model: a 10 kHz low-pass is only
5.6 dB down at Nyquist, so GTR's top edge barely filters. Acceptable for a pick click.

### Level that means something: makeup gain

The level is per patch: `levelPercent` = **output RMS at the envelope's peak (gain 1.0, full
master volume), as a % of full scale**, whatever the band. The sustain level is a fraction of
it. A wide band passes more noise power than a narrow one.
`noiseMakeupQ15(levelPercent, lowHz, highHz)` (`noise.cpp`, float, called on patch switch)
compensates, using the exact noise-power gain `G` of the digital cascade (white noise in,
variance out ÷ variance in = Σ h[n]²):

```
k1 = toneCoefficient(highHz), a1 = 1 - k1      // low-pass  (float; k1 = 1 at/above Nyquist)
k2 = toneCoefficient(lowHz),  a2 = 1 - k2      // high-pass = 1 - LP(lowHz) = a2(1 - z^-1)/(1 - a2 z^-1)
A  = (a1 - 1) / (a1 - a2),  B = (a2 - 1) / (a2 - a1)     // h[n] = k1*a2*(A a1^n + B a2^n)
G  = (k1*a2)^2 * (A^2/(1-a1^2) + 2AB/(1-a1*a2) + B^2/(1-a2^2))

rawRms  = 32768 / sqrt(3)                      // uniform LCG output
bandRms = rawRms * sqrt(G)
makeup  = (levelPercent / 100) * 32768 / bandRms   // clamped to VOLUME_Q15_ONE
```

Checked against numerical integration of |H|² for every band in the table: identical to
< 0.001 dB. (The analog estimate `π/2 · (highHz − lowHz)` was off by up to +1.9 dB for
2000–10000, so it's not used.) `lowHz < highHz` guarantees `a1 ≠ a2`. Cost is two `expf` and
a dozen soft-float ops, once per patch switch.

Makeup is Q15, so it must stay ≤ 1.0. Today's worst case is PNO at about 0.55. `expf` isn't
constexpr, so instead of a `static_assert`, a host test computes makeup for every `kPatches`
row and checks it is < `VOLUME_Q15_ONE` before clamping.

Filtered uniform noise is nearly Gaussian, with peaks up to about 4× RMS. A cap of
`levelPercent ≤ 25` puts a full-volume burst's peaks at about full scale; the saturating add
catches the rest. Enforced by a `static_assert`.

### Envelope: reuse `Envelope` as is

`EnvelopeConfig` already has the right shape. The noise envelope is triggered with the amp
envelope: same `noteOn`/`noteOff` and the same patch-switch `configure`.

- **attack:** linear rise to the burst peak, in ms
- **decay:** exponential **time constant τ** of the fall from peak to sustain, not the burst
  length. The burst is −20 dB at 2.3 τ and snaps to sustain at about 7.6 τ
  (`envelope.cpp: advanceDecay`, `kGainSnapEpsilon`). For an audible burst of length L, use
  τ ≈ L / 2.3.
- **sustain %:** steady breath level as a fraction of the peak; 0 = transient only
- **release:** exponential time constant of the fade after note-off, same rule as decay

The short-note fields (`shortNotesMs` …) stay 0. The staccato handling is the tone's business.

**Retrigger:** every note-on, exactly like the amp envelope. `retriggerSeq` counts both switch
presses and pot-swept new roots (`controls.cpp:157`, `:240`), so FLT/CLR get a chiff on every
note of a run, as if each were tongued. `noteOn()` restarts the attack from the current gain,
so a re-chiff over sustained breath rises from the sustain level, softer than the first. If
legato FLT sounds too chiffy on the board, a later option is a separate switch-only counter in
`OscParams`. Not in this plan.

**Always run the envelope.** The noise envelope gets `configure`, `noteOn`, `noteOff` and
`nextBlockGainQ15` every block, on every patch, including patches with `levelPercent == 0`.
Only the per-sample noise work is skipped, and only when last block's noise gain and this
block's target are both 0. Mid-note patch switches then behave as follows:

- **noise → noise:** envelope reconfigured in place; new band and makeup from the next block.
- **noise → none:** the target becomes 0, so the ramp fades the breath out over one block
  (5.8 ms), then the branch drops out. No click.
- **none → noise:** under `kNoiseNone` the envelope sits in sustain at 0. After the switch it
  picks up the new sustain level and the ramp fades the breath in over one block. No chiff,
  consistent with "switch in place, don't re-trigger"; the next note gets one.

### Per-sample ramp

Envelopes update once per 256-frame block (5.8 ms). A 20 ms pick burst is only about 3 blocks,
so the noise gain needs the same per-sample linear ramp the amp gain already has
(`audio_task.cpp`, `gainQ15Fixed`/`gainStepFixed`). Pull that into a small inline
`GainRamp { begin(prev, target, frames); next(); }` in `envelope.h` and use it for both. That
is a refactor of existing code, not new behaviour, and the amp path must stay bit-identical.

The noise ramp's per-block target folds everything together:
`target = envGainQ15 × makeupQ15 × masterQ15` (block rate), so the per-sample path has a
single multiply, `h × gainQ15`.

**Limit:** an attack shorter than one block still takes one block, 5.8 ms, through the ramp. A
1 ms pick attack becomes about 6 ms. That's acceptable; a pick is perceived at 5–10 ms anyway.

### Config

`noise.h`:

```cpp
struct NoiseConfig {
  EnvelopeConfig env;   // A = rise to peak (ms), D = decay τ (ms), S = steady % of peak, R = release τ (ms)
  uint8_t  levelPercent; // RMS at the envelope peak, % of full scale (0 = off, <= 25)
  uint16_t lowHz;       // high-pass corner
  uint16_t highHz;      // low-pass corner (> lowHz, <= SAMPLE_RATE_HZ / 2)
};
static constexpr NoiseConfig kNoiseNone = {{0, 0, 0, 0}, 0, 20, 20000}; // band unused at level 0
```

`Patch::noisePercent` is replaced by `NoiseConfig noise = kNoiseNone;`. `static_assert`s over
`kPatches` check that `lowHz < highHz` and `levelPercent <= 25`. `NOISE_CUTOFF_HZ` goes away.
The per-sample skip condition is in **Always run the envelope** above.

### Starting values (tune by ear; not sourced)

D and R are time constants: τ ≈ intended audible length / 2.3.

| patch | A | D τ | S % | R τ | level % | band Hz | intent (audible burst / fade) |
|---|---|---|---|---|---|---|---|
| FLT, FLT2 | 2 | 25 | 35 | 50 | 15 | 800–6000 | chiff (~60 ms) before the tone, then steady breath |
| CLR, CLR2 | 2 | 17 | 20 | 45 | 8 | 1500–5000 | reed/tongue onset (~40 ms), faint breath |
| TPT, TPT2 | 1 | 13 | 10 | 35 | 10 | 800–4000 | tongued attack (~30 ms) |
| GTR, GTR2 | 1 | 9 | 0 | 9 | 15 | 2000–10000 | pick click (~20 ms) |
| PNO, PNO2 | 1 | 13 | 0 | 13 | 10 | 100–1500 | hammer thump (~30 ms) |
| HARM (bowed) | 10 | 45 | 50 | 90 | 5 | 2000–8000 | bow catch (~100 ms), then rosin hiss |
| others | — | — | — | — | 0 | — | off |

These replace today's `noisePercent` values (HARM 2, CLR/CLR2 3, FLT/FLT2 12, TPT/TPT2 2).

## Not in this plan

- **Pitch-tracked noise** (a comb filter tuned to the note, so breath noise clusters around the
  harmonics like a real flute bore). This is the next step in realism, but it needs a per-patch
  delay line and retuning on every pitch change.
- **Velocity.** There is no velocity input. The volume pot already scales the noise with the
  tone.

## Files

- `synth/noise.h` / new `synth/noise.cpp`: `NoiseConfig`, `kNoiseNone`,
  `noiseMakeupQ15(levelPercent, lowHz, highHz)` (closed-form `G`); remove `NOISE_CUTOFF_HZ`.
  `noise.cpp` calls `toneCoefficientQ16`'s math, so `test/run.sh`'s `extra_sources_for` needs
  `noise) echo "tone.cpp"`.
- `synth/envelope.h`: `GainRamp`.
- `synth/audio_task.cpp`: noise envelope, two band filters and makeup; noise added after
  `s_toneFilter`; amp ramp moved onto `GainRamp`.
- `synth/voices.h`: `Patch::noise` replaces `noisePercent`; the values above; `static_assert`s.
- `synth/test/test_noise.cpp`: band-pass and makeup tests (below).
- `synth/test/test_envelope.cpp`: `GainRamp` reaches its target exactly after `frames` steps,
  up and down.

## Verification

- **Host:** `bash synth/test/run.sh`.
  - **Makeup accuracy:** for each band in the table, filtered and made-up noise at
    `levelPercent` = 10 measures 10 % ± 0.5 dB RMS over 1 s (the closed form is exact; the
    slack covers fixed-point rounding and finite-length variance).
  - **Makeup range:** every `kPatches` row's makeup is < `VOLUME_Q15_ONE` before clamping.
  - **Band shape:** a sine through the fixed-point cascade, like `test_tone.cpp`, matches the
    float digital response `|H(f)|` within ±0.5 dB at `lowHz`, `highHz` and `lowHz / 10`, and
    is ≥ 15 dB down at `lowHz / 10`. Corners come out −3.1 to −4.5 dB because the two slopes
    overlap in narrow bands, so don't assert a flat −3 dB. No check a decade above `highHz`:
    for every band except 100–1500 that is past Nyquist.
  - **No overflow:** a full-scale ±32767 square wave through the cascade × `VOLUME_Q15_ONE`
    doesn't wrap.
  - **Pre-existing failures:** the 2 `test_envelope.cpp` failures (lines 101, 106) predate this
    plan. Fix them first, or at least don't add to them.
- **Build:** `arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc synth`. Global
  variables should grow by about 50 B: one `Envelope` and one more `OnePoleLowpass`.
- **Board** (upload only on explicit go-ahead):
  - FLT: an audible chiff before the tone speaks, then soft breath that stops on release.
  - GTR: a click on each re-pluck while sweeping the pot.
  - PNO: low thump.
  - Organ patches: unchanged.
  - Switch FLT → organ and organ → FLT mid-note: breath fades out/in, no click.
