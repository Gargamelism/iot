import { Suspense } from "react";
import Link from "next/link";
import { io } from "next/cache";
import { getCurriculum } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";

export default function CurriculumPage() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <CurriculumPageContent />
    </Suspense>
  );
}

async function CurriculumPageContent() {
  await io();
  const content = await renderMdx(
    await getCurriculum(),
    {
      // curriculum.md links to modules/NN-x.mdx (relative, for reading on disk)
      a: ({ href = "", children }) => {
        const m = href.match(/^modules\/([\w-]+)\.mdx$/);
        return m ? <Link href={`/modules/${m[1]}`}>{children}</Link> : <a href={href}>{children}</a>;
      },
    },
    "md",
  );
  return <article className="prose prose-neutral max-w-none dark:prose-invert">{content}</article>;
}
