#!/usr/bin/env node
/**
 * FA-19080's end-to-end proof, through the cockpit front (default
 * http://127.0.0.1:5207, loopback) with Playwright (system Chrome):
 *
 *   --phase apply  types the request into the region's Ask box with the image attached, sends it, sees it take the
 *                  change path, follows the applied job through its gates until the region reloads on the new build,
 *                  then screenshots the region at 1280 and 390 and a side-by-side with the mockup;
 *   --phase undo   presses Undo on the applied-change banner, follows the undo until the region reloads, and proves the
 *                  region is back as it was (the fork's templates/cockpit tree equals the pre-apply commit's).
 *
 * Every phase fails on a console error or sideways scroll. Screenshots go to --out.
 *
 *   node e2e/verify-ask-apply.mjs --phase apply --image <mockup.png> --text "<request>" --out <dir>
 *   node e2e/verify-ask-apply.mjs --phase undo --out <dir>
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const phase = arg("--phase", "apply");
const base = arg("--base", "http://127.0.0.1:5207").replace(/\/$/, "");
const out = path.resolve(arg("--out", "shots"));
const image = arg("--image", "");
const text = arg("--text", "make the office card look like what's attached");
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(out, "apply-state.json");
mkdirSync(out, { recursive: true });
const git = (...a) => execFileSync("git", a, { cwd: APP, encoding: "utf8" }).trim();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
// while a job restarts the region its polls meet the restart gap (502 from the front, refused connections): counted apart
const transient = [];
let following = false;
const noteError = (e) => (following ? transient : errors).push(e);
async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") noteError(`${w}: ${m.text().slice(0, 160)} @ ${(m.location()?.url || "").replace(base, "")}`);
  });
  page.on("pageerror", (e) => noteError(`${w}: ${String(e).slice(0, 160)}`));
  await page.goto(base + "/cards/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="cockpit-region"]');
  await page.waitForFunction(() => [...document.querySelectorAll(".cp-card .cp-hl")].some((e) => e.textContent && e.textContent !== "Loading…"), null, { timeout: 45_000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const noSideways = async (page, w) => {
  const a = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(`no sideways scroll at ${w}`, a.sw <= a.cw + 1, `${a.sw} <= ${a.cw}`);
};
const shape = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-testid="cockpit-region"]');
    return {
      children: [...r.children].map((c) => c.tagName + "." + [...c.classList].sort().join(".")).filter((x) => !/cp-applied|cp-ask/.test(x)),
      cards: [...document.querySelectorAll(".cp-card")].map((c) => c.getAttribute("data-card")),
    };
  });
/** Waits for the job the region is following to end, through the reload that a live change triggers. */
async function follow(page, label, maxMin) {
  following = true;
  try {
    return await followInner(page, label, maxMin);
  } finally {
    following = false;
  }
}
async function followInner(page, label, maxMin) {
  const end = Date.now() + maxMin * 60_000;
  let last = "";
  while (Date.now() < end) {
    const s = await page
      .evaluate(() => {
        const p = document.querySelector('[data-testid="apply-progress"]');
        const b = document.querySelector('[data-testid="applied-banner"]');
        return { status: p?.getAttribute("data-status") || "", phases: p ? [...p.querySelectorAll("li")].map((li) => li.className.replace("s-", "") + ":" + li.textContent.trim().split(" ")[0]).join(" ") : "", banner: b ? b.getAttribute("data-kind") + ":" + b.getAttribute("data-job") : "", text: p ? p.innerText.slice(0, 600) : "" };
      })
      .catch(() => ({ status: "reloading", phases: "", banner: "", text: "" }));
    const line = `${s.status} ${s.phases} ${s.banner}`;
    if (line !== last) {
      console.log(`[${label} ${new Date().toISOString().slice(11, 19)}] ${line}`);
      last = line;
    }
    if (s.banner && !s.status) return { ...s, reloaded: true };
    if (["failed", "no-change", "needs-system", "undone"].includes(s.status)) return s;
    await page.waitForTimeout(3000);
  }
  return { status: "timeout" };
}


