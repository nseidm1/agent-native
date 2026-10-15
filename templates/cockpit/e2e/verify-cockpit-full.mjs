#!/usr/bin/env node
/**
 * FA-19087: proves, with Playwright (system Chrome) at 1280 and 390, that the agent-native cockpit
 * (/cards/cockpit) renders the legacy page's front-facing sections from the cockpit client alone, at parity:
 *   SIDE BY SIDE with the legacy page on the same data (read within seconds of each other): the status pill,
 *   the account chip, the master and push counts, the lock / Client / Production switches, the Budget, the six
 *   office tiles, the three faces, the drafting-mode face and the nine key-number tiles;
 *   no console errors and no sideways scroll at either width; the card region is inline (no iframe);
 *   a face opens its window (Speed -> the scorecard dialog; Overview -> the legacy window at the fallback path);
 *   WRITES ROUND-TRIP through the client: the lock is clicked twice (it returns to where it was, each click read
 *   back from the client), and the Budget's Auto is re-sent while Auto (a write that changes nothing).
 * Screenshots of both pages go to the directory given first.
 *
 *   node e2e/verify-cockpit-full.mjs <shots-dir> [--base http://127.0.0.1:5207] [--legacy http://127.0.0.1:5207/legacy/] [--proxy http://127.0.0.1:5207] [--no-writes]
 * --proxy serves every non-/cards path of --base from that origin (a build under test on its own port, before the front routes to it).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const outDir = path.resolve(args.find((a, i) => !a.startsWith("--") && !String(args[i - 1] || "").startsWith("--")) || "shots");
const base = opt("--base", "http://127.0.0.1:5207").replace(/\/$/, "");
const legacyUrl = opt("--legacy", "http://127.0.0.1:5207/legacy/");
const proxy = opt("--proxy", null);
const writes = !args.includes("--no-writes");
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

async function proxyRoutes(ctx) {
  if (!proxy) return;
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(?!cards(/|$)|_agent-native/)");
  await ctx.route(re, async (route) => {
    const u = new URL(route.request().url());
    if (/\/stream|\/events/.test(u.pathname)) return route.abort();
    try {
      const p = u.pathname.startsWith("/legacy/") ? u.pathname.slice(7) : u.pathname;
      const r = await route.fetch({ url: proxy + p + u.search });
      await route.fulfill({ response: r });
    } catch {
      await route.abort();
    }
  });
}

/** The legacy page's readings, by the ids its renderers write. */
const LEGACY_READ = () => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
  const vis = (s) => { const e = document.querySelector(s); return !!e && !e.hidden; };
  const office = [...document.querySelectorAll("#ofMeta .oftile, #ofMeta [data-i]")].map((x) => x.textContent.replace(/\s+/g, " ").trim());
  return {
    status: t("#idtxt"), account: t("#acctL"), halo: vis("#acctHB") ? t("#acctHB") : null,
    msg: vis("#msgN") ? t("#msgN") : null, push: vis("#pushN") ? t("#pushN") : null,
    lock: t("#modeLock .lkt"), client: t("#clientSwS"), production: t("#doorSwS"), budget: t("#budV"),
    office, ofHead: t("#ofHead"),
    faces: { overview: t("#face-overview .fh"), doorLanding: t("#face-doorLanding .fh"), speed: t("#face-speed .fh") },
    mode: t("#modeHd"),
    tiles: { kVel: t("#tHour"), kJev: t("#tJev"), kLanded: t("#tLanded"), kHalo: t("#tHalo"), kBalancer: t("#tBal"), kWt: t("#tWt"), kRg: t("#tRg"), kUsd: t("#tUsd"), kMin: t("#tMin") },
  };
};
const NEW_READ = () => {
  const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
  const tiles = {};
  for (const id of ["kVel", "kJev", "kLanded", "kHalo", "kBalancer", "kWt", "kRg", "kUsd", "kMin"]) tiles[id] = id === "kVel" ? t(`[data-tile=kVel] .cf-vnum`) : t(`[data-tile=${id}] .cf-val`);
  return {
    status: t("[data-testid=cf-status]"), account: t(".cf-acct .cf-acl"), halo: t(".cf-acct .cf-ach"),
    msg: t(".cf-msg .cf-msgn"), push: t(".cf-push .cf-msgn"),
    lock: t(".cf-lock .cf-lkt"), client: t("[data-sw=client] .cf-dsws"), production: t("[data-sw=production] .cf-dsws"), budget: t(".cf-cv"),
    office: [...document.querySelectorAll(".cf-oftile")].map((x) => x.textContent.replace(/\s+/g, " ").trim()), ofHead: t(".cf-ofs"),
    faces: { overview: t("[data-face=overview] .cf-fh"), doorLanding: t("[data-face=doorLanding] .cf-fh"), speed: t("[data-face=speed] .cf-fh") },
    mode: t(".cf-mode .cf-mfh"),
    tiles,
  };
};

