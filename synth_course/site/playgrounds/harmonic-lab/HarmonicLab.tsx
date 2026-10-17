"use client";
// Module 07 lab: draw a harmonic spectrum with 32 sliders, hear it through the
// engine's integer wavetable oscillator, and switch band-limiting off / per
// octave (mip-map) / exact to hear aliasing and the mip boundaries.
import { useEffect, useMemo, useRef, useState } from "react";
import { freqToNoteName, mapPitchHz, SAMPLE_RATE_HZ } from "../shared/firmware";
import { useEngine } from "../shared/useEngine";
import { AudioButton, Canvas, Slider, Spectrum } from "../shared/ui";
import {
  buildMipTables,
  buildTable,
  harmonicsForFreq,
  harmonicsForLevel,
  MIP_BASE_HZ,
  mipLevelForFreq,
  tableBytes,
} from "../shared/wavetables";
import type { PlaygroundProps } from "../types";

const HARMONICS = 32;
const PITCH_MIN_HZ = 80;
const PITCH_MAX_HZ = 4000;
const SWEEP_SECONDS = 10;

type Mode = "off" | "mip" | "exact";

export interface HarmonicLabState {
  weights: number[]; // 0..1, index 0 = fundamental
  pitch: number; // 0..1 along an exponential 80 Hz – 4 kHz map
  mode: Mode;
  volume: number; // 0..1
}

const shape = (f: (n: number) => number) => Array.from({ length: HARMONICS }, (_, h) => Math.abs(f(h + 1)));
const SHAPES: Record<string, number[]> = {
  saw: shape((n) => 1 / n),
  square: shape((n) => (n % 2 ? 1 / n : 0)),
  triangle: shape((n) => (n % 2 ? 1 / (n * n) : 0)),
  octaves: shape((n) => ((n & (n - 1)) === 0 ? 1 / n : 0)),
  sine: shape((n) => (n === 1 ? 1 : 0)),
};
// triangle alternates signs; the sliders show magnitudes, the table keeps the sign
const signed = (weights: number[], shapeName: string | null) =>
  shapeName === "triangle" ? weights.map((w, h) => (h % 4 === 2 ? -w : w)) : weights;

export const harmonicLabDefault: HarmonicLabState = { weights: SHAPES.saw, pitch: 0.35, mode: "mip", volume: 0.5 };

const matchShape = (weights: number[]) =>
  Object.entries(SHAPES).find(([, s]) => s.every((v, i) => Math.abs(v - weights[i]) < 1e-9))?.[0] ?? null;