async function afterShots(base0, shapeBefore) {
  const a = await open(1280, 900);
  const banner = await a.page.locator('[data-testid="applied-banner"]').getAttribute("data-job").catch(() => null);
  check("the region shows the applied change with its Undo", !!banner, String(banner));
  writeFileSync(state, JSON.stringify({ base0, job: banner, commit: git("log", "-1", "--format=%H", "--grep", "Ask agent applied:"), shapeBefore: shapeBefore ?? (await shape(a.page)) }, null, 1));
  await a.page.screenshot({ path: path.join(out, "after-1280.png"), fullPage: true });
  await noSideways(a.page, 1280);
  await a.ctx.close();
  const phone = await open(390, 844);
  await phone.page.screenshot({ path: path.join(out, "after-390.png"), fullPage: true });
  await noSideways(phone.page, 390);
  await phone.ctx.close();
  // the whole cockpit (FA-19087) and, when it has one, its office card on its own
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on("console", (m) => {
      if (m.type() === "error") noteError(`cockpit ${w}: ${m.text().slice(0, 160)} @ ${(m.location()?.url || "").replace(base, "")}`);
    });
    await p.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" });
    await p.waitForSelector('[data-testid="cockpit-full"]', { timeout: 30_000 });
    await p.waitForTimeout(4000);
    await p.screenshot({ path: path.join(out, `after-cockpit-${w}.png`), fullPage: true });
    const office = p.locator('[data-testid="cf-office"]');
    if (await office.count()) await office.first().screenshot({ path: path.join(out, `after-office-${w}.png`) });
    await noSideways(p, "cockpit " + w);
    await ctx.close();
  }
  if (base0) check("the fork moved by the applied commit", git("rev-parse", "HEAD") !== base0, git("log", "--oneline", "-1"));
  // side by side with the mockup
  if (image) {
    const ctx = await browser.newContext({ viewport: { width: 2480, height: 1000 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const b64 = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
    const live = existsSync(path.join(out, "after-office-1280.png")) ? path.join(out, "after-office-1280.png") : path.join(out, "after-1280.png");
    await p.setContent(`<body style="margin:0;background:#03070f;display:flex;gap:24px;padding:24px;align-items:flex-start;font:14px sans-serif;color:#8fdcff">
      <figure style="margin:0;width:1168px"><figcaption>Mockup (console's attachment)</figcaption><img style="width:100%" src="${b64(image)}"></figure>
      <figure style="margin:0;width:1240px"><figcaption>Live after the Ask agent applied it (1280)</figcaption><img style="width:100%" src="${b64(live)}"></figure></body>`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(out, "side-by-side.png"), fullPage: true });
    await ctx.close();
  }
}

try {
  if (phase === "apply") {
    const before = await open(1280, 900);
    const shapeBefore = await shape(before.page);
    await before.page.screenshot({ path: path.join(out, "before-1280.png"), fullPage: true });
    const base0 = git("rev-parse", "HEAD");
    // the Ask round trip, as the console did it
    await before.page.getByRole("button", { name: /Ask agent/ }).click();
    await before.page.locator("#cp-ask-q").fill(text);
    if (image) await before.page.locator('[data-testid="ask-file"]').setInputFiles(image);
    await before.page.waitForTimeout(500);
    await before.page.screenshot({ path: path.join(out, "ask-typed-1280.png") });
    await before.page.getByRole("button", { name: "Send" }).click();
    await before.page.waitForSelector('[data-testid="ask-answer"]', { timeout: 120_000 });
    const kind = await before.page.locator('[data-testid="ask-answer"]').getAttribute("data-kind");
    const answer = await before.page.locator('[data-testid="ask-answer"]').innerText();
    check("the request takes the change (apply) path", kind === "change", `${kind}: ${answer}`);
    await before.page.waitForSelector('[data-testid="apply-progress"]', { timeout: 30_000 });
    await before.page.screenshot({ path: path.join(out, "ask-applying-1280.png") });
    const end = await follow(before.page, "apply", 35);
    check("the change went live and the region reloaded on it", !!end.reloaded, JSON.stringify(end).slice(0, 800));
    await before.ctx.close();
    await afterShots(base0, shapeBefore);
  } else if (phase === "after") {
    // the shots alone, for a change that went live while no proof was watching (--base0: the commit before it)
    await afterShots(arg("--base0", ""), null);
  } else {
    const st = JSON.parse(readFileSync(state, "utf8"));
    const page = (await open(1280, 900)).page;
    await page.waitForSelector('[data-testid="applied-banner"][data-kind="apply"]', { timeout: 30_000 });
    await page.screenshot({ path: path.join(out, "undo-before-1280.png") });
    await page.getByRole("button", { name: /^Undo:/ }).click();
    await page.waitForSelector('[data-testid="apply-progress"]', { timeout: 30_000 });
    const end = await follow(page, "undo", 10);
    check("the undo went live and the region reloaded", !!end.reloaded && /^undo:/.test(end.banner), JSON.stringify(end).slice(0, 400));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(out, "undone-1280.png"), fullPage: true });
    // the office card as it was before the restyle, on the cockpit page
    const c = await page.context().newPage();
    await c.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" });
    await c.waitForSelector('[data-testid="cockpit-full"]', { timeout: 30_000 });
    await c.waitForTimeout(4000);
    await c.screenshot({ path: path.join(out, "undone-cockpit-1280.png"), fullPage: true });
    if (await c.locator('[data-testid="cf-office"]').count()) await c.locator('[data-testid="cf-office"]').first().screenshot({ path: path.join(out, "undone-office-1280.png") });
    await c.close();
    const now = await shape(page);
    check("the region is back to its pre-apply shape", JSON.stringify(now) === JSON.stringify(st.shapeBefore), JSON.stringify(now).slice(0, 300));
    // the files the applied commit changed are back to what they were before it (other commits may have landed since)
    const applied = st.commit || git("log", "-1", "--format=%H", "--grep", "Ask agent applied:");
    const files = git("show", "--name-only", "--format=", applied).split("\n").filter(Boolean);
    const same = (() => {
      try {
        execFileSync("git", ["diff", "--quiet", applied + "^", "HEAD", "--", ...files.map((f) => path.relative(APP, path.join(APP, "..", "..", f)))], { cwd: APP });
        return true;
      } catch {
        return false;
      }
    })();
    check("every file the applied commit changed is back to its pre-apply content", same && files.length > 0, `${applied.slice(0, 10)}: ${files.join(", ")}`);
    await noSideways(page, 1280);
  }
} finally {
  await browser.close();
}
check("no console errors (outside the restart gap)", errors.length === 0, errors.slice(0, 5).join(" | "));
if (transient.length) console.log(`INFO ${transient.length} console line(s) while the job ran and the region restarted: ${[...new Set(transient)].slice(0, 4).join(" | ")}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
