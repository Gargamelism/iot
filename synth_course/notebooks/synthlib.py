"""Shared helpers for the course notebooks.

Only what several notebooks need lives here; everything a module is *about*
you write yourself in that module's notebook. Importable from any notebook
(and from solutions/) because PYTHONPATH includes this folder.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from IPython.display import Audio, display
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT / "reference"
RECORDINGS = ROOT / "recordings"

FS = 44100  # the synth's sample rate
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


# --- listening & files -------------------------------------------------------

def play(x: np.ndarray, fs: int = FS, normalize: bool = True) -> None:
    """Play a signal in the browser (int16 or float, mono or (n, 2))."""
    x = np.asarray(x)
    if x.dtype == np.int16:
        x = x / 32768.0
    display(Audio(x.T if x.ndim == 2 else x, rate=fs, normalize=normalize))


def write_wav(path: str | Path, x: np.ndarray, fs: int = FS) -> Path:
    """Write int16 PCM. Floats are taken as -1..1 and clipped."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    x = np.asarray(x)
    if x.dtype != np.int16:
        x = np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)
    wavfile.write(path, fs, x)
    return path


def read_wav(path: str | Path) -> tuple[np.ndarray, int]:
    """Read a WAV as float -1..1, mono (stereo is averaged). Returns (x, fs)."""
    fs, x = wavfile.read(path)
    if x.dtype == np.int16:
        x = x / 32768.0
    elif x.dtype == np.int32:
        x = x / 2147483648.0
    x = x.astype(np.float64)
    if x.ndim == 2:
        x = x.mean(axis=1)
    return x, fs


def recording(name: str) -> Path | None:
    """A file in recordings/ if you've captured it, else None (use a synthetic fallback)."""
    p = RECORDINGS / name
    return p if p.exists() else None


def load_serial_log(path: str | Path) -> np.ndarray:
    """Every number in a Serial Monitor capture, in order, as floats."""
    text = Path(path).read_text(errors="replace")
    return np.array([float(m) for m in re.findall(r"-?\d+(?:\.\d+)?", text)])


# --- units -------------------------------------------------------------------

def db(a):
    """Amplitude ratio -> dB."""
    return 20 * np.log10(np.maximum(np.abs(a), 1e-12))


def amp(d):
    """dB -> amplitude ratio."""
    return 10 ** (np.asarray(d) / 20)


def midi_to_hz(m):
    return 440.0 * 2 ** ((np.asarray(m) - 69) / 12)


def hz_to_midi(f):
    return 69 + 12 * np.log2(np.asarray(f) / 440.0)


def note_name(f: float) -> str:
    """Nearest note and octave, e.g. 'A4' (same rule as the firmware's notes.h)."""
    n = int(round(float(hz_to_midi(f))))
    return f"{NOTE_NAMES[n % 12]}{n // 12 - 1}"


# --- fixed point -------------------------------------------------------------

Q15_ONE = 32767


def sat16(x):
    """Saturate to int16 (works on scalars and arrays)."""
    return np.clip(np.asarray(x, dtype=np.int64), -32768, 32767).astype(np.int16)


def q15_mul(a, b):
    """(a * b) >> 15 in int32, then saturated — the multiply the firmware does."""
    return sat16((np.asarray(a, dtype=np.int32) * np.asarray(b, dtype=np.int32)) >> 15)


# --- spectra -----------------------------------------------------------------

def spectrum_db(x: np.ndarray, fs: int = FS, window: str = "hann") -> tuple[np.ndarray, np.ndarray]:
    """One-sided magnitude spectrum in dB, normalized so a full-scale sine reads 0 dB.

    Returns (freqs_hz, mags_db).
    """
    x = np.asarray(x)
    x = x / 32768.0 if x.dtype == np.int16 else x.astype(np.float64)
    w = np.hanning(len(x)) if window == "hann" else np.ones(len(x))
    mag = np.abs(np.fft.rfft(x * w)) / (w.sum() / 2)
    return np.fft.rfftfreq(len(x), 1 / fs), db(mag)


def peak_hz(x: np.ndarray, fs: int = FS) -> float:
    """Frequency of the strongest spectral component (parabolic interpolation)."""
    f, m = spectrum_db(x, fs)
    i = int(np.argmax(m[1:-1])) + 1
    a, b, c = m[i - 1], m[i], m[i + 1]
    offset = 0.5 * (a - c) / (a - 2 * b + c)
    return float((i + offset) * (f[1] - f[0]))


def plot_spectrum(x: np.ndarray, fs: int = FS, f0: float | None = None, ax=None,
                  fmax: float | None = None, floor_db: float = -100, label: str | None = None):
    """Log-magnitude spectrum; with f0, dotted lines mark its harmonics."""
    import matplotlib.pyplot as plt

    f, m = spectrum_db(x, fs)
    ax = ax or plt.subplots(figsize=(9, 3))[1]
    ax.plot(f, m, lw=0.8, label=label)
    if f0:
        for h in np.arange(f0, (fmax or fs / 2), f0):
            ax.axvline(h, color="gray", lw=0.4, ls=":")
    ax.set_xlim(0, fmax or fs / 2)
    ax.set_ylim(floor_db, 5)
    ax.set_xlabel("Hz")
    ax.set_ylabel("dB")
    if label:
        ax.legend()
    return ax


# --- checks ------------------------------------------------------------------

def check(condition: bool, what: str, hint: str = "") -> None:
    """Used by the notebooks' check cells: prints a tick, or fails with a hint."""
    if not condition:
        raise AssertionError(f"✗ {what}" + (f" — {hint}" if hint else ""))
    print(f"✓ {what}")


class Todo(Exception):
    """Raised by unfinished scaffold cells."""


def todo(what: str = "this step"):
    raise Todo(f"TODO: {what}")
