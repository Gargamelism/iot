# Plan 1 of 3 — Curriculum for "build the synth yourself"

## Context

The user wants a tutorial website that teaches them to write this synth (`synth/`) on their own. That splits into three plans:
1. **This plan: the curriculum.** What to learn, in what order, from which readings, and what to build.
2. Website: a **self-hosted Next.js app that runs locally inside this repo** and uses a **local SQLite** database. It renders the curriculum and hosts the browser playgrounds, and it saves the learner's changes: progress, notes and playground state. It reuses the JS ports of the firmware math in `web_sim/app.js`.
3. Content assets: the Python notebooks and playground code that plan 1 specifies.

The learner already knows C++ and general programming well. They know a moderate amount of music and acoustics and some maths. The course can send them to external material, including paid books.

Choices the user made:
- **Capabilities, not a copy.** By the end the learner's synth matches what this one can do (same hardware). It covers DDS wavetable voices, band-limiting, polyphony, scales, patches selected with the encoder, ADSR, a tone filter, vibrato, distortion and instrument models. Build tasks state requirements and budgets, not designs. The repo is shown only after each milestone, as "one possible answer".
- **How each module is checked:** a hardware milestone checklist, a browser playground spec and a Python notebook spec. There are no required unit tests.
- **Where it lives:** a `course/` folder in this repo, written as Markdown/MDX that the Next.js site (plan 2) renders straight from disk.
  - Each module file starts with YAML front-matter: `id`, `title`, `weeks`, `prereqs`, and `milestones` (a list of stable checklist-item ids).
  - The site's SQLite stores progress, notes and saved playground presets against those ids. It never stores the content itself, so editing the curriculum doesn't lose saved state.
- **Pace:** 5–8 h/week, with deep reading. That is about 16 weeks.

## Deliverables

```
course/
  curriculum.md          audience, outcome, kit list, how to use, module map, pacing, bibliography
  modules/NN-slug.mdx    one per module (17), front-matter + fixed section template below
```

**Template for each module** (the same headings everywhere, so the website can parse them):
- **Goal**: one line.
- **You'll be able to**: 3–5 outcomes.
- **Concepts**.
- **Read**: core vs optional, with exact book/edition/chapter or URL+section, and an hour estimate.
- **Explore (notebook)**: a spec of what to compute and plot in numpy/scipy/matplotlib.
- **Play (playground)**: a spec of the browser demo, its controls and what it should reveal.
- **Build**: the required capability, the constraints (cycle/RAM budget, no FPU on the per-sample path, never block the audio task) and the deliverable.
- **Hardware milestone**: an observable checklist (what you hear, see on the OLED, read on Serial or a tuner app).
- **Design questions**: tradeoffs the learner decides and justifies.
- **Compare (spoiler)**: the repo files and functions that make up one answer, with things to notice.
- **Stretch**.

## Module map (draft — refine while writing)

