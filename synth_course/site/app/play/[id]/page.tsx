import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { io } from "next/cache";
import { store } from "@/lib/db";
import { PLAYGROUNDS } from "@/playgrounds/meta";
import { PlaygroundHost } from "@/components/PlaygroundHost";

export default function PlayPage({ params }: PageProps<"/play/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <PlayPageContent params={params} />
    </Suspense>
  );
}

async function PlayPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = PLAYGROUNDS.find((p) => p.id === id);
  if (!meta) notFound();
  await io();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{meta.title}</h1>
        <p className="mt-1 text-muted">{meta.description}</p>
        {meta.module && (
          <Link href={`/modules/${meta.module}`} className="text-sm text-accent hover:underline">
            ← back to the module
          </Link>
        )}
      </header>
      <PlaygroundHost id={id} initialPresets={store.presets(id)} />
    </div>
  );
}
