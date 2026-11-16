# synth_course

Polyphonic wavetable synth on an ESP32-S3 SuperMini: a master volume pot and a pitch pot drive every voice in the `kVoices` table (`voices.h`), audio out over I2S to an external DAC, and a blinking onboard LED as a liveness indicator.

## Hardware

- ESP32-S3 SuperMini — no built-in display; its onboard WS2812 LED (GPIO48) is the liveness indicator. Wiring is in `synth/pins.h`
- PCM5102 I2S DAC breakout
- 2x potentiometers (master volume, pitch)

> **Two pots for any number of voices:** every voice is scaled by the one volume pot and pitched relative to the one pitch pot — as a diatonic chord whose quality follows the root, or as a detuned unison (`VOICE_PITCH_*` in `voices.h`). Add voices by adding rows to `kVoices`, not knobs.

See `pins.h` for wiring/pin assignments.

## System requirements

- [Arduino IDE](https://www.arduino.cc/en/software) 2.x (or `arduino-cli`)
- **ESP32 board support**: install via Boards Manager → search "esp32" → install the Espressif "esp32" package (this project uses the Arduino-ESP32 core v3.x, which provides `ESP_I2S.h`)
- **Board selection**: the target is an ESP32-S3 SuperMini; pick "ESP32S3 Dev Module" (FQBN `esp32:esp32:esp32s3`) under Tools → Board
- **Tools settings**: set **USB CDC On Boot → "Enabled"** (`CDCOnBoot=cdc`) so the serial console comes out of the native USB port, and leave PSRAM disabled (the SuperMini's ESP32-S3FH4R2 has 2 MB of quad PSRAM; the synth doesn't need it, and "OPI PSRAM" is wrong for this chip). With `arduino-cli`, pass the option in the FQBN: `--fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc` for both compile and upload
- **Libraries**: none needed by default — the SuperMini has no OLED, so the display is compiled out (`DISABLE_DISPLAY` in `synth/display.h`). To re-enable an external SSD1306, install `Adafruit SSD1306` and `Adafruit GFX Library` via Library Manager. ESP_I2S ships with the ESP32 board package

## Setup

1. Install the Arduino IDE and add the ESP32 board package (File → Preferences → Additional Board Manager URLs → `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`).
2. Install the two Adafruit libraries listed above via Sketch → Include Library → Manage Libraries.
3. Open `synth/synth.ino`, select your board and serial port under Tools, then Upload.
4. Open the Serial Monitor at 115200 baud to see startup logs.

## Wiring reference

See the pin definitions and constants in `synth/pins.h`.

## Speaker/amp test

`player/` is a separate, standalone sketch that loops a short audio clip of your own choosing over I2S, with the master volume pot controlling level live — useful for checking the physical speaker's max clean volume and response with real material. See `player/player.ino`'s top comment for the WAV-conversion + `wav_to_header.py` steps.

## Course site

`synth_course/` holds a self-teaching curriculum for building this synth yourself, and
`synth_course/site/` is a local website that renders it and saves your progress. It runs in Docker: `colima start`,
then `cd synth_course/site && make dev` and open http://localhost:3100. See `synth_course/site/README.md`.
