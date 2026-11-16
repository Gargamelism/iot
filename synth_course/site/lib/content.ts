// Reads the course content from the parent synth_course/ folder (COURSE_DIR in Docker). Nothing is
// copied into the site: the .mdx files are read and validated on each call,
// so edits show up on refresh.
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export const COURSE_DIR = process.env.COURSE_DIR ?? path.resolve(process.cwd(), "..");

// Every module has exactly these "##" sections, in this order.
export const SECTION_HEADINGS = [
  "Goal",
  "You'll be able to",
  "Concepts",
  "Read",
  "Explore (notebook)",
  "Play (playground)",
  "Build",
  "Hardware milestone",
  "Design questions",
  "Compare (spoiler)",
  "Stretch",
] as const;

export interface Milestone {
  id: string;
  text: string;
}

export interface ModuleMeta {
  id: string;
  title: string;
  weeks: number | string;
  prereqs: string[];
  milestones: Milestone[];
}

export interface CourseModule {
  meta: ModuleMeta;
  body: string;
}

const modulesDir = () => path.join(COURSE_DIR, "modules");

export function parseModule(source: string): CourseModule {
  const { data, content } = matter(source);
  return {
    meta: {
      id: String(data.id),
      title: String(data.title),
      weeks: data.weeks,
      prereqs: data.prereqs ?? [],
      milestones: data.milestones ?? [],
    },
    body: content,
  };
}

export async function getAllModules(): Promise<CourseModule[]> {
  const files = (await fs.readdir(modulesDir())).filter((f) => f.endsWith(".mdx")).sort();
  return Promise.all(
    files.map(async (f) => parseModule(await fs.readFile(path.join(modulesDir(), f), "utf8"))),
  );
}

export async function getModule(id: string): Promise<CourseModule | null> {
  // ids are file names; refuse anything that could escape the modules dir
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return parseModule(await fs.readFile(path.join(modulesDir(), `${id}.mdx`), "utf8"));
  } catch {
    return null;
  }
}

export async function getCurriculum(): Promise<string> {
  return matter(await fs.readFile(path.join(COURSE_DIR, "curriculum.md"), "utf8")).content;
}

// The body of one "## heading" section (up to the next "## ").
export function sectionBody(body: string, heading: string): string {
  const start = body.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const from = start + heading.length + 5;
  const end = body.indexOf("\n## ", from);
  return body.slice(from, end < 0 ? undefined : end);
}

// Top-level numbered items under "Design questions" — one notes slot each.
export function designQuestionCount(body: string): number {
  return (sectionBody(body, "Design questions").match(/^\d+\. /gm) ?? []).length;
}

// Problems with one module, as human-readable strings (empty = valid).
export function validateModule(mod: CourseModule, fileName: string, allIds: Set<string>): string[] {
  const errors: string[] = [];
  const { meta, body } = mod;
  if (`${meta.id}.mdx` !== fileName) errors.push(`id "${meta.id}" doesn't match file name`);
  if (!meta.title || meta.title === "undefined") errors.push("missing title");
  if (meta.weeks === undefined) errors.push("missing weeks");
  for (const p of meta.prereqs) {
    if (!allIds.has(p)) errors.push(`unknown prereq "${p}"`);
  }
  const seen = new Set<string>();
  for (const m of meta.milestones) {
    if (!m.id || !m.text) errors.push(`milestone without id or text: ${JSON.stringify(m)}`);
    if (seen.has(m.id)) errors.push(`duplicate milestone id "${m.id}"`);
    seen.add(m.id);
  }
  const headings = [...body.matchAll(/^## (.+)$/gm)].map((h) => h[1]);
  if (headings.join("|") !== SECTION_HEADINGS.join("|")) {
    errors.push(`sections are [${headings.join(", ")}], expected [${SECTION_HEADINGS.join(", ")}]`);
  }
  if (!body.includes("<Milestones />")) errors.push("missing <Milestones /> tag");
  return errors;
}

// Which notebooks exist for a module: notebooks/<id>.ipynb (the exercise) and
// notebooks/solutions/<id>.ipynb (behind the spoiler).
export async function notebooksFor(id: string): Promise<{ exercise: boolean; solution: boolean }> {
  const exists = (p: string) =>
    fs.access(path.join(COURSE_DIR, "notebooks", p)).then(
      () => true,
      () => false,
    );
  const [exercise, solution] = await Promise.all([exists(`${id}.ipynb`), exists(`solutions/${id}.ipynb`)]);
  return { exercise, solution };
}

// Where JupyterLab is reachable from the browser (the Makefile publishes it).
export const JUPYTER_URL = process.env.NEXT_PUBLIC_JUPYTER_URL ?? "http://localhost:8888";
