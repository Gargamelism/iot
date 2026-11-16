// npm run export — writes every table to data/export.json (bind-mounted, so it
// lands in synth_course/site/data/ on the host).
import fs from "node:fs";
import path from "node:path";
import { store } from "../lib/db";

const out = path.resolve(process.cwd(), "data/export.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
const data = store.exportAll();
fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
console.log(
  `exported ${data.milestone.length} milestones, ${data.note.length} notes, ${data.preset.length} presets, ${data.settings.length} settings -> ${out}`,
);
