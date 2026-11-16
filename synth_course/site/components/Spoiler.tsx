import type { ReactNode } from "react";

// The "Compare (spoiler)" section: collapsed by default, with a nudge if the
// module's milestones aren't all ticked yet.
export function Spoiler({ done, solutionUrl, children }: { done: boolean; solutionUrl?: string; children: ReactNode }) {
  return (
    <details className="group my-8 rounded-lg border border-line px-5 py-3 open:pb-5">
      <summary className="cursor-pointer select-none font-semibold">
        Compare with the reference (spoiler)
        {!done && (
          <span className="ml-2 text-sm font-normal text-warn">
            — your milestones aren&apos;t all ticked yet; finish them first
          </span>
        )}
      </summary>
      {children}
      {solutionUrl && (
        <p>
          Worked notebook:{" "}
          <a href={solutionUrl} target="_blank" rel="noreferrer">
            solution notebook ↗
          </a>{" "}
          (compare once your own cells pass their checks).
        </p>
      )}
    </details>
  );
}
