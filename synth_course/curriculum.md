---
id: curriculum
title: Build a Wavetable Synth on an ESP32-C3
---

# Build a Wavetable Synth on an ESP32-C3

A self-paced course for writing, from an empty sketch, a polyphonic wavetable synthesizer that
matches what `synth/` in this repo can do, on the same hardware. The repo is the
*reference answer*: you look at it after each milestone, never before.

## Who this is for

- **Programming:** comfortable with C++ (classes, `constexpr`, fixed-width ints, bit
  manipulation) and general software engineering. No embedded experience assumed.
- **Music/acoustics:** you know what an interval, a scale and a chord are, and roughly what
  "harmonics" means.
- **Maths:** trigonometry, logs/exponentials, complex numbers at a recall level. Fourier series
  and difference equations are taught here (with readings), not assumed.

## Where you end up

A flashable synth with all of the following. Each is introduced by the module in brackets.

- [ ] 44.1 kHz / 16-bit audio over I2S to a line-out DAC and a speaker amp in parallel (03)
- [ ] An audio task that never misses a deadline and never starves the UI; a liveness LED that
      proves `loop()` is alive (04)
- [ ] A master volume pot and a pitch pot, smoothed and jitter-free, pitch mapped musically over
      80 Hz – 1 kHz (05)
- [ ] An accurate, cheap oscillator (06), reading band-limited composite wavetables with
      no audible aliasing anywhere in the pitch range, inside a fixed RAM budget (07)
- [ ] Up to 32 voices per patch, mixed with a no-clipping guarantee; detuned unisons (08)
- [ ] Voices pitched as a diatonic chord that follows the pot through a key, in several
      modes (major, minor, harmonic/melodic minor, Phrygian, minor pentatonic, chromatic) (09)
- [ ] A table of patches, validated at compile time, cycled by a rotary encoder, shown on the
      board's 72×40 OLED (10)
- [ ] A gate switch driving an ADSR amplitude envelope, with retrigger and short-note
      handling, and no clicks or zipper noise (11)
- [ ] A brightness filter that darkens a pluck as it decays and opens with loudness (12)
- [ ] Vibrato and tremolo with a delayed, fading-in onset (13)
- [ ] Selectable distortion flavors (hard clip, soft clip, foldback, bitcrush), toggled by the
      encoder button (14)
- [ ] Instrument patches whose spectra come from acoustics data: guitar, piano, clarinet,
      flute, trumpet, Hammond registrations, with formants fixed in Hz (15)

You are free to design every one of these differently from the repo. Build tasks state
requirements and budgets, not designs.

## Kit

Everything is listed in `synth/pins.h`; this is the shopping list.

| Part | Notes |
|---|---|
| ABRobot ESP32-C3 0.42" OLED dev board | built-in SSD1306 (72×40 visible) on GPIO5/6, LED on GPIO8 |
| PCM5100/PCM5102 I2S DAC module ("purple" board) | line out on a 3.5 mm jack. SCK→GND; pads FLT/DEMP/FMT = L, XSMT = H |
| MAX98357A I2S class-D amp breakout + small 4–8 Ω speaker | wired in parallel with the DAC on the same 3 I2S lines |
| 2 × linear potentiometers (10 kΩ is fine) | master volume, pitch |
| EC11-style rotary encoder with push switch | patch select + distortion toggle |
| SPST switch (toggle or momentary) | note gate |
| Breadboard, jumper wires, USB-C cable | |
| Headphones or powered speakers | for the line out |
| **Strongly recommended:** a USB audio interface with a line input | lets you record your synth's real output and analyse it in the notebooks |
| A phone tuner app (any chromatic tuner) | pitch-accuracy checks |

Software: `arduino-cli` (or Arduino IDE 2.x), the Espressif `esp32` core 3.x, the `Adafruit
SSD1306` and `Adafruit GFX Library` libraries, Python 3 with `numpy`, `scipy`, `matplotlib`,
`sounddevice` and Jupyter, and a current Chrome/Firefox for the playgrounds.

## How to use a module

Every module has the same sections:

