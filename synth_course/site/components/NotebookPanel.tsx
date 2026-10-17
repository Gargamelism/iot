"use client";
import { useState } from "react";

// The module's notebook, embedded from the JupyterLab server that runs in the
// same container. Loaded on demand so module pages stay light.
export function NotebookPanel({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section id="notebook" className="not-prose my-10 rounded-lg border border-line">
      <div className="flex items-center gap-3 px-4 py-3">
        <h2 className="font-semibold">Notebook</h2>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-md border border-line px-3 py-1 text-sm hover:bg-subtle"
        >
          {open ? "Close" : "Open notebook"}
        </button>
        <a href={src} target="_blank" rel="noreferrer" className="ml-auto text-sm text-muted hover:text-fg">
          pop out ↗
        </a>
      </div>
      {open && <iframe src={src} title="Notebook" className="h-[80vh] w-full rounded-b-lg border-t border-line" />}
    </section>
  );
}