| # | Module | Wk | Key reference (repo, spoiler) | Core readings (verify editions/chapters) |
|---|---|---|---|---|
| 00 | Toolchain & board: arduino-cli, ESP32-C3 core, USB-CDC-on-boot, GPIO budget, LED blink, OLED 72×40 window offset | 1 | `pins.h`, `display.cpp`, `synth.ino` | Arduino-ESP32 docs; ESP32-C3 datasheet (GPIO/strapping); Adafruit GFX guide |
| 01 | Sound & hearing: pitch, loudness/dB, harmonic series, timbre, Fourier intuition | 1 | — | Downey *Think DSP* ch1–2 (free); Heller *Why You Hear What You Hear* (selected ch); SOS *Synth Secrets* pt 1–3 |
| 02 | Digital audio: sampling, Nyquist, aliasing, quantization, fixed-point Q15 | 1 | `pins.h` Q15 consts | S.W. Smith *DSP Guide* ch3–4 (free); Yates "Fixed-Point Arithmetic" (free PDF); Lyons *Understanding DSP* (number formats ch, optional) |
| 03 | Getting sound out: I2S framing, DAC vs class-D amp, `ESP_I2S`, the first table sine | 1 | `player/player.ino`, `audioTaskBegin` | NXP I2S bus spec UM11732; PCM5102A + MAX98357A datasheets (relevant pages); ESP-IDF I2S guide |
| 04 | Real time on one core: FreeRTOS tasks and priorities, watchdog, blocking write as the clock, try-lock param sharing, cycle budget (3628 cyc/frame) | 1 | `audio_task.cpp` loop, `controls.h` `OscParams` | *Mastering the FreeRTOS Kernel* (tasks, resource mgmt ch); Bencina "Real-time audio programming 101"; ESP-IDF FreeRTOS notes |
| 05 | Controls: ADC + attenuation, oversampling, EMA + hysteresis, exponential pitch mapping, quadrature encoder (ISR/state table), debouncing | 1 | `controls.cpp`, `controls_math.cpp` | ESP32-C3 ADC docs; Ganssle "A Guide to Debouncing"; Buxton rotary-encoder state machine |
| 06 | DDS oscillator: 32-bit phase accumulator, table size vs accuracy, interpolation tradeoff | 1 | `Oscillator`, `initSineTable` | Analog Devices "A Technical Tutorial on DDS"; EarLevel wavetable oscillator series (pt 1–2); Puckette *TTEM* ch2 (free) |
| 07 | Additive timbre & band-limited wavetables: Fourier series, harmonic weights, peak normalization, per-octave mip-maps, RAM budget | 1.5 | `buildTable`, `harmonicsForMipLevel`, `maxMipLevelForSpread`, `harmonic_spreads.h` | EarLevel wavetable series (mipmapping parts); *Think DSP* ch2; Pirkle *Designing Software Synthesizer Plug-Ins in C++* 2e (wavetable osc ch) |
| 08 | Polyphony & mixing: voice arrays, headroom, level normalization, Q15 mix, cents/detune, beating, unison | 1 | `normalizeVoiceLevelsQ15`, `mixOscillators` | Loy *Musimathics* vol 1 (beats/consonance ch); Synth Secrets (detune/chorus) |
| 09 | Music theory in code: equal temperament, MIDI numbers, scales/modes as interval patterns, scale-degree chords, snapping a pot to a key | 1 | `scale.cpp`, `notes.h` | Loy *Musimathics* vol 1 (tuning/temperament ch); Benson *Music: A Mathematical Offering* (free, temperament ch) |
| 10 | Data-driven instrument + UI: constexpr patch tables, `static_assert` validation, encoder patch selection, OLED status, change-safe state handoff | 1 | `voices.h`, `display.cpp`, `applyPatch` | cppreference constexpr/static_assert; Adafruit GFX guide |
| 11 | Envelopes & articulation: ADSR, linear vs exponential segments, block-rate control + per-sample ramp (zipper noise), gate/retrigger semantics, short notes | 1 | `envelope.cpp`, gain ramp in `audioTask` | EarLevel ADSR article; Synth Secrets (envelopes); Pirkle synth book (EG ch) |
| 12 | Filters: difference equations, one-pole LPF, coefficient from cutoff, fixed-point state precision, filter envelope and loudness-tracked brightness | 1 | `tone.h/.cpp` | J.O. Smith *Introduction to Digital Filters* (free, early ch); *DSP Guide* ch19; EarLevel one-pole |
| 13 | Modulation: LFOs, vibrato vs tremolo, delayed onset, block-rate modulation | 0.5 | `vibrato.cpp` | Synth Secrets (modulation); Fletcher & Rossing (vibrato notes, optional) |
| 14 | Nonlinearity: hard/soft clip, foldback, bitcrush, aliasing from nonlinearity, pre- vs post-mix intermodulation | 1 | `distortion.cpp`, `DISTORTION_STAGE_*` | Puckette *TTEM* ch5 (waveshaping); Pirkle *Designing Audio Effect Plugins in C++* (waveshaper ch) |
| 15 | Instrument acoustics & modelling: pluck/strike position → spectrum, clarinet odd harmonics, flute, brass formants, Hz-fixed formants, piano unison detune, Hammond drawbars | 1.5 | `harmonic_spreads.h`, `voices.h` patches | Fletcher & Rossing *Physics of Musical Instruments* 2e (strings, woodwinds, brass ch); UNSW Music Acoustics pages; Hammond drawbar PDF (all already cited in `harmonic_spreads.h`) |
| 16 | Beyond (optional capstone): random harmonic phases, room/reverb, Karplus-Strong, MIDI in | open | `plans/2026-09-11_realistic_instrument_dynamics.md` phases 6–7 | J.O. Smith *Physical Audio Signal Processing* (free); Karplus & Strong 1983; Freeverb/Schroeder |

**Ordering rule:** no module uses a concept introduced later. Modules 01–02 have no hardware step. Every module from 03 on ends with a flashable synth that is more capable than the last one.

**Paid books the curriculum leans on:**
- Pirkle, *Synth Plug-Ins* 2e: core from module 07.
- Loy, *Musimathics* vol 1: core for modules 08–09.
- Fletcher & Rossing: core for module 15. It is expensive, so a library or used copy is noted.
- Heller and Lyons: optional.

Everything else is free.

## Steps

1. **Verify every resource before citing it**, using WebSearch/WebFetch.
   - Check that it exists, the current edition, and the exact chapter/section numbers and titles.
   - Check the URL is live, and the price and availability for paid books.
   - Fix the draft table above wherever reality differs. Chapter numbers in the table are from memory and must not be published unverified.
2. **Write `course/curriculum.md`:**
   - audience and prerequisites
   - the end-state capabilities checklist, derived from current `voices.h` / `audio_task.cpp` features
   - kit list from `pins.h` and `CLAUDE.md`: board, PCM5100/5102 DAC, MAX98357A, 2 pots, encoder, gate switch
   - how to use a module, and the spoiler policy
   - the module map with weeks and prerequisites
   - the full bibliography, split into free and paid, core and optional
3. **Write the 17 module files** using the template.
   - Build tasks state *what* plus constraints and never prescribe the repo's design. For example, module 07 says "pitch sweep 80 Hz–1 kHz with no audible aliasing, ≤128 KB tables, ≤N cycles/voice". It does not say "mip-map per octave".
   - Each Compare section names the real files and functions, checked against the current code.
4. **Specify the notebooks and playgrounds per module, without building them.**
   - Notebooks list their inputs, the plots and the "aha" each should show. The style is `scripts/harmonics_demo.py`.
   - Playgrounds list their controls and which `web_sim/app.js` ports they reuse (`freqToNoteName`, `smoothValue`, the AudioWorklet oscillator) versus what is new.
   - These specs are the input for plans 2 and 3.

## Verification

- A link check on every URL in `course/`: a script in the scratchpad runs `curl -sIL` and must report no 4xx or 5xx.
- `grep` confirms every module file has all template headings, in order.
- Every repo symbol named under Compare exists. Grep each one; it must have no stale names (e.g. `kVoices` → it is now `kPatches`).
- Manual dependency read-through: no forward references between modules.
- Each week's reading-hour total is ≤ 8 h.
- The user reviews `curriculum.md` and two sample modules (05 and 07) before the remaining modules are written in full.
