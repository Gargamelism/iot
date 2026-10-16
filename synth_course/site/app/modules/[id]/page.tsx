import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { designQuestionCount, getAllModules, getModule, sectionBody } from "@/lib/content";
import { store } from "@/lib/db";
import { renderMdx, wrapSpoiler } from "@/lib/mdx";
import { MilestoneChecklist } from "@/components/MilestoneChecklist";
import { NotesPanel } from "@/components/NotesPanel";
import { Spoiler } from "@/components/Spoiler";
import { PLAYGROUNDS } from "@/playgrounds/meta";

export default function ModulePage({ params }: PageProps<"/modules/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <ModulePageContent params={params} />
    </Suspense>
  );
}

async function ModulePageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await io();
  const mod = await getModule(id);
  if (!mod) notFound();
  const { meta, body } = mod;

  const all = await getAllModules();
  const checkedRows = store.checkedMilestones();
  const checkedIn = (moduleId: string) =>
    new Set(checkedRows.filter((r) => r.module_id === moduleId).map((r) => r.milestone_id));
  const checked = [...checkedIn(id)].filter((c) => meta.milestones.some((m) => m.id === c));
  const done = checked.length === meta.milestones.length;
  const prereqStatus = meta.prereqs.map((p) => {
    const m = all.find((x) => x.meta.id === p);
    const c = checkedIn(p);
    return { id: p, title: m?.meta.title ?? p, done: !!m && m.meta.milestones.every((ms) => c.has(ms.id)) };
  });
  // "**Core (≈4.5 h)**" in the Read section
  const readHours = Number(sectionBody(body, "Read").match(/Core \(≈\s*([\d.]+)\s*h/)?.[1] ?? 0);
  const playgrounds = PLAYGROUNDS.filter((p) => p.module === id);
  const index = all.findIndex((m) => m.meta.id === id);
  const prev = all[index - 1]?.meta;
  const next = all[index + 1]?.meta;

  const content = await renderMdx(wrapSpoiler(body), {
    Milestones: () => <MilestoneChecklist moduleId={id} milestones={meta.milestones} checked={checked} />,
    Spoiler: ({ children }) => <Spoiler done={done}>{children}</Spoiler>,
  });

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:scroll-mt-20 prose-pre:text-sm">
        <p className="not-prose text-sm text-muted">
          Module {id.slice(0, 2)} · {meta.weeks} week{meta.weeks === 1 ? "" : "s"}
        </p>
        <h1>{meta.title}</h1>
        {content}
        <nav className="not-prose mt-12 flex justify-between border-t border-line pt-4 text-sm">
          {prev ? <Link href={`/modules/${prev.id}`}>← {prev.title}</Link> : <span />}
          {next ? <Link href={`/modules/${next.id}`}>{next.title} →</Link> : <span />}
        </nav>
      </article>

      <aside className="space-y-6 text-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
        <section>
          <h2 className="font-medium">Progress</h2>
          <div className="mt-2 h-1.5 rounded-full bg-subtle">
            <div
              className="h-1.5 rounded-full bg-accent"
              style={{ width: `${meta.milestones.length ? (100 * checked.length) / meta.milestones.length : 0}%` }}
            />
          </div>
          <p className="mt-1 text-muted">
            {checked.length}/{meta.milestones.length} milestones
            {readHours > 0 && ` · core reading ≈ ${readHours} h`}
          </p>
        </section>
        {prereqStatus.length > 0 && (
          <section>
            <h2 className="font-medium">Needs</h2>
            <ul className="mt-1 space-y-1">
              {prereqStatus.map((p) => (
                <li key={p.id}>
                  <span className={p.done ? "text-accent" : "text-muted"}>{p.done ? "✓" : "○"}</span>{" "}
                  <Link href={`/modules/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="font-medium">Hands-on</h2>
          <ul className="mt-1 space-y-1 text-muted">
            {playgrounds.map((p) => (
              <li key={p.id}>
                <Link href={`/play/${p.id}`} className="text-fg hover:underline">
                  ▶ {p.title}
                </Link>
              </li>
            ))}
            {playgrounds.length === 0 && <li>Playground: not built yet</li>}
            <li>
              Notebook: <code>notebooks/{id}.ipynb</code>
            </li>
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-medium">Your notes</h2>
          <NotesPanel moduleId={id} questionCount={designQuestionCount(body)} notes={store.notes(id)} />
        </section>
      </aside>
    </div>
  );
}