const browser = await chromium.launch({ channel: "chrome" });
try {
  // 1. the legacy page and the agent-native page, read at the same moment, at 1280
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await proxyRoutes(ctx);
  const errs = [];
  const lp = await ctx.newPage(), np = await ctx.newPage();
  np.on("console", (m) => m.type() === "error" && !String((m.location() && m.location().url) || "").includes("/legacy/") && !/\/api\/|\/page\/|\/ui\//.test(String((m.location() && m.location().url) || "")) && errs.push(m.text() + " @ " + (m.location() && m.location().url)));
  np.on("pageerror", (e) => errs.push(String(e)));
  // only this page's own requests: the legacy window's frame is the legacy page, whose requests are its own
  np.on("response", (r) => r.status() >= 400 && r.frame() === np.mainFrame() && errs.push(r.status() + " " + r.url()));
  await Promise.all([lp.goto(legacyUrl, { waitUntil: "domcontentloaded" }), np.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" })]);
  await np.waitForSelector("[data-testid=cf-home] [data-tile=kMin]", { timeout: 40_000 });
  await lp.waitForFunction(() => { const e = document.querySelector("#tMin"); return e && e.textContent.trim().length > 0; }, null, { timeout: 40_000 });
  let L, N, diffs = [];
  for (let round = 0; round < 4; round++) {
    await np.waitForTimeout(round ? 4000 : 6000);
    [L, N] = await Promise.all([lp.evaluate(LEGACY_READ), np.evaluate(NEW_READ)]);
    diffs = [];
    const cmp = (k, a, b) => { if (norm(a).toLowerCase() !== norm(b).toLowerCase()) diffs.push(`${k}: legacy "${norm(a)}" vs agent-native "${norm(b)}"`); };
    for (const k of ["status", "account", "halo", "msg", "push", "lock", "client", "production", "budget", "mode"]) cmp(k, L[k], N[k]);
    for (const k of Object.keys(L.faces)) cmp("face " + k, L.faces[k], N.faces[k]);
    for (const k of Object.keys(L.tiles)) cmp("tile " + k, L.tiles[k], N.tiles[k]);
    const nums = (xs) => xs.map((x) => (x.match(/\d+/g) || []).join("/")).join(" | ");
    if (L.office.length) cmp("office", nums(L.office), nums(N.office));
    if (!diffs.length) break;
  }
  check("side by side at 1280: every home and header reading matches the legacy page", !diffs.length, diffs.slice(0, 8).join("; "));
  check("the office shows its six tiles", N.office.length === 6, N.office.join(" | "));
  await lp.screenshot({ path: path.join(outDir, "legacy-1280.png") });
  await np.screenshot({ path: path.join(outDir, "agent-native-1280.png") });
  await np.screenshot({ path: path.join(outDir, "agent-native-1280-full.png"), fullPage: true });
  check("the card region is inline (no iframe), with its 14 cards", (await np.locator("iframe").count()) === 0 && (await np.locator(".cf-launch .cp-card").count()) === 14);
  check("no sideways scroll at 1280", (await np.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);

  // 2. a face opens its window: Speed -> the scorecard dialog (the region's own), Overview -> the legacy window at the fallback path
  await np.click("[data-face=speed]");
  const dlg = np.getByRole("dialog");
  await dlg.first().waitFor({ state: "visible", timeout: 15_000 });
  check("Speed opens the scorecard window", /scorecard/i.test(await dlg.first().innerText()));
  await np.screenshot({ path: path.join(outDir, "agent-native-1280-scorecard.png") });
  await np.keyboard.press("Escape");
  await np.waitForTimeout(500);
  await np.click("[data-face=overview]");
  const lw = np.locator("[data-testid=cf-legacy] iframe");
  await lw.waitFor({ state: "visible", timeout: 15_000 });
  const fr = await (await lw.elementHandle()).contentFrame();
  const opened = await fr.waitForFunction(() => { const d = document.getElementById("secDlg"); return d && d.open && /overview/i.test(document.getElementById("secH").textContent); }, null, { timeout: 30_000 }).then(() => true, () => false);
  check("Overview opens the legacy Overview window at the fallback path", opened);
  await np.screenshot({ path: path.join(outDir, "agent-native-1280-overview.png") });
  await np.click("[data-testid=cf-legacy] .cf-legacy-bar button");
  await np.waitForTimeout(400);

  // 3. writes round-trip through the client
  if (writes) {
    const lockText = async () => norm(await np.locator(".cf-lock .cf-lkt").innerText());
    const before = await lockText();
    await np.click(".cf-lock");
    const flipped = await np.waitForFunction((b) => { const e = document.querySelector(".cf-lock .cf-lkt"); return e && e.textContent.trim() !== b && !document.querySelector(".cf-lock").disabled; }, before, { timeout: 30_000 }).then(() => true, () => false);
    const mid = await lockText();
    await np.waitForTimeout(3500); // past the 3 s hold: the switch now shows the client's reading, not the page's own
    const midRead = await lockText();
    await np.click(".cf-lock");
    const back = await np.waitForFunction((b) => { const e = document.querySelector(".cf-lock .cf-lkt"); return e && e.textContent.trim() === b && !document.querySelector(".cf-lock").disabled; }, before, { timeout: 30_000 }).then(() => true, () => false);
    await np.waitForTimeout(3500);
    const after = await lockText();
    check("the lock round-trips: " + before + " -> " + mid + " (read back " + midRead + ") -> " + after, flipped && mid !== before && midRead === mid && back && after === before);
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/get-home", location.origin));
      const h = await res.json();
      if (!h.budget || !h.budget.auto) return { skipped: "the budget is not Auto: not re-sending a value" };
      const w = await fetch(new URL("/cards/_agent-native/actions/cockpit-budget", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto: true }) });
      return { status: w.status, body: (await w.text()).slice(0, 200) };
    });
    check("the Budget's Auto round-trips through the client (re-sent while Auto)", r.skipped ? true : r.status === 200 && /"ok":true/.test(r.body), JSON.stringify(r));
  }
  check("no console errors or failed requests at 1280", errs.length === 0, errs.slice(0, 4).join(" | "));
  await ctx.close();

  // 4. the phone
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await proxyRoutes(pctx);
  const perr = [];
  const pp = await pctx.newPage(), pl = await pctx.newPage();
  pp.on("console", (m) => m.type() === "error" && perr.push(m.text()));
  pp.on("pageerror", (e) => perr.push(String(e)));
  pp.on("response", (r) => r.status() >= 400 && r.frame() === pp.mainFrame() && perr.push(r.status() + " " + r.url()));
  await Promise.all([pp.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" }), pl.goto(legacyUrl, { waitUntil: "domcontentloaded" })]);
  await pp.waitForSelector("[data-testid=cf-home] [data-tile=kMin]", { timeout: 40_000 });
  await pp.waitForTimeout(5000);
  await pl.waitForTimeout(3000);
  check("no sideways scroll at 390", (await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  const order = await pp.evaluate(() => ["[data-testid=cf-lane]", "[data-testid=cf-office]", "[data-face=overview]", "[data-tile=kVel]", ".cf-launch .cp-card"].map((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top + scrollY) : -1; }));
  check("phone order: lane, office, faces, key numbers, then the cards", order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), order.join(" < "));
  const small = await pp.evaluate(() => [...document.querySelectorAll(".cf-home button, .cf-top button, .cf-switch")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 40).map((b) => b.className || b.textContent).slice(0, 5));
  check("phone controls are at least 40 px tall", small.length === 0, small.join(", "));
  await pp.screenshot({ path: path.join(outDir, "agent-native-390.png") });
  await pp.screenshot({ path: path.join(outDir, "agent-native-390-full.png"), fullPage: true });
  await pl.screenshot({ path: path.join(outDir, "legacy-390.png") });
  await pp.locator("[data-tile=kMin]").scrollIntoViewIfNeeded();
  await pp.screenshot({ path: path.join(outDir, "agent-native-390-keys.png") });
  check("no console errors or failed requests at 390", perr.length === 0, perr.slice(0, 4).join(" | "));
  await pctx.close();
} catch (e) {
  check("the run completed", false, String(e && e.message).slice(0, 300));
} finally {
  await browser.close();
}
const ok = results.length > 0 && results.every((r) => r.ok);
console.log(ok ? "GREEN" : "RED");
process.exit(ok ? 0 : 1);
