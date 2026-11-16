// SQLite store for everything the learner changes: ticked milestones, notes,
// playground presets, settings. Keyed by the content's stable ids, never its
// text, so editing the course doesn't lose state. In Docker the file lives in
// the synth-course-data volume (not the sshfs bind mount — SQLite locking
// over sshfs is unreliable).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), "data/course.db");

// Append-only: each entry runs once, in order, tracked by schema_version.
const MIGRATIONS = [
  `CREATE TABLE settings  (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE milestone (module_id TEXT NOT NULL, milestone_id TEXT NOT NULL, checked_at TEXT NOT NULL,
                           PRIMARY KEY (module_id, milestone_id));
   CREATE TABLE note      (module_id TEXT NOT NULL, slot TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL,
                           PRIMARY KEY (module_id, slot));
   CREATE TABLE preset    (playground_id TEXT NOT NULL, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL,
                           PRIMARY KEY (playground_id, name));`,
];

export function openDb(file: string = DB_PATH): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  const current = row?.version ?? 0;
  db.transaction(() => {
    for (let v = current; v < MIGRATIONS.length; v++) db.exec(MIGRATIONS[v]);
    if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(MIGRATIONS.length);
    else db.prepare("UPDATE schema_version SET version = ?").run(MIGRATIONS.length);
  })();
  return db;
}

let shared: Database.Database | null = null;
const db = () => (shared ??= openDb());

const now = () => new Date().toISOString();

export interface Store {
  checkedMilestones(moduleId?: string): { module_id: string; milestone_id: string }[];
  setMilestone(moduleId: string, milestoneId: string, checked: boolean): void;
  notes(moduleId: string): Record<string, string>;
  saveNote(moduleId: string, slot: string, body: string): void;
  presets(playgroundId: string): { name: string; json: string }[];
  savePreset(playgroundId: string, name: string, json: string): void;
  deletePreset(playgroundId: string, name: string): void;
  setting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
  exportAll(): ExportData;
  importAll(data: ExportData): void;
}

export interface ExportData {
  version: 1;
  settings: { key: string; value: string }[];
  milestone: { module_id: string; milestone_id: string; checked_at: string }[];
  note: { module_id: string; slot: string; body: string; updated_at: string }[];
  preset: { playground_id: string; name: string; json: string; updated_at: string }[];
}

export function storeFor(d: () => Database.Database): Store {
  return {
    checkedMilestones(moduleId) {
      return moduleId
        ? (d().prepare("SELECT module_id, milestone_id FROM milestone WHERE module_id = ?").all(moduleId) as never)
        : (d().prepare("SELECT module_id, milestone_id FROM milestone").all() as never);
    },
    setMilestone(moduleId, milestoneId, checked) {
      if (checked) {
        d().prepare("INSERT OR IGNORE INTO milestone VALUES (?, ?, ?)").run(moduleId, milestoneId, now());
      } else {
        d().prepare("DELETE FROM milestone WHERE module_id = ? AND milestone_id = ?").run(moduleId, milestoneId);
      }
    },
    notes(moduleId) {
      const rows = d().prepare("SELECT slot, body FROM note WHERE module_id = ?").all(moduleId) as {
        slot: string;
        body: string;
      }[];
      return Object.fromEntries(rows.map((r) => [r.slot, r.body]));
    },
    saveNote(moduleId, slot, body) {
      d()
        .prepare(
          `INSERT INTO note VALUES (?, ?, ?, ?)
           ON CONFLICT (module_id, slot) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
        )
        .run(moduleId, slot, body, now());
    },
    presets(playgroundId) {
      return d()
        .prepare("SELECT name, json FROM preset WHERE playground_id = ? ORDER BY name")
        .all(playgroundId) as never;
    },
    savePreset(playgroundId, name, json) {
      d()
        .prepare(
          `INSERT INTO preset VALUES (?, ?, ?, ?)
           ON CONFLICT (playground_id, name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        )
        .run(playgroundId, name, json, now());
    },
    deletePreset(playgroundId, name) {
      d().prepare("DELETE FROM preset WHERE playground_id = ? AND name = ?").run(playgroundId, name);
    },
    setting(key) {
      return (d().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)
        ?.value;
    },
    setSetting(key, value) {
      d()
        .prepare("INSERT INTO settings VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .run(key, value);
    },
    exportAll() {
      const all = (table: string) => d().prepare(`SELECT * FROM ${table}`).all() as never;
      return { version: 1, settings: all("settings"), milestone: all("milestone"), note: all("note"), preset: all("preset") };
    },
    importAll(data) {
      const conn = d();
      conn.transaction(() => {
        for (const t of ["settings", "milestone", "note", "preset"] as const) {
          conn.prepare(`DELETE FROM ${t}`).run();
          for (const row of data[t]) {
            const cols = Object.keys(row);
            conn
              .prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
              .run(...Object.values(row));
          }
        }
      })();
    },
  };
}

export const store = storeFor(db);
