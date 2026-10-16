import { describe, expect, it } from "vitest";
import { designQuestionCount, getAllModules, parseModule, SECTION_HEADINGS, validateModule } from "@/lib/content";
import { wrapSpoiler } from "@/lib/mdx";

const body = (headings: readonly string[]) =>
  headings.map((h) => `\n## ${h}\n\ntext\n`).join("") + "\n<Milestones />\n";

const sample = (extraFm = "", headings: readonly string[] = SECTION_HEADINGS) =>
  `---\nid: 99-x\ntitle: X\nweeks: 1\nprereqs: []\nmilestones:\n  - id: a\n    text: A\n${extraFm}---\n${body(headings)}`;

describe("validateModule", () => {
  it("accepts a well-formed module", () => {
    expect(validateModule(parseModule(sample()), "99-x.mdx", new Set(["99-x"]))).toEqual([]);
  });

  it("flags a missing or reordered section", () => {
    const errs = validateModule(parseModule(sample("", SECTION_HEADINGS.slice(1))), "99-x.mdx", new Set());
    expect(errs.some((e) => e.startsWith("sections are"))).toBe(true);
  });

  it("flags duplicate milestone ids, unknown prereqs and a mismatched file name", () => {
    const mod = parseModule(sample("  - id: a\n    text: again\n").replace("prereqs: []", "prereqs: [nope]"));
    const errs = validateModule(mod, "other.mdx", new Set(["99-x"]));
    expect(errs).toEqual(
      expect.arrayContaining([
        'duplicate milestone id "a"',
        'unknown prereq "nope"',
        'id "99-x" doesn\'t match file name',
      ]),
    );
  });
});

describe("the real course", () => {
  it("has 17 valid modules with globally unique milestone ids", async () => {
    const mods = await getAllModules();
    expect(mods).toHaveLength(17);
    const ids = new Set(mods.map((m) => m.meta.id));
    for (const m of mods) expect(validateModule(m, `${m.meta.id}.mdx`, ids)).toEqual([]);
    const all = mods.flatMap((m) => m.meta.milestones.map((x) => x.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("counts design questions per module", async () => {
    const m05 = (await getAllModules()).find((m) => m.meta.id === "05-controls")!;
    expect(designQuestionCount(m05.body)).toBe(6);
  });
});

it("wraps exactly the Compare section in <Spoiler>", () => {
  const out = wrapSpoiler(body(SECTION_HEADINGS));
  expect(out).toMatch(/<Spoiler>\n\n## Compare \(spoiler\)\n[\s\S]*<\/Spoiler>\n\n## Stretch/);
});