1. **Goal / You'll be able to**: what changes in you and in your synth.
2. **Concepts**: the vocabulary of the module.
3. **Read**: *core* readings are required; *optional* ones go deeper. Hours are estimates.
4. **Explore (notebook)**: compute and plot the idea before coding it on the device.
5. **Play (playground)**: hear and poke the idea in the browser.
6. **Build**: the capability to add, the constraints it must respect, and nothing about how.
7. **Hardware milestone**: the checklist you tick when it works on the board. The site
   saves these ticks.
8. **Design questions**: decide and write down your answers before comparing.
9. **Compare (spoiler)**: where the repo solves the same problem, and what to notice.
   Read it only after your milestone passes.
10. **Stretch**: optional extras.

A suggested rhythm for a week: readings first, then the notebook and playground, then the build,
then the milestone, then Compare.

**Constraints that apply to every Build from module 04 on** (the "audio contract"):

- The per-sample path is integer-only; float is fine once per block. The C3 has no FPU.
- The audio task never blocks on anything but the I2S write: no `malloc`, no `Serial`, no mutex
  wait, no `delay()`.
- The budget is 160 MHz ÷ 44.1 kHz ≈ **3628 cycles per output frame**, all-in.
- Nothing you add may make the mix clip unless you meant it to (distortion).

## Module map

| # | Module | Weeks | Needs | Hardware? |
|---|---|---|---|---|
| 00 | [Toolchain & board](modules/00-toolchain-and-board.mdx) | 1 | — | yes |
| 01 | [Sound & hearing](modules/01-sound-and-hearing.mdx) | 1 | — | no |
| 02 | [Digital audio](modules/02-digital-audio.mdx) | 1 | 01 | no |
| 03 | [Getting sound out: I2S](modules/03-i2s-sound-out.mdx) | 1 | 00, 02 | yes |
| 04 | [Real time on one core](modules/04-real-time-one-core.mdx) | 1 | 03 | yes |
| 05 | [Controls: pots, encoder, switch](modules/05-controls.mdx) | 1 | 04 | yes |
| 06 | [The DDS oscillator](modules/06-dds-oscillator.mdx) | 1 | 02, 05 | yes |
| 07 | [Additive timbre & band-limited wavetables](modules/07-band-limited-wavetables.mdx) | 1.5 | 06 | yes |
| 08 | [Polyphony & mixing](modules/08-polyphony-and-mixing.mdx) | 1 | 07 | yes |
| 09 | [Music theory in code](modules/09-music-theory-in-code.mdx) | 1 | 08 | yes |
| 10 | [Patches, encoder & OLED](modules/10-patches-and-ui.mdx) | 1 | 05, 09 | yes |
| 11 | [Envelopes & articulation](modules/11-envelopes.mdx) | 1 | 10 | yes |
| 12 | [Filters & brightness](modules/12-filters.mdx) | 1 | 11 | yes |
| 13 | [Modulation: vibrato & tremolo](modules/13-modulation.mdx) | 0.5 | 11 | yes |
| 14 | [Nonlinearity: distortion](modules/14-distortion.mdx) | 1 | 08 | yes |
| 15 | [Instrument acoustics & modelling](modules/15-instrument-models.mdx) | 1.5 | 07, 12, 13 | yes |
| 16 | [Beyond (optional)](modules/16-beyond.mdx) | open | 15 | yes |

About 16 weeks at 5–8 h/week. The order only ever builds on what came before.

## Bibliography

Readings are cited per module with exact chapters. Editions below are the ones the chapter
numbers refer to.

### Paid: buy or borrow these

