import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, storeFor, type Store } from "@/lib/db";

let file: string;
let store: Store;

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "course-db-")), "test.db");
  const conn = openDb(file);
  store = storeFor(() => conn);
});

describe("store", () => {
  it("toggles a milestone on and back off", () => {
    store.setMilestone("05-controls", "m05-pot-still", true);
    store.setMilestone("05-controls", "m05-pot-still", true); // idempotent
    expect(store.checkedMilestones("05-controls")).toEqual([{ module_id: "05-controls", milestone_id: "m05-pot-still" }]);
    store.setMilestone("05-controls", "m05-pot-still", false);
    expect(store.checkedMilestones()).toEqual([]);
  });

  it("upserts notes per slot", () => {
    store.saveNote("05-controls", "dq-1", "first");
    store.saveNote("05-controls", "dq-1", "second");
    store.saveNote("05-controls", "module", "general");
    expect(store.notes("05-controls")).toEqual({ "dq-1": "second", module: "general" });
  });

  it("saves, lists and deletes presets", () => {
    store.savePreset("web-sim", "b", '{"x":2}');
    store.savePreset("web-sim", "a", '{"x":1}');
    store.savePreset("web-sim", "a", '{"x":3}');
    expect(store.presets("web-sim")).toEqual([
      { name: "a", json: '{"x":3}' },
      { name: "b", json: '{"x":2}' },
    ]);
    store.deletePreset("web-sim", "a");
    expect(store.presets("web-sim").map((p) => p.name)).toEqual(["b"]);
  });

  it("round-trips everything through export/import", () => {
    store.setMilestone("00-toolchain-and-board", "m00-blink", true);
    store.saveNote("00-toolchain-and-board", "module", "hi");
    store.savePreset("web-sim", "p", "{}");
    store.setSetting("startDate", "2026-10-19");
    const dump = store.exportAll();

    const other = openDb(file.replace("test.db", "other.db"));
    const fresh = storeFor(() => other);
    fresh.importAll(dump);
    expect(fresh.exportAll()).toEqual(dump);
  });

  it("re-opening an existing database doesn't re-run migrations", () => {
    store.setSetting("k", "v");
    const again = storeFor(() => openDb(file));
    expect(again.setting("k")).toBe("v");
  });
});
