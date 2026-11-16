"use client";
import { useOptimistic, useTransition } from "react";
import { toggleMilestone } from "@/app/actions";
import type { Milestone } from "@/lib/content";

export function MilestoneChecklist({
  moduleId,
  milestones,
  checked,
}: {
  moduleId: string;
  milestones: Milestone[];
  checked: string[];
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    new Set(checked),
    (state, { id, on }: { id: string; on: boolean }) => {
      const next = new Set(state);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    },
  );
  const [, startTransition] = useTransition();

  return (
    <ul className="not-prose my-4 space-y-2">
      {milestones.map((m) => {
        const on = optimistic.has(m.id);
        return (
          <li key={m.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 hover:bg-subtle">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-accent"
                checked={on}
                onChange={() =>
                  startTransition(async () => {
                    setOptimistic({ id: m.id, on: !on });
                    await toggleMilestone(moduleId, m.id, !on);
                  })
                }
              />
              <span className={on ? "text-muted line-through decoration-1" : ""}>{m.text}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
