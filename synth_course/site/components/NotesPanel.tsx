"use client";
import { useEffect, useRef, useState } from "react";
import { saveNote } from "@/app/actions";

// Autosaving textarea for one notes slot ('module', 'dq-1', ...).
function NoteBox({ moduleId, slot, label, initial }: { moduleId: string; slot: string; label: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"saved" | "editing" | "saving">("saved");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(text: string) {
    setValue(text);
    setStatus("editing");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      await saveNote(moduleId, slot, text);
      setStatus("saved");
    }, 600);
  }

  return (
    <label className="block">
      <span className="flex justify-between text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted">{status === "saved" ? "" : status === "saving" ? "saving…" : "…"}</span>
      </span>
      <textarea
        className="mt-1 w-full rounded-md border border-line bg-bg p-2 font-mono text-sm"
        rows={slot === "module" ? 6 : 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function NotesPanel({
  moduleId,
  questionCount,
  notes,
}: {
  moduleId: string;
  questionCount: number;
  notes: Record<string, string>;
}) {
  return (
    <div className="space-y-4">
      <NoteBox moduleId={moduleId} slot="module" label="Module notes" initial={notes.module ?? ""} />
      {Array.from({ length: questionCount }, (_, i) => (
        <NoteBox
          key={i}
          moduleId={moduleId}
          slot={`dq-${i + 1}`}
          label={`Design question ${i + 1}`}
          initial={notes[`dq-${i + 1}`] ?? ""}
        />
      ))}
    </div>
  );
}