export function HarmonicLab({ state, setState }: PlaygroundProps<HarmonicLabState>) {
  const engine = useEngine();
  const { post } = engine;
  const [sweeping, setSweeping] = useState(false);
  const sweepStart = useRef(0);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const freq = mapPitchHz(state.pitch, PITCH_MIN_HZ, PITCH_MAX_HZ);
  const shapeName = matchShape(state.weights);
  const weights = useMemo(() => signed(state.weights, shapeName), [state.weights, shapeName]);
  const lastHarmonic = weights.reduce((last, w, h) => (w !== 0 ? h + 1 : last), 0);

  // Tables: rebuilt when the spectrum or mode changes (and per note in "exact" mode).
  const exactHarmonics = state.mode === "exact" ? harmonicsForFreq(freq, HARMONICS) : 0;
  const tables = useMemo(() => {
    if (state.mode === "mip") return buildMipTables(weights);
    if (state.mode === "exact") return [buildTable(weights, exactHarmonics)];
    return [buildTable(weights, HARMONICS)];
  }, [weights, state.mode, exactHarmonics]);

  useEffect(() => post({ type: "tables", set: "lab", levels: tables, baseHz: MIP_BASE_HZ }), [post, tables]);
  useEffect(() => post({ type: "voices", voices: [{ set: "lab", freqHz: freq, level: 1 }] }), [post, freq]);
  useEffect(() => post({ type: "master", gain: state.volume }), [post, state.volume]);

  // Sweep: glide the pitch 80 Hz → 4 kHz so aliases (and mip steps) are easy to hear.
  useEffect(() => {
    if (!sweeping) return;
    sweepStart.current = performance.now();
    const t = setInterval(() => {
      const p = (performance.now() - sweepStart.current) / 1000 / SWEEP_SECONDS;
      if (p >= 1) setSweeping(false);
      setState({ ...stateRef.current, pitch: Math.min(1, p) });
    }, 30);
    return () => clearInterval(t);
  }, [sweeping, setState]);

  const level = mipLevelForFreq(freq);
  const kept =
    state.mode === "mip" ? harmonicsForLevel(level, HARMONICS) : state.mode === "exact" ? exactHarmonics : HARMONICS;
  const keptNonZero = Math.min(kept, lastHarmonic);
  const topComponentHz = keptNonZero * freq;
  const aliasing = topComponentHz > SAMPLE_RATE_HZ / 2;
  const table = tables[state.mode === "mip" ? level : 0];

  const set = (patch: Partial<HarmonicLabState>) => setState({ ...state, ...patch });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <AudioButton state={engine.state} onClick={engine.toggle} error={engine.error} />
        <button
          onClick={() => setSweeping(!sweeping)}
          className="rounded-md border border-line px-3 py-2 text-sm hover:bg-subtle"
        >
          {sweeping ? "Stop sweep" : `Sweep 80 Hz → 4 kHz (${SWEEP_SECONDS} s)`}
        </button>
        <div className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["off", "mip", "exact"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => set({ mode: m })}
              className={`px-3 py-2 ${state.mode === m ? "bg-accent text-bg" : "hover:bg-subtle"}`}
            >
              {m === "off" ? "No band-limit" : m === "mip" ? "Per octave" : "Exact per note"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <Slider
            label="Pitch"
            value={state.pitch}
            min={0}
            max={1}
            step={0.001}
            onChange={(pitch) => set({ pitch })}
            display={`${freq.toFixed(1)} Hz · ${freqToNoteName(freq)}`}
          />
          <Slider
            label="Volume"
            value={state.volume}
            min={0}
            max={1}
            step={0.01}
            onChange={(volume) => set({ volume })}
            display={`${Math.round(state.volume * 100)}%`}
          />
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-line p-3 text-sm">
          <dt className="text-muted">Mip level</dt>
          <dd>{state.mode === "mip" ? `${level} (${MIP_BASE_HZ * 2 ** level}–${MIP_BASE_HZ * 2 ** (level + 1)} Hz)` : "—"}</dd>
          <dt className="text-muted">Harmonics kept</dt>
          <dd>{keptNonZero}</dd>
          <dt className="text-muted">Highest component</dt>
          <dd className={aliasing ? "text-warn" : ""}>
            {Math.round(topComponentHz)} Hz {aliasing && "— above Nyquist, aliasing"}
          </dd>
          <dt className="text-muted">Table RAM</dt>
          <dd>
            {tableBytes(tables.length) / 1024} KB ({tables.length} table{tables.length > 1 ? "s" : ""})
          </dd>
        </dl>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Harmonics</span>
          {Object.keys(SHAPES).map((name) => (
            <button
              key={name}
              onClick={() => set({ weights: SHAPES[name] })}
              className={`rounded-md border px-2 py-0.5 ${shapeName === name ? "border-accent text-accent" : "border-line hover:bg-subtle"}`}
            >
              {name}
            </button>
          ))}
        </div>
        <HarmonicBars weights={state.weights} kept={kept} onChange={(weights) => set({ weights })} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <div>
          <div className="mb-1 text-sm text-muted">One period of the table being played</div>
          <Canvas
            height={180}
            draw={(ctx, w, h) => {
              ctx.fillStyle = "#000";
              ctx.fillRect(0, 0, w, h);
              ctx.strokeStyle = "#333";
              ctx.beginPath();
              ctx.moveTo(0, h / 2);
              ctx.lineTo(w, h / 2);
              ctx.stroke();
              ctx.strokeStyle = "#6cf0a8";
              ctx.beginPath();
              table.forEach((v, i) => {
                const x = (i / (table.length - 1)) * w;
                const y = h / 2 - (v / 32768) * (h / 2 - 4);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.stroke();
            }}
          />
        </div>
        <div>
          <div className="mb-1 text-sm text-muted">Output spectrum (live)</div>
          <Spectrum
            analyser={engine.analyser}
            height={180}
            markers={[{ hz: freq, label: "f₀" }]}
          />
        </div>
      </div>
    </div>
  );
}

// 32 vertical bars; drag across them to draw a spectrum. Bars beyond `kept` are dimmed.
function HarmonicBars({ weights, kept, onChange }: { weights: number[]; kept: number; onChange: (w: number[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const setAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const h = Math.max(0, Math.min(HARMONICS - 1, Math.floor(((e.clientX - r.left) / r.width) * HARMONICS)));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    onChange(weights.map((w, i) => (i === h ? Math.round(v * 100) / 100 : w)));
  };
  return (
    <div
      ref={ref}
      className="flex h-40 cursor-crosshair touch-none select-none items-end gap-px rounded-md border border-line bg-subtle p-1"
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setAt(e);
      }}
      onPointerMove={(e) => dragging.current && setAt(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      {weights.map((w, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`harmonic ${i + 1}: ${w.toFixed(2)}`}>
          <div className={`rounded-t-sm ${i < kept ? "bg-accent" : "bg-muted opacity-40"}`} style={{ height: `${w * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

