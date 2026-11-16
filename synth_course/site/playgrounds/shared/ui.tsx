"use client";
// Small UI pieces shared by the playgrounds.
import { useEffect, useRef, type ReactNode } from "react";

export function AudioButton({
  state,
  onClick,
  error,
}: {
  state: "off" | "running" | "suspended";
  onClick: () => void;
  error?: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        className={`rounded-md border px-4 py-2 ${state === "running" ? "border-accent text-accent" : "border-line"}`}
      >
        {state === "off" ? "Start audio" : state === "running" ? "Mute" : "Unmute"}
      </button>
      {error && <span className="text-sm text-warn">Audio failed: {error}</span>}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  display,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  display?: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-muted">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

// Draws `draw(ctx, w, h)` on a canvas whenever its inputs change.
export function Canvas({
  draw,
  height = 160,
  className = "",
}: {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, c.clientWidth, height);
  });
  return <canvas ref={ref} style={{ height }} className={`w-full rounded-md bg-black ${className}`} />;
}

// AnalyserNode divides by fftSize and uses a Blackman window (mean 0.42), so a
// full-scale sine reads 20·log10(0.42 / 2) ≈ −13.6 dB. Adding it back makes a
// full-scale sine read 0 dB, the same convention as the notebooks.
const ANALYSER_SINE_OFFSET_DB = 13.6;

// Live log-magnitude spectrum of an AnalyserNode, 0 .. maxHz, with optional
// dotted markers (e.g. Nyquist, harmonics).
export function Spectrum({
  analyser,
  maxHz = 22050,
  markers = [],
  height = 180,
}: {
  analyser: AnalyserNode | null;
  maxHz?: number;
  markers?: { hz: number; label?: string }[];
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef(markers);
  useEffect(() => {
    markersRef.current = markers;
  });
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    let raf = 0;
    const bins = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    const frame = () => {
      const w = (c.width = c.clientWidth);
      const h = (c.height = height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const minDb = -110;
      const maxDb = 0;
      ctx.strokeStyle = "#333";
      ctx.fillStyle = "#777";
      ctx.font = "10px monospace";
      for (let d = -100; d <= 0; d += 20) {
        const y = ((maxDb - d) / (maxDb - minDb)) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillText(`${d} dB`, 4, y - 2);
      }
      for (const m of markersRef.current) {
        const x = (m.hz / maxHz) * w;
        ctx.strokeStyle = "#a15c07";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);
        if (m.label) ctx.fillText(m.label, x + 3, 12);
      }
      if (analyser && bins) {
        analyser.getFloatFrequencyData(bins);
        const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
        ctx.strokeStyle = "#6cf0a8";
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const bin = Math.min(bins.length - 1, Math.round(((x / w) * maxHz) / hzPerBin));
          const d = Math.max(minDb, Math.min(maxDb, bins[bin] + ANALYSER_SINE_OFFSET_DB));
          const y = ((maxDb - d) / (maxDb - minDb)) * h;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        ctx.fillText("start audio to see the spectrum", w / 2 - 90, h / 2);
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [analyser, maxHz, height]);
  return <canvas ref={ref} style={{ height }} className="w-full rounded-md bg-black" />;
}
