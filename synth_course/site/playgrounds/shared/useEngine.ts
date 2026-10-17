"use client";
// Starts the shared engine worklet on a user gesture and exposes post() plus an
// AnalyserNode on the output for Scope/Spectrum views.
import { useCallback, useEffect, useRef, useState } from "react";
import { SAMPLE_RATE_HZ } from "./firmware";

export interface EngineStatus {
  clipped: boolean;
  levels: number[];
}

export function useEngine() {
  const ref = useRef<{ ctx: AudioContext; node: AudioWorkletNode; analyser: AnalyserNode } | null>(null);
  const pending = useRef<unknown[]>([]);
  const [state, setState] = useState<"off" | "running" | "suspended">("off");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [status, setStatus] = useState<EngineStatus>({ clipped: false, levels: [] });
  const [error, setError] = useState<string | null>(null);

  // Messages sent before audio starts are queued and replayed on start.
  const post = useCallback((msg: unknown) => {
    if (ref.current) ref.current.node.port.postMessage(msg);
    else pending.current.push(msg);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (!ref.current) {
        const ctx = new AudioContext({ sampleRate: SAMPLE_RATE_HZ });
        await ctx.audioWorklet.addModule("/worklets/engine.js");
        const node = new AudioWorkletNode(ctx, "engine", { numberOfInputs: 0, outputChannelCount: [2] });
        const an = ctx.createAnalyser();
        an.fftSize = 8192;
        an.smoothingTimeConstant = 0.2;
        node.connect(ctx.destination);
        node.connect(an);
        node.port.onmessage = (e) => e.data.type === "status" && setStatus(e.data);
        ref.current = { ctx, node, analyser: an };
        for (const m of pending.current) node.port.postMessage(m);
        pending.current = [];
        setAnalyser(an);
        setState("running");
        return;
      }
      const { ctx } = ref.current;
      if (ctx.state === "running") await ctx.suspend();
      else await ctx.resume();
      setState(ctx.state === "running" ? "running" : "suspended");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, []);

  useEffect(() => () => void ref.current?.ctx.close(), []);

  return { post, toggle, state, analyser, status, error };
}
