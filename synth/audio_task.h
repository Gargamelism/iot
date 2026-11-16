#pragma once

// Initializes I2S output and spawns the audio-generation task pinned to
// Core 0. On the ESP32-S3, Arduino's loop() runs on Core 1, so the audio
// task has Core 0 to itself.
// Call once from setup(), after controlsBegin() and initSineTable().
void audioTaskBegin();
