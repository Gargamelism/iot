// npm run import — replaces the database's contents with data/export.json.
import fs from "node:fs";
import path from "node:path";
import { store, type ExportData } from "../lib/db";

const file = path.resolve(process.cwd(), "data/export.json");
const data = JSON.parse(fs.readFileSync(file, "utf8")) as ExportData;
if (data.version !== 1) throw new Error(`unknown export version ${data.version}`);
store.importAll(data);
console.log(`imported ${data.milestone.length} milestones, ${data.note.length} notes, ${data.preset.length} presets from ${file}`);
