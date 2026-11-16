// npm run check:content — validates every module in synth_course/ (or COURSE_DIR):
// front-matter, the 11 sections in order, unique milestone ids, prereqs, and
// that each file actually compiles as MDX.
import fs from "node:fs/promises";
import path from "node:path";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { COURSE_DIR, getAllModules, validateModule } from "../lib/content";

async function main() {
  const files = (await fs.readdir(path.join(COURSE_DIR, "modules"))).filter((f) => f.endsWith(".mdx")).sort();
  const modules = await getAllModules();
  const ids = new Set(modules.map((m) => m.meta.id));
  const milestoneIds = new Map<string, string>();
  let failures = 0;

  for (const [i, mod] of modules.entries()) {
    const errors = validateModule(mod, files[i], ids);
    for (const m of mod.meta.milestones) {
      const other = milestoneIds.get(m.id);
      if (other && other !== mod.meta.id) errors.push(`milestone id "${m.id}" also used in ${other}`);
      milestoneIds.set(m.id, mod.meta.id);
    }
    try {
      await compile(mod.body, { remarkPlugins: [remarkGfm] });
    } catch (e) {
      errors.push(`MDX compile error: ${e instanceof Error ? e.message : e}`);
    }
    failures += errors.length;
    console.log(`${errors.length ? "FAIL" : "ok  "} ${files[i]}`);
    for (const e of errors) console.log(`     - ${e}`);
  }
  try {
    await compile(await fs.readFile(path.join(COURSE_DIR, "curriculum.md"), "utf8"), { format: "md", remarkPlugins: [remarkGfm] });
    console.log("ok   curriculum.md");
  } catch (e) {
    failures++;
    console.log(`FAIL curriculum.md\n     - ${e}`);
  }
  console.log(failures ? `\n${failures} problem(s)` : `\nall ${files.length} modules valid`);
  process.exit(failures ? 1 : 0);
}

main();
