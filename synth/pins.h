#pragma once

#include <stdint.h>

// Pin map for the ESP32-S3 SuperMini (no built-in display). Not usable:
// GPIO0/3/45/46 (strapping), 19/20 (native USB D-/D+), 26-32 (flash), 33-37
// (octal PSRAM on N8R8/N16R8 modules). Pots must sit on ADC1 (GPIO1-10):
// ADC2 is unreliable while the radio is on. The SuperMini only brings out
// roughly GPIO1-13 and 43/44, plus its WS2812 RGB LED on GPIO48, so
// everything below lives on GPIO1-13. Check the silkscreen: clones differ.

// I2S audio out (MAX98357A Class-D amp breakout).
// The same three lines also feed a purple PCM5100 DAC module (line out) in
// parallel with the amp: BCK/LCK/DIN to these pins, SCK to GND (internal
// PLL), VIN to 3V3, and back solder pads FLT/DEMP/FMT = L, XSMT = H (un-mute).
#define PIN_I2S_BCK  10
#define PIN_I2S_LRCK 8
#define PIN_I2S_DOUT 9

// OLED — SSD1306 over I2C. The SuperMini has none, so the display is
// compiled out (DISABLE_DISPLAY in display.h); these pins are reserved in
// case an external one is added later.
#define PIN_OLED_SDA 11
#define PIN_OLED_SCL 12
#define OLED_I2C_ADDR 0x3C

// The SSD1306 controller has a 128x64 GDDRAM buffer, but this board's 0.42"
// glass only shows a 72x40 window into it, offset to (30,24). Adafruit_SSD1306
// has no offset support, so display.cpp shifts every draw by (OLED_X_OFFSET,
// OLED_Y_OFFSET) by hand. Other panels of this type sit at a slightly
// different offset — nudge OLED_X_OFFSET / OLED_Y_OFFSET if the image is clipped.
#define OLED_WIDTH   128  // full SSD1306 buffer, not the visible area
#define OLED_HEIGHT  64
#define OLED_VISIBLE_WIDTH  72
#define OLED_VISIBLE_HEIGHT 40
#define OLED_X_OFFSET 30
#define OLED_Y_OFFSET 24

// Compact status layout inside the visible window (see display.cpp).
const int OLED_STATUS_ROW_TOP_PX     = 12; // first status row's y, from the window top
const int OLED_STATUS_ROW_SPACING_PX = 9;
const int OLED_TEXT_HEIGHT_PX     = 8;  // Adafruit GFX size-1 glyph height
const int OLED_VOL_BAR_X_PX       = 32; // volume bar's left edge, from the window's left

// Two pots for the whole instrument: one MASTER volume and one pitch. Every
// voice in the active patch (kPatches, voices.h) is pitched relative to
// this single pitch pot and scaled by this single volume pot, so the pot
// count no longer grows with the voice count.
#define PIN_POT_VOL1 1   // ADC1_CH0
#define PIN_POT_PITCH1 2 // ADC1_CH1

// Liveness LED — the SuperMini's onboard WS2812 (GPIO48). RGB_BUILTIN comes
// from the ESP32S3 Dev Module variant; digitalWrite() on it drives the RGB
// LED (HIGH = on, white).
#define PIN_STATUS_LED RGB_BUILTIN

// Amplitude envelope gate switch — SPST, wired between this pin and GND,
// read with the internal pull-up (INPUT_PULLUP): open = HIGH = note off,
// closed = LOW = note held (envelope.h triggers attack on close, release on
// open — see controls.cpp/audio_task.cpp).
#define PIN_AUDIO_SWITCH 7

