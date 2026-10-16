"use client";
import { useState, useTransition } from "react";
import { deletePreset, savePreset } from "@/app/actions";
import { PLAYGROUND_COMPONENTS } from "@/playgrounds/components";

// Owns a playground's state and its named presets (saved in SQLite).
export function PlaygroundHost({ id, initialPresets }: { id: string; initialPresets: { name: string; json: string }[] }) {
  const entry = PLAYGROUND_COMPONENTS[id];
  const [state, setState] = useState<unknown>(entry.defaultState);
  const [presets, setPresets] = useState(initialPresets);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const { Component } = entry;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3 text-sm">
        <span className="font-medium">Presets</span>
        <select
          className="rounded-md border border-line bg-bg px-2 py-1"
          value=""
          onChange={(e) => {
            const p = presets.find((x) => x.name === e.target.value);
            if (p) {
              setState(JSON.parse(p.json));
              setName(p.name);
            }
          }}
        >
          <option value="">{presets.length ? "Load…" : "none saved"}</option>
          {presets.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
        <input
          className="rounded-md border border-line bg-bg px-2 py-1"
          placeholder="preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={!name.trim() || pending}
          className="rounded-md border border-line px-3 py-1 hover:bg-subtle disabled:opacity-50"
          onClick={() => startTransition(async () => setPresets(await savePreset(id, name.trim(), JSON.stringify(state))))}
        >
          Save
        </button>
        <button
          disabled={!presets.some((p) => p.name === name.trim()) || pending}
          className="rounded-md border border-line px-3 py-1 hover:bg-subtle disabled:opacity-50"
          onClick={() => startTransition(async () => setPresets(await deletePreset(id, name.trim())))}
        >
          Delete
        </button>
        <button className="ml-auto text-muted hover:text-fg" onClick={() => setState(entry.defaultState)}>
          Reset
        </button>
      </div>
      <Component state={state as never} setState={setState as never} />
    </div>
  );
}
