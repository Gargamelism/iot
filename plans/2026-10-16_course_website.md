# Plan 2 of 3: the course website (local Next.js + SQLite)

## Context

Plan 1 (`plans/2026-10-16_course_curriculum.md`) produced the course content:
- `synth_course/curriculum.md`
- `synth_course/modules/NN-*.mdx`: 17 modules, each with YAML front-matter (`id`, `title`, `weeks`,
  `prereqs`, `milestones: [{id, text}]`), a fixed set of `##` sections, and a `<Milestones />`
  tag where the checklist goes.

This plan builds the site that renders that content and saves the learner's work. Decided with
the user:
- It is **self-hosted and local**, inside this repo, built with **Next.js**.
- A **local SQLite** database stores changes, so ticked milestones, notes and playground
  settings persist.

Plan 3 builds the 16 playgrounds and the notebooks. This plan only provides the frame they
plug into, and proves it with **one** playground (a port of the existing `web_sim/`).

## Environment: Docker, no local Node

The host has the Docker CLI with Colima (QEMU VM, sshfs mounts; `/Volumes/data_2/dev` is
already mounted writable). It has no local Node and no `docker compose` plugin. So:

- **Everything Node-related runs in a container.** The image is built from
  `synth_course/site/Dockerfile`, based on `node:22-bookworm-slim` plus `python3 make g++` for
  `better-sqlite3`'s native build.
- **One site, one `synth_course/site/Makefile`.** It wraps plain `docker` commands, so no compose install
  is needed. Run it from `synth_course/site/` (or use `make -C synth_course/site <target>` from the repo root). You run
  `colima start` once per boot.

  | Command | Does |
  |---|---|
  | `make image` | build the Docker image |
  | `make dev` | run the site at http://localhost:3100 (3000 is taken on this machine by an ssh tunnel) |
  | `make test` | run the unit tests |
  | `make check` | validate the course content files |
  | `make build` | production build (to catch errors) |
  | `make export` / `make import` | back up / restore your saved progress as JSON |
  | `make sh` | open a shell inside the container |
  | `make npm ARGS="install foo"` | run npm (e.g. add a dependency) |

- **Mounts:**
  - `synth_course/site/` → `/app`, read-write, so edits hot-reload.
  - `synth_course/` → `/course`, read-only.
  - `node_modules` → a **named volume** (`synth-course-node-modules`), so Linux-built native
    modules never land on the macOS host.
  - `.next` → a named volume too.
- **File watching:** sshfs doesn't forward file events, so the dev container sets
  `NEXT_POLL_MS=1000`, which `next.config.ts` turns into `watchOptions.pollIntervalMs`
  (Turbopack ignores `WATCHPACK_POLLING`). Content edits under `/course` are read at request time, so a
  refresh picks them up.
- **The database lives in a named volume** (`synth-course-data`, mounted at `/data`), *not*
  on the sshfs bind mount, because SQLite locking over sshfs is unreliable.
  - `make export` writes `synth_course/site/data/export.json` onto the bind mount, so it is
    visible on the host, and `make import` reads it back. That JSON is what you'd commit or
    copy elsewhere if you want to.
  - The `.db` itself is never in git.
- **Inspecting the db:** `sqlite3` is on the host, but the db is inside a volume, so use
  `make sh` and then `sqlite3 /data/course.db` (`sqlite3` is installed in the image).
- **Ports:** the container's 3000 is published on the host's 3100. Change it with
  `make dev PORT=…`.

## Layout

```
synth_course/site/            Next.js app (App Router, TypeScript)
  package.json                scripts: dev, build, start, test, check:content
  next.config.ts
  app/
    layout.tsx                nav: Modules · Bibliography · Notes; light/dark
    page.tsx                  dashboard: module map, progress, "this week"
    modules/[id]/page.tsx     a rendered module
    curriculum/page.tsx       curriculum.md (overview, kit, bibliography)
    play/[id]/page.tsx        playground host page
    actions.ts                Server Actions: toggleMilestone, saveNote, savePreset, ...
  lib/
    content.ts                reads .., parses front-matter, validates the 11 headings
    db.ts                     better-sqlite3 connection + migrations + typed queries
  components/
    Milestones.tsx            checklist from front-matter, ticks persisted
    Spoiler.tsx               wraps "Compare (spoiler)": collapsed, and warns if milestones are unticked
    NotesPanel.tsx            per-module notes and per-design-question answers (markdown textarea, autosave)
    Playground.tsx            registry lookup + preset load/save
  playgrounds/
    registry.ts               id -> { title, module, component }
    web-sim/                  first playground: the web_sim port, as a client component
  public/worklets/            AudioWorklet processor files (served as real JS files, not blob: URLs)
  Dockerfile                  node:22-bookworm-slim + build tools + sqlite3
  data/export.json            JSON backup (the db itself is in a Docker volume at /data)
  test/                       vitest: content parser, db queries
```

Content stays in `synth_course/` (it is not copied into `synth_course/site/`). The container mounts it read-only at
`/course`, with the path taken from `COURSE_DIR` (default `..`, so it also works outside
Docker). It is read at request time in dev, so an edit to an `.mdx` file shows up on refresh.

## Rendering

- **Parsing:** everything stays local.
  - `gray-matter` splits the front-matter from the body.
  - `@mdx-js/mdx` (the official MDX compiler) `evaluate()`s the body with the components
    below. That happens on the server, at request time, in about ten lines of
    `lib/content.ts`.
  - The browser receives HTML. Only the interactive parts (checkboxes, notes, playgrounds)
    run as client JavaScript.
