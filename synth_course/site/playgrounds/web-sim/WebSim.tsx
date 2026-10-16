"use client";
// Port of web_sim/ (app.js + analyzer.js) as a playground: the early 3-osc
// firmware's controls (smoothed, noisy "ADC" pots), DDS oscillators (in the
// worklet), OLED layout and per-oscillator triggered scopes.
import { useEffect, useRef, useState } from "react";
import {
  ADC_EMA_ALPHA,
  ADC_HYSTERESIS_COUNTS,
  ADC_MAX_COUNT,
  FREQ_MAX_HZ,
  FREQ_MIN_HZ,
  OLED_VISIBLE_HEIGHT,
  OLED_VISIBLE_WIDTH,
  SAMPLE_RATE_HZ,
  adcNoise,
  clamp01,
  freqToNoteName,
  mapPitchHz,
  smoothValue,
  type SmoothState,
} from "../shared/firmware";
import type { PlaygroundProps } from "../types";

const NUM_OSCILLATORS = 3;
const NUM_PITCH_POTS = 2; // osc 3 had no pitch pot on this board
const OSC3_FIXED_FREQ_HZ = 220.0;
const DISPLAY_REFRESH_MS = 100;
const CONTROL_TICK_MS = 16; // ~loop() cadence
const OLED_OSC_ROW_TOP_PX = 12;
const OLED_OSC_ROW_SPACING_PX = 9;
const OLED_TEXT_HEIGHT_PX = 8;
const OLED_VOL_BAR_X_PX = 32;
const SCOPE_FFT_SIZE = 2048;
const SCOPE_WINDOW_SAMPLES = 768;

export interface WebSimState {
  pitch: number[]; // raw slider counts, 0..ADC_MAX_COUNT
  vol: number[];
}

export const webSimDefault: WebSimState = { pitch: [0, 0, 0], vol: [0, 0, 0] };

