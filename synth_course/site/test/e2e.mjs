// make e2e — headless smoke test of the running dev container (make dev).
// Runs in the Playwright image on the dev container's network, so the site is
// localhost:3000 and JupyterLab localhost:8888. Leaves no data behind.
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const playgrounds = [...fs.readFileSync("/site/playgrounds/meta.ts", "utf8").matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]);
const modulesWithNotebooks = fs
  .readdirSync("/notebooks")
  .filter((f) => f.endsWith(".ipynb"))
  .map((f) => f.replace(/\.ipynb$/, ""));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let failures = 0;
const ok = (name) => console.log(`ok   ${name}`);
const fail = (name, why) => {
  failures++;
  console.log(`FAIL ${name}\n     ${why}`);
};

async function withPage(name, fn) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push(m.text()));
  try {
    await fn(page);
    if (errors.length) fail(name, errors.join(" | "));
    else ok(name);
  } catch (e) {
    fail(name, String(e).split("\n")[0]);
  } finally {
    await page.close();
  }
}

for (const id of playgrounds) {
  await withPage(`playground ${id}: loads, starts audio, saves and reloads a preset`, async (page) => {
    await page.goto(`${BASE}/play/${id}`);
    const start = page.getByRole("button", { name: "Start audio" });
    if (await start.count()) {
      await start.click();
      await page.getByRole("button", { name: "Mute" }).waitFor({ timeout: 5000 });
    }
    const slider = page.locator('input[type=range]:not([disabled])').first();
    if (await slider.count()) {
      const [min, max, step] = await Promise.all(["min", "max", "step"].map((a) => slider.getAttribute(a)));
      const s = Number(step ?? 1);
      await slider.fill(String(Math.round((Number(min ?? 0) + Number(max ?? 1)) / 2 / s) * s));
    }
    await page.getByPlaceholder("preset name").fill("e2e-check");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.locator("select option", { hasText: "e2e-check" }).waitFor({ state: "attached", timeout: 5000 });
    await page.getByPlaceholder("preset name").fill("e2e-check");
    await page.getByRole("button", { name: "Delete" }).click();
    await page.waitForTimeout(500);
  });
}

await withPage("harmonic-lab: no band-limit at a high pitch reports aliasing", async (page) => {
  await page.goto(`${BASE}/play/harmonic-lab`);
  await page.getByRole("button", { name: "No band-limit" }).click();
  await page.locator('input[type=range]').first().fill("1");
  await page.getByText("above Nyquist, aliasing").waitFor({ timeout: 3000 });
  await page.getByRole("button", { name: "Per octave" }).click();
  if (await page.getByText("above Nyquist, aliasing").count()) throw new Error("still aliasing with mip-maps");
});

for (const id of modulesWithNotebooks) {
  await withPage(`module ${id}: notebook panel embeds JupyterLab`, async (page) => {
    await page.goto(`${BASE}/modules/${id}`);
    await page.getByRole("button", { name: "Open notebook" }).click();
    const frame = page.frameLocator('iframe[title="Notebook"]');
    await frame.locator(".jp-Notebook").first().waitFor({ timeout: 30000 });
  });
}

await browser.close();
console.log(failures ? `\n${failures} failure(s)` : "\nall e2e checks passed");
process.exit(failures ? 1 : 0);
