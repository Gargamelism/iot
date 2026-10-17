# Recordings from your hardware

The notebooks run inside Docker, which can't reach your audio interface or the board's
serial port. Capture on the Mac and drop the files here:

- **Line-out recordings**: record the DAC's line out with Audacity, QuickTime or any
  recorder, export **WAV, 16-bit, 44.1 kHz, mono**, and name it after the notebook step,
  e.g. `07-saw-sweep.wav`. Each notebook says which file name it looks for.
- **Serial logs**: copy the Serial Monitor output (or `arduino-cli monitor ... > file`) into
  a `.txt` file, e.g. `05-adc-still.txt`. `synthlib.load_serial_log()` pulls the numbers
  out of it.

Files in this folder are gitignored (except this README). Notebooks fall back to a
synthetic signal when a recording is missing.
