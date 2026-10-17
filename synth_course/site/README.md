# Course site

Local website for the synth course: it renders the course content in its parent folder, `synth_course/`
(`curriculum.md` and `modules/*.mdx`),
and saves your progress (ticked milestones, notes, design-question answers, playground
presets) in SQLite. Everything runs in Docker; no local Node needed.

## Run

```sh
colima start          # once per boot
cd synth_course/site
make dev              # site: http://localhost:3100   JupyterLab: http://localhost:8888
```

The first `make dev` builds the image and installs dependencies into a Docker volume.
`PORT=…` / `JUPYTER_PORT=…` change the ports (3000 is taken on this machine).

## Commands

| Command | Does |
|---|---|
| `make dev` | run the site |
| `make test` | unit tests (content parser, database) |
| `make check` | validate every course file: sections, front-matter, unique milestone ids, MDX compiles |
| `make build` | production build (catches type and render errors) |
| `make nb-check` | run every solution notebook headless; fails on any error or failed check |
| `make e2e` | headless-browser smoke test against a running `make dev` (playgrounds, presets, notebook embeds) |
| `make export` / `make import` | back up / restore your progress as `synth_course/site/data/export.json` |
| `make sh` | shell in the container (`sqlite3 /data/course.db` to inspect the db) |
| `make npm ARGS="install foo"` | run npm inside the container |

## Where things live

- **Content**: `synth_course/` (this folder's parent), mounted read-only at `/course` and read on every request, so editing
  a module shows up on refresh.
- **Your data**: the `synth-course-data` Docker volume (`/data/course.db`). It is not on the
  host filesystem (SQLite locking over Colima's sshfs mount is unreliable), so `make export`
  is how you back it up or move it. `docker volume rm synth-course-data` erases it.
- **Dependencies / build output**: the `synth-course-node-modules` and `synth-course-next`
  volumes, so nothing Linux-built lands in `synth_course/site/`.
- **Notebooks**: `synth_course/notebooks/`, mounted read-write at `/notebooks`, so saving in
  JupyterLab writes straight into the repo (files stay owned by you). `<module>.ipynb` is the
  exercise, `solutions/<module>.ipynb` the worked answer, `synthlib.py` the shared helpers,
  `recordings/` your hardware captures. Python packages are pinned in
  `notebooks/requirements.txt` and baked into the image (`make image` after changing it).
- **Playgrounds**: `playgrounds/` (`meta.ts` lists them, `components.ts` maps ids to
  components); audio worklets are plain files in `public/worklets/` (`engine.js` is the shared
integer wavetable engine), shared UI and DSP helpers in `playgrounds/shared/`.

## Notes

- File changes reach the container through Colima's sshfs mount, which doesn't forward file
  events, so the dev server polls (`NEXT_POLL_MS`, set in the Dockerfile). Expect a second or
  so before an edit to the site's code is picked up.
- This is Next.js 16 with Cache Components: pages read the database and files at request time
  inside `<Suspense>` after `await io()`. See `AGENTS.md` and the docs bundled in
  `node_modules/next/dist/docs/` (inside the container) before changing framework code.