- **Components available to the MDX:** `Milestones` and `Spoiler`. The renderer wraps the
  `## Compare (spoiler)` section in `<Spoiler>` automatically (a small remark plugin keyed on
  the heading), so the content files stay plain.
- **Prose and code:** `@tailwindcss/typography` for prose, `rehype-pretty-code` (Shiki) for
  code blocks, and GFM tables via `remark-gfm`.
- **Module page layout:** the content on the left. On the right, a sticky panel with:
  - milestone progress
  - "Read" hours
  - prereq status (each one ticked or not)
  - links to the module's notebook and playground
  - the notes panel
- **Dashboard:** the module map as cards, showing weeks, prereqs and % of milestones ticked.
  A course start date (in settings) gives "you're in week N". Modules whose prereqs aren't
  done are dimmed, not locked.

## Database (better-sqlite3, synchronous, single file)

```sql
CREATE TABLE settings   (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE milestone  (module_id TEXT, milestone_id TEXT, checked_at TEXT,
                         PRIMARY KEY (module_id, milestone_id));
CREATE TABLE note       (module_id TEXT, slot TEXT, body TEXT NOT NULL, updated_at TEXT,
                         PRIMARY KEY (module_id, slot));        -- slot: 'module' | 'dq-1' | 'dq-2' …
CREATE TABLE preset     (playground_id TEXT, name TEXT, json TEXT NOT NULL, updated_at TEXT,
                         PRIMARY KEY (playground_id, name));
CREATE TABLE schema_version (version INTEGER NOT NULL);
```

- **Keys** are the content's stable ids, never its text. Editing the curriculum doesn't lose
  saved state. A milestone id that disappears from the content is shown on the dashboard as
  "orphaned" rather than silently deleted.
- **Writes** go through Server Actions in `app/actions.ts`, and `revalidatePath` refreshes
  the page.
- **Migrations:** numbered SQL strings in `lib/db.ts`, applied at startup.
- **Location:** the db is at `DB_PATH` (default `/data/course.db`, a named Docker volume).
- **Backup:** `make export` (`npm run export` in the container) dumps every table to
  `synth_course/site/data/export.json` on the host, and `make import` restores it. That is the
  escape hatch for moving machines, and it is the only form of the data that ever reaches the
  host filesystem.

## First playground: the web_sim port

- `web_sim/app.js` builds its AudioWorklet from a `blob:` URL string. In the site, the
  processor becomes `public/worklets/synth-processor.js`, loaded with
  `audioWorklet.addModule('/worklets/synth-processor.js')`.
- The control/UI code becomes a client component.
- The `pins.h` mirror moves to `playgrounds/shared/constants.ts` so plan 3's playgrounds
  share one copy.
- `web_sim/` itself is left untouched.
- **Presets:** a playground exposes `getState()`/`setState()`. `Playground.tsx` saves and
  loads named presets through the `preset` table.
- **Audio start:** browsers require a user gesture to start audio, so every playground shows
  a "Start audio" button (the same as `web_sim` today).

## Steps

1. Run `colima start`. Write `synth_course/site/Dockerfile` and `synth_course/site/Makefile`, then scaffold
   `synth_course/site/` *inside the container* with `create-next-app` (TypeScript, App Router, Tailwind,
   ESLint, no `src/`). Add `better-sqlite3`, `gray-matter`, `@mdx-js/mdx`, `remark-gfm`,
   `rehype-pretty-code`, `@tailwindcss/typography` and `vitest`.
2. Build `lib/content.ts`: list the modules, parse front-matter, validate the headings
   (the same checks plan 1 ran in Python), and expose `getModule(id)` and `getAllModules()`.
   `COURSE_DIR` sets the content path.
3. Add `npm run check:content`, which runs those validations from the command line.
4. Build `lib/db.ts` (with `DB_PATH`) and the migrations, then the Server Actions.
5. Build the pages and components: dashboard, module page, curriculum page, Milestones,
   Spoiler, NotesPanel.
6. Build the playground framework and the web_sim port.
7. Write the export/import scripts.
8. Add `synth_course/site/README.md` (colima → `make image` → `make dev`) plus `.gitignore`
   entries for `synth_course/site/node_modules`, `synth_course/site/.next` and `synth_course/site/data/export.json` (commit that one
   only if you choose to). Add a short "Course site" section to the root `README.md`.

## Verification

- `make check` passes on all 17 modules. Then break a heading in a scratch copy and
  check that it fails.
- `make test` (vitest) runs:
  - content parser tests: front-matter, headings, the milestone ids are unique
  - db tests against a temp file: toggling a milestone twice leaves it unticked, notes upsert,
    presets round-trip, and the migration is idempotent.
- `make build` succeeds.
- In the browser:
  - `make dev` serves the dashboard with 17 cards.
  - Ticking a milestone on module 05 survives stopping and restarting the container, and the dashboard % updates.
  - A design-question answer survives a restart.
  - Editing a `.mdx` file shows the change on refresh.
  - The Compare section starts collapsed.
  - The web_sim playground plays sound, and a saved preset reloads.
- `make export`, then `docker volume rm synth-course-data`, then `make import`:
  everything is back.
- Nothing Linux-built (no `node_modules`, no `.next`) appears in `synth_course/site/` on the host.

## Not in this plan

- The other 15 playgrounds and all notebooks (plan 3).
- Auth, multi-user, deployment: it's localhost only.
- Editing course content in the browser: content is edited as files in the repo.