| Book | Used in | Notes |
|---|---|---|
| Will Pirkle, *Designing Software Synthesizer Plugins in C++: With Audio DSP*, 2nd ed., Focal Press/Routledge 2021 | 07, 08, 11, 12, 13 | **Core.** Ch 4 Polyphony & voice-stealing, 6 Modulation, 7 Envelope Generators and DCA, 8 LFOs, 9 Wavetable Oscillators, 12 Synthesizer Filters, 13 Karplus-Strong. Desktop-plugin framing, but the DSP carries over directly. |
| Gareth Loy, *Musimathics: The Mathematical Foundations of Music*, Vol. 1, MIT Press 2006 (paperback 2011) | 01, 08, 09 | **Core.** Ch 3 Musical Scales, Tuning, and Intonation; 4 Physical Basis of Sound; 6 Psychophysical Basis of Sound; 8 Vibrating Systems. |
| Neville H. Fletcher & Thomas D. Rossing, *The Physics of Musical Instruments*, 2nd ed., Springer 1998 | 15 | **Core for 15 only.** Ch 9 Guitars and lutes; 12 The piano; 14 Lip-driven brass instruments; 15 Woodwind reed instruments; 16 Flutes and flue organ pipes. Expensive: a library or used copy is fine. |
| Eric J. Heller, *Why You Hear What You Hear*, Princeton UP 2013 | 01 | Optional: the most readable bridge between physics and perception. Part I (foundations of sound) and Part III (perception). |
| Richard G. Lyons, *Understanding Digital Signal Processing*, 3rd ed., Prentice Hall 2010 | 02, 12 | Optional: a second explanation of anything in DSP that doesn't click. Ch 2 Periodic Sampling, 12 Digital Data Formats and their Effects. |

### Free

| Resource | Used in |
|---|---|
| Allen B. Downey, *Think DSP* (v1.1.4), greenteapress.com/thinkdsp: Python-based, the notebooks follow its style | 01, 02, 07, 12 |
| Steven W. Smith, *The Scientist and Engineer's Guide to DSP*, dspguide.com: ch 3 ADC and DAC, 4 DSP Software, 14 Intro to Digital Filters, 19 Recursive Filters | 02, 12 |
| Miller Puckette, *The Theory and Technique of Electronic Music*, msp.ucsd.edu: ch 2 Wavetables and samplers, 3 Audio and control computations, 4 Automation and voice management, 5 Modulation, 10 Classical waveforms | 04, 06, 07, 08, 11, 14 |
| Julius O. Smith III, *Introduction to Digital Filters with Audio Applications*, ccrma.stanford.edu/~jos/filters | 12 |
| Julius O. Smith III, *Physical Audio Signal Processing*, ccrma.stanford.edu/~jos/pasp: Soft Clipping, Artificial Reverberation, Karplus-Strong | 14, 16 |
| Dave Benson, *Music: A Mathematical Offering* (free PDF from the author's page, homepages.abdn.ac.uk/d.j.benson): ch 5 Scales and temperaments: the fivefold way | 09 |
| Gordon Reid, *Synth Secrets* (63 parts, Sound On Sound 1999–2004), soundonsound.com/series/synth-secrets-sound-sound | 01, 07, 08, 11, 13, 15 |
| Nigel Redmon, EarLevel Engineering articles (wavetable oscillator series, ADSR, one-pole filter), earlevel.com | 06, 07, 11, 12 |
| Richard Barry et al., *Mastering the FreeRTOS Real Time Kernel*, freertos.org (source: github.com/FreeRTOS/FreeRTOS-Kernel-Book): ch 4 Task Management, 7 Interrupt Management, 8 Resource Management | 04, 05 |
| Ross Bencina, "Real-time audio programming 101: time waits for nothing" (2011), rossbencina.com | 04 |
| Analog Devices, *A Technical Tutorial on Digital Signal Synthesis* (1999) and MT-085 *Fundamentals of Direct Digital Synthesis* | 06 |
| Randy Yates, *Fixed-Point Arithmetic: An Introduction* (Digital Signal Labs) | 02 |
| Jack Ganssle, *A Guide to Debouncing* (2004/2008) | 05 |
| Ben Buxton, Rotary encoder handler (github.com/buxtronix/arduino/tree/master/libraries/Rotary) | 05 |
| UNSW Music Acoustics (Joe Wolfe et al.), newt.phys.unsw.edu.au/music and phys.unsw.edu.au/jw: clarinet, flute, brass pages | 15 |
| Espressif: ESP32-C3 datasheet and Technical Reference Manual; ESP-IDF Programming Guide (I2S, ADC, FreeRTOS); Arduino-ESP32 docs | 00, 03, 04, 05 |
| Datasheets: TI PCM5102A (ti.com/lit/ds/symlink/pcm5102a.pdf), Analog Devices/Maxim MAX98357A (plus Adafruit's MAX98357 guide); Philips *I²S bus specification* (1986, rev. 1996) | 03 |
| Adafruit GFX Graphics Library guide (learn.adafruit.com) | 00, 10 |
