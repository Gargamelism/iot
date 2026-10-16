import { Suspense } from "react";
import Link from "next/link";
import { io } from "next/cache";
import { getAllModules } from "@/lib/content";
import { store } from "@/lib/db";
import { setStartDate } from "./actions";

const MS_PER_WEEK = 7 * 24 * 3600 * 1000;

// Request-time value: this page is dynamic (await io() below), so "now" is fine.
function courseWeek(startDate: string): number {
  return Math.floor((Date.now() - Date.parse(startDate)) / MS_PER_WEEK) + 1;
}

export default function Dashboard() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  await io();
  const modules = await getAllModules();
  const checked = store.checkedMilestones();
  const checkedSet = new Set(checked.map((c) => `${c.module_id}/${c.milestone_id}`));
  const known = new Set(modules.flatMap((m) => m.meta.milestones.map((ms) => `${m.meta.id}/${ms.id}`)));
  const orphaned = [...checkedSet].filter((k) => !known.has(k));

  const progress = (id: string, total: number) =>
    total === 0 ? 0 : modules.find((m) => m.meta.id === id)!.meta.milestones.filter((ms) => checkedSet.has(`${id}/${ms.id}`)).length / total;
  const isDone = (id: string) => {
    const m = modules.find((x) => x.meta.id === id);
    return !!m && progress(id, m.meta.milestones.length) === 1;
  };

  const startDate = store.setting("startDate");
  const week = startDate ? courseWeek(startDate) : null;
  const totalMilestones = modules.reduce((n, m) => n + m.meta.milestones.length, 0);

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Build a Wavetable Synth on an ESP32-C3</h1>
          <p className="mt-1 text-muted">
            {checkedSet.size - orphaned.length} of {totalMilestones} milestones ticked
            {week !== null && ` · you're in week ${week} (started ${startDate})`}
          </p>
        </div>
        <form action={setStartDate} className="flex items-center gap-2 text-sm">
          <label htmlFor="startDate" className="text-muted">
            Course start
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={startDate}
            className="rounded-md border border-line bg-bg px-2 py-1"
          />
          <button className="rounded-md border border-line px-3 py-1 hover:bg-subtle">Set</button>
        </form>
      </section>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(({ meta }) => {
          const p = progress(meta.id, meta.milestones.length);
          const blocked = meta.prereqs.some((pr) => !isDone(pr));
          return (
            <li key={meta.id}>
              <Link
                href={`/modules/${meta.id}`}
                className={`block h-full rounded-lg border border-line p-4 hover:bg-subtle ${blocked && p === 0 ? "opacity-60" : ""}`}
              >
                <div className="flex justify-between text-xs text-muted">
                  <span>Module {meta.id.slice(0, 2)}</span>
                  <span>{meta.weeks} wk</span>
                </div>
                <div className="mt-1 font-medium">{meta.title}</div>
                <div className="mt-3 h-1.5 rounded-full bg-subtle">
                  <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.round(p * 100)}%` }} />
                </div>
                <div className="mt-2 text-xs text-muted">
                  {Math.round(p * meta.milestones.length)}/{meta.milestones.length} milestones
                  {meta.prereqs.length > 0 && ` · needs ${meta.prereqs.map((x) => x.slice(0, 2)).join(", ")}`}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      {orphaned.length > 0 && (
        <section className="rounded-lg border border-warn p-4 text-sm">
          <h2 className="font-medium text-warn">Orphaned ticks</h2>
          <p className="text-muted">These milestones are ticked in your database but no longer exist in the course:</p>
          <ul className="mt-2 list-disc pl-5 font-mono">
            {orphaned.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
