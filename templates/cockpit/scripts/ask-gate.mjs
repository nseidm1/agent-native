#!/usr/bin/env node
/**
 * The Playwright gate an Ask agent change must pass before it goes live
 * (FA-19080; server/cockpit/apply/job.ts runs it against the change's BUILT
 * worktree on a spare port). It runs from the live checkout, never from the
 * change: scripts/ is outside the agent's write scope.
 *
 * At 1280x900 and 390x844, on both pages the app serves - the card region
 * (/cards/) and the whole front-facing cockpit (/cards/cockpit, FA-19087) -:
 * the page renders, its cards load (no "Loading…" left), no console error and
 * no page error, no sideways scroll; a full-page screenshot of each is kept.
 * The last stdout line is JSON:
 * { ok, failed: [...], shots: [...] }.
 *
 *   node scripts/ask-gate.mjs --base http://127.0.0.1:5243 --out <dir>
 */
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const base = arg("--base", "http://127.0.0.1:5243").replace(/\/$/, "");
const out = path.resolve(arg("--out", "ask-gate-shots"));
mkdirSync(out, { recursive: true });

const failed = [];
const shots = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const PAGES = [
    { name: "region", path: "/cards/", ready: '[data-testid="cockpit-region"]' },
    { name: "cockpit", path: "/cards/cockpit", ready: '[data-testid="cockpit-full"] [data-testid="cockpit-region"]' },
  ];
  for (const pg of PAGES)
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    const tag = `${pg.name} ${w}`;
    page.on("console", (m) => {
      if (m.type() === "error") errors.push((m.text() + (m.location()?.url ? " @ " + m.location().url.replace(base, "") : "")).slice(0, 240));
    });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    // a failed resource's console line names no URL; this does
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(base, "").slice(0, 120)}`);
    });
    try {
      const resp = await page.goto(base + pg.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!resp || resp.status() >= 400) failed.push(`${tag}: the page answered ${resp ? resp.status() : "nothing"}`);
      await page.waitForSelector(pg.ready, { timeout: 30_000 });
      await page
        .waitForFunction(() => {
          const hls = [...document.querySelectorAll(".cp-card .cp-hl")].map((e) => e.textContent);
          return hls.length > 0 && !hls.includes("Loading…");
        }, null, { timeout: 45_000 })
        .catch(() => failed.push(`${tag}: the cards did not finish loading`));
      await page.waitForTimeout(1500);
      const a = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (a.sw > a.cw + 1) failed.push(`${tag}: sideways scroll (${a.sw} > ${a.cw})`);
      const file = path.join(out, `gate-${pg.name}-${w}.png`);
      await page.screenshot({ path: file, fullPage: true });
      if (statSync(file).size < 10_000) failed.push(`${tag}: the screenshot is nearly empty`);
      shots.push(file);
    } catch (e) {
      failed.push(`${tag}: ${String(e && e.message ? e.message : e).split("\n")[0].slice(0, 200)}`);
    }
    if (errors.length) failed.push(`${tag}: console errors: ${[...new Set(errors)].slice(0, 4).join(" | ")}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const f of failed) console.log("FAIL " + f);
console.log(JSON.stringify({ ok: failed.length === 0, failed, shots }));
process.exit(failed.length ? 1 : 0);