export function WebSim({ state, setState }: PlaygroundProps<WebSimState>) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const freqHz = useRef<number[]>([FREQ_MIN_HZ, FREQ_MIN_HZ, OSC3_FIXED_FREQ_HZ]);
  const volume = useRef<number[]>([0, 0, 0]);
  const smooth = useRef<{ vol: SmoothState[]; pitch: SmoothState[] } | null>(null);
  const oledRef = useRef<HTMLCanvasElement>(null);
  const scopeRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const audio = useRef<{ ctx: AudioContext; node: AudioWorkletNode } | null>(null);
  const [readouts, setReadouts] = useState({ freq: [0, 0, 0], vol: [0, 0, 0] });
  const [started, setStarted] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // controlsUpdate(), ticking like loop()
  useEffect(() => {
    // controlsBegin(): seed filtered/lastRaw from the initial reading
    const s0 = stateRef.current;
    const sm = (smooth.current = {
      vol: s0.vol.map((v) => ({ filtered: v, lastRaw: v })),
      pitch: s0.pitch.map((p) => ({ filtered: p, lastRaw: p })),
    });
    const tick = setInterval(() => {
      const s = stateRef.current;
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        const volFiltered = smoothValue(s.vol[i] + adcNoise(), sm.vol[i], ADC_HYSTERESIS_COUNTS, ADC_EMA_ALPHA);
        volume.current[i] = clamp01(volFiltered / ADC_MAX_COUNT);
        if (i < NUM_PITCH_POTS) {
          const pitchFiltered = smoothValue(
            s.pitch[i] + adcNoise(),
            sm.pitch[i],
            ADC_HYSTERESIS_COUNTS,
            ADC_EMA_ALPHA,
          );
          freqHz.current[i] = mapPitchHz(clamp01(pitchFiltered / ADC_MAX_COUNT), FREQ_MIN_HZ, FREQ_MAX_HZ);
        }
      }
      audio.current?.node.port.postMessage({ freqHz: freqHz.current.slice(), volume: volume.current.slice() });
    }, CONTROL_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  // displayUpdate(), every DISPLAY_REFRESH_MS
  useEffect(() => {
    const draw = () => {
      setReadouts({ freq: freqHz.current.slice(), vol: volume.current.slice() });
      const ctx = oledRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, OLED_VISIBLE_WIDTH, OLED_VISIBLE_HEIGHT);
      ctx.fillStyle = ctx.strokeStyle = "#f5f5f5";
      ctx.lineWidth = 1;
      ctx.font = "8px monospace";
      ctx.textBaseline = "top";
      ctx.fillText("3-OSC SYNTH", 0, 0);
      if (!volume.current.some((v) => v > 0)) {
        const y = Math.round(OLED_VISIBLE_HEIGHT / 2) + 0.5; // silent: flatline
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(OLED_VISIBLE_WIDTH, y);
        ctx.stroke();
        return;
      }
      const barW = OLED_VISIBLE_WIDTH - OLED_VOL_BAR_X_PX;
      for (let i = 0; i < NUM_OSCILLATORS; i++) {
        const rowY = OLED_OSC_ROW_TOP_PX + i * OLED_OSC_ROW_SPACING_PX;
        ctx.fillText(`${i + 1}${i < NUM_PITCH_POTS ? " " : "*"}${freqToNoteName(freqHz.current[i])}`, 0, rowY);
        ctx.strokeRect(OLED_VOL_BAR_X_PX + 0.5, rowY + 0.5, barW - 1, OLED_TEXT_HEIGHT_PX - 1);
        const fillW = Math.round(volume.current[i] * (barW - 2));
        if (fillW > 0) ctx.fillRect(OLED_VOL_BAR_X_PX + 1, rowY + 1, fillW, OLED_TEXT_HEIGHT_PX - 2);
      }
    };
    draw();
    const t = setInterval(draw, DISPLAY_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => void audio.current?.ctx.close(), []);

  async function toggleAudio() {
    try {
      if (!audio.current) {
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
        await ctx.audioWorklet.addModule("/worklets/web-sim-processor.js");
        const node = new AudioWorkletNode(ctx, "web-sim-processor", {
          numberOfInputs: 0,
          numberOfOutputs: NUM_OSCILLATORS + 1,
          outputChannelCount: [2, 1, 1, 1],
        });
        node.connect(ctx.destination, 0);
        audio.current = { ctx, node };
        startScopes(ctx, node, scopeRefs.current);
        setStarted(true);
        setRunning(true);
        return;
      }
      const { ctx } = audio.current;
      if (ctx.state === "running") await ctx.suspend();
      else await ctx.resume();
      setRunning(ctx.state === "running");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  const setSlider = (kind: "pitch" | "vol", i: number, value: number) =>
    setState({ ...state, [kind]: state[kind].map((v, j) => (j === i ? value : v)) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6">
        <canvas
          ref={oledRef}
          width={OLED_VISIBLE_WIDTH}
          height={OLED_VISIBLE_HEIGHT}
          className="rounded border-4 border-neutral-800 bg-black [image-rendering:pixelated]"
          style={{ width: OLED_VISIBLE_WIDTH * 4, height: OLED_VISIBLE_HEIGHT * 4 }}
        />
        <div className="space-y-2">
          <button
            onClick={toggleAudio}
            className={`rounded-md border px-4 py-2 ${running ? "border-accent text-accent" : "border-line"}`}
          >
            {!started ? "Start audio" : running ? "Mute" : "Unmute"}
          </button>
          <p className="text-sm text-muted">
            All oscillators boot at volume 0, like the firmware. Raise a volume fader to hear a tone.
          </p>
          {error && <p className="text-sm text-warn">Audio failed to start: {error}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: NUM_OSCILLATORS }, (_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-line p-4">
            <h3 className="font-medium">OSC {i + 1}</h3>
            <label className="block text-sm">
              Pitch{i < NUM_PITCH_POTS ? "" : " (fixed)"}{" "}
              <span className="text-muted">{Math.round(readouts.freq[i])} Hz</span>
              <input
                type="range"
                min={0}
                max={ADC_MAX_COUNT}
                value={state.pitch[i]}
                disabled={i >= NUM_PITCH_POTS}
                onChange={(e) => setSlider("pitch", i, Number(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
            <label className="block text-sm">
              Volume <span className="text-muted">{Math.round(readouts.vol[i] * 100)}%</span>
              <input
                type="range"
                min={0}
                max={ADC_MAX_COUNT}
                value={state.vol[i]}
                onChange={(e) => setSlider("vol", i, Number(e.target.value))}
                className="w-full accent-accent"
              />
            </label>
            <canvas
              ref={(el) => {
                scopeRefs.current[i] = el;
              }}
              width={190}
              height={120}
              className="w-full rounded bg-black"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// analyzer.js: one AnalyserNode per oscillator tap, drawn as a triggered scope.
function startScopes(ctx: AudioContext, node: AudioWorkletNode, canvases: (HTMLCanvasElement | null)[]) {
  const keepAlive = ctx.createGain(); // analysers only run if reachable from the destination
  keepAlive.gain.value = 0;
  keepAlive.connect(ctx.destination);
  const analysers = canvases.map((_, i) => {
    const a = ctx.createAnalyser();
    a.fftSize = SCOPE_FFT_SIZE;
    node.connect(a, i + 1);
    a.connect(keepAlive);
    return a;
  });
  const buffers = analysers.map((a) => new Uint8Array(a.fftSize));
  const draw = () => {
    if (ctx.state === "closed") return;
    analysers.forEach((a, i) => {
      const canvas = canvases[i];
      const g = canvas?.getContext("2d");
      if (!canvas || !g) return;
      a.getByteTimeDomainData(buffers[i]);
      // trigger on a rising zero crossing so the trace holds still
      const data = buffers[i];
      let start = 0;
      for (let k = 1; k < data.length - SCOPE_WINDOW_SAMPLES; k++) {
        if (data[k - 1] < 128 && data[k] >= 128) {
          start = k;
          break;
        }
      }
      const slice = data.subarray(start, start + SCOPE_WINDOW_SAMPLES);
      g.fillStyle = "#000";
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = "#6cf0a8";
      g.lineWidth = 1.5;
      g.beginPath();
      slice.forEach((v, k) => {
        const x = (k * canvas.width) / (slice.length - 1);
        const y = (v / 255) * canvas.height;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    });
    requestAnimationFrame(draw);
  };
  draw();
}
