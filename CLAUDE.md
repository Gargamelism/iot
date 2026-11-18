# synth_course

Polyphonic wavetable synth on an ESP32-S3 SuperMini. The instrument
itself — how many voices, each voice's pitch offset, harmonic spread and level — is the
`kVoices` table in `voices.h`; everything else derives from it.

## Tech stack

- **Platform**: ESP32-S3 SuperMini (dual-core Xtensa LX7 at 240 MHz; build as "ESP32S3 Dev Module", `esp32:esp32:esp32s3`) — audio generation runs as a max-priority task pinned to Core 0 and has that core to itself, since Arduino's `loop()` (controls) runs on Core 1. **"USB CDC On Boot" must be enabled** so the console comes out of the native USB port. Unusable pins: GPIO0/3/45/46 (strapping), 19/20 (USB), 26-32 (flash), 33-37 (octal PSRAM); the SuperMini only brings out roughly GPIO1-13 and 43/44, plus its WS2812 LED on GPIO48. All wiring lives on GPIO1-13 (GPIO13 spare). The DSP stays integer-only by design even though the S3 has an FPU.
- **Framework**: Arduino for ESP32 (`synth/synth.ino` sketch entry point, `setup()`/`loop()`).
- **Language**: C++ (Arduino-style).
- **Audio out**: `ESP_I2S.h` (`I2SClass`) → external MAX98357A I2S Class-D amp (speaker) and, in parallel on the same three I2S lines, a purple PCM5100 DAC module (stereo line out, 3.5 mm jack; SCK tied to GND, solder pads FLT/DEMP/FMT = L, XSMT = H). Each voice reads a composite wavetable (the harmonic sum precomputed per spread per half-octave in `oscillator.cpp`, with each spread's per-harmonic weights — synthetic shapes and sourced instrument models — in `harmonic_spreads.h`), so a voice costs two interpolated lookups per sample instead of a 22-term harmonic loop.
- **Display**: none — the SuperMini has no OLED, so `display.h` defines `DISABLE_DISPLAY` and `displayBegin()`/`displayUpdate()` become no-ops (Adafruit_GFX/SSD1306/Wire drop out of the build). The SSD1306 code (`display.cpp`, 72x40 window at offset (30,24) via `OLED_X_OFFSET`/`OLED_Y_OFFSET`) is kept for an optional external panel on `PIN_OLED_SDA`/`PIN_OLED_SCL` (GPIO11/12); re-enabling it is a one-line change.
- **Input**: Two analog potentiometers on ADC1 pins — one **master** volume and one pitch. Every voice is scaled by the volume pot and pitched relative to the pitch pot (a diatonic chord or a detuned unison, per `VOICE_PITCH_*` in `voices.h`), so the pot count no longer grows with the voice count. Pots must stay on ADC1 (GPIO1-10); ADC2 is unreliable while the radio is on.
- **Liveness indicator**: the only visual status — the SuperMini's onboard WS2812 (`RGB_BUILTIN`, GPIO48) blinks at ~1Hz from `loop()`, so a frozen main loop is visible even when the synth is fully silent.

See `synth/pins.h` for wiring/pin assignments and the header comment in `synth/synth.ino` for the file-by-file breakdown.

## Repo layout

Each Arduino program is its own sketch folder (a folder holds exactly one `.ino`, which must share its folder's name):

- `synth/` — the polyphonic synth described above (`synth.ino` + its sources, plus `synth/test/`, the host-side unit tests for the hardware-independent DSP/control math).
- `player/` — a standalone speaker/amp test sketch (`player.ino`) that loops a user-supplied audio clip over I2S, scaled by the master volume pot, to check the physical speaker's level and response with real material instead of a synthesized tone. Deliberately does not include `synth/`'s headers. See its top-of-file comment for the WAV-conversion workflow (`wav_to_header.py`).

## Limitations

- **Never flash/upload firmware to the connected board without the user's explicit go-ahead in that turn.** Compiling (`arduino-cli compile`) is fine on its own, but `arduino-cli upload`, `esptool ... write-flash`, or any other command that writes to the board's flash requires the user to confirm first, every time — a prior approval doesn't carry over to a later upload. This is enforced via `permissions.ask` in `.claude/settings.json`.