// Rotary encoder (bare EC11-style, 5 pins: A/B/C + isolated switch S1/S2).
// C and S1 wire to GND; only A, B, and S2 need GPIOs. Rotation cycles
// kPatches (voices.h); the push-button toggles the active patch's matched
// distortion on/off. All three read with internal pull-ups (INPUT_PULLUP):
// the encoder supplies none of its own.
//
// Identifying the physical legs on this encoder without a multimeter:
// orient it with the 3-pin row (A/C/B) on your left and the 2-pin switch
// row on your right. The top-left pin (of the 3) and the top-right pin
// (of the 2) are both ground — those are C and S1.
#define PIN_ENCODER_A  4
#define PIN_ENCODER_B  5
// Wired to S2 (S1 -> GND).
#define PIN_ENCODER_SW 6

// This EC11-style encoder's detents land every 2 quadrature edges (not the
// full 4-edge Gray cycle 00->01->11->10->00) — controls.cpp accumulates
// edges from quadratureStep() and only advances the patch once every this
// many, so one click of the knob is one patch step. (Was 4, which made the
// patch advance only every other click.)
#define ENCODER_STEPS_PER_DETENT 2

// Minimum time between accepted button edges — mechanical switch bounce on
// a press/release is a few ms, well under this.
#define ENCODER_BUTTON_DEBOUNCE_MS 30

// Audio constants. NUM_VOICES is not here — voice count is a per-patch
// runtime value (kPatches in voices.h, whose MAX_VOICES is the ceiling
// every patch is checked against).
#define SAMPLE_RATE_HZ    44100
#define SINE_TABLE_SIZE   1024
// Peak amplitude of the sine table and of every composite wavetable built
// from it. Nearly full-scale: each patch's voice levels are normalized to
// sum to VOLUME_Q15_ONE (see normalizeVoiceLevelsQ15), so the full-volume
// mix peaks here whatever the voice count — no headroom needs reserving per
// voice.
#define SINE_TABLE_AMPLITUDE 32000
#define AUDIO_BLOCK_FRAMES 256    // stereo frames generated + written per I2S block

#define NUM_HARMONICS 64  // fundamental (1x) + n overtones (2x..nx), at the
                          // bottom of the pitch range; the wavetable mip
                          // levels drop harmonics as pitch rises so the
                          // series never crosses Nyquist (see oscillator.h)

// Hard ceiling on total wavetable RAM (see oscillator.cpp:initWavetables()).
// Making this an explicit invariant means a kPatches edit that needs more
// headroom fails test_oscillator.cpp, not the board. Measured with the
// current kPatches: 145,550 bytes (half-octave levels, identical levels
// shared), leaving ~18 KB for patch edits.
const int WAVETABLE_RAM_BUDGET_BYTES = 160 * 1024;

// Per-voice volume is carried into the mixer as a Q15 fixed-point fraction
// (0 .. VOLUME_Q15_ONE == 0.0 .. 1.0) so the per-sample mix stays
// integer-only by design.
const int VOLUME_Q15_SHIFT = 15;
const int VOLUME_Q15_ONE   = (1 << VOLUME_Q15_SHIFT) - 1; // 32767

// Pitch mapping range (Hz), exponential across the pot sweep
#define FREQ_MIN_HZ 80.0f
#define FREQ_MAX_HZ 1000.0f

// ADC resolution — 12 is the ESP32 hardware ADC's native/max bit depth
const int ADC_RESOLUTION_BITS = 12;
const int ADC_MAX_COUNT = (1 << ADC_RESOLUTION_BITS) - 1;

// ADC smoothing
#define ADC_OVERSAMPLE_COUNT 8    // samples averaged per read, cuts per-sample ADC noise
#define ADC_EMA_ALPHA        0.15f // filtered += alpha * (raw - filtered); lower = smoother but slower to respond
#define ADC_HYSTERESIS_COUNTS 4 // above typical ADC noise floor, well below perceptible pot movement

// Display refresh cadence
#define DISPLAY_REFRESH_MS 100

// Liveness-blink half-period — PIN_STATUS_LED toggles every this many ms,
// giving a ~1Hz blink independent of DISPLAY_REFRESH_MS.
#define BLINK_HALF_PERIOD_MS 500

// USB serial debug output baud rate
#define SERIAL_BAUD_RATE 115200
