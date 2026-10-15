#!/usr/bin/env node
/**
 * Proves, through the cockpit (default http://127.0.0.1:5207/, loopback), with Playwright (system Chrome):
 *   (b) a layout ask in the Ask agent panel takes the layout path and rearranges the cards (the layout is restored after);
 *   (a) with --file-card: "Add a search button to the board card's dialog" takes the change path, files a board card,
 *       replies "Filed FA-n: ...", and changes nothing: the fork's HEAD, its working tree and the built server are as before;
 *   (c) the Board card's dialog has a search field that narrows the list when a card id is typed, at 1280 and 390;
 * no console errors and no sideways scroll. Screenshots go to the directory given first.
 *
 *   node e2e/verify-ask-and-search.mjs <shots-dir> [--file-card] [--base http://127.0.0.1:5207]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith("--") && !["--base", "--id"].includes(args[args.indexOf(a) - 1])) || "shots");
const fileCard = args.includes("--file-card");
const searchId = args.includes("--id") ? args[args.indexOf("--id") + 1] : "";
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:5207").replace(/\/$/, "");
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const git = (...a) => execFileSync("git", ["-C", APP, ...a], { encoding: "utf8" }).trim();
const builtAt = () => {
  try {
    return statSync(path.join(APP, ".output", "server", "index.mjs")).mtimeMs;
  } catch {
    return 0;
  }
};

/** The card region: the cockpit's iframe when it shows one at this width, else the region through the cockpit's /cards proxy. */
async function region(page) {
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  const iframe = page.locator("iframe.cregion");
  try {
    await iframe.waitFor({ state: "visible", timeout: 20_000 });
    const h = await iframe.elementHandle().catch(() => null);
    const frame = h ? await h.contentFrame() : null;
    if (frame) {
      await frame.waitForSelector('[data-testid="cockpit-region"]', { timeout: 30_000 });
      return { frame, via: "cockpit iframe" };
    }
  } catch {
    // not shown at this width
  }
  await page.goto(base + "/cards/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="cockpit-region"]', { timeout: 30_000 });
  return { frame: page.mainFrame(), via: "cockpit /cards/ proxy" };
}

const waitCards = (frame) =>
  frame.waitForFunction(() => document.querySelectorAll(".cp-card").length >= 10 && !/Loading/.test(document.querySelector(".cp-card .cp-hl")?.textContent || ""), null, {
    timeout: 30_000,
  });

const action = (frame, name, body) =>
  frame.evaluate(
    async ({ name, body }) => {
      const r = await fetch(`/cards/_agent-native/actions/${name}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { name, body },
  );

async function ask(frame, question) {
  if (!(await frame.locator("#cp-ask-q").count())) await frame.getByRole("button", { name: /Ask agent/ }).click();
  await frame.fill("#cp-ask-q", question);
  await frame.getByRole("button", { name: "Send", exact: true }).click();
  await frame.waitForSelector('[data-testid="ask-answer"], .cp-ask-out.err', { timeout: 300_000 });
  const err = await frame.locator(".cp-ask-out.err").count();
  if (err) return { kind: "error", text: await frame.locator(".cp-ask-out.err").innerText() };
  const a = frame.locator('[data-testid="ask-answer"]');
  return { kind: await a.getAttribute("data-kind"), text: await a.innerText(), meta: await frame.locator('[data-testid="ask-meta"]').innerText() };
}

const hScroll = (frame) => frame.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const pageHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function boardSearch(page, frame, label, id) {
  await frame.locator('[data-card="board"]').click();
  const dlg = frame.locator('[role="dialog"].cp-dlg');
  await dlg.waitFor({ state: "visible", timeout: 15_000 });
  const search = dlg.locator('[data-testid="detail-search"]');
  await search.waitFor({ state: "visible", timeout: 20_000 });
  await dlg.locator(".cp-tbl tbody tr:not(.cp-xr)").first().waitFor({ timeout: 20_000 });
  const rowsBefore = await dlg.locator(".cp-tbl tbody tr:not(.cp-xr)").count();
  const target = id || (await dlg.locator(".cp-tbl tbody tr:not(.cp-xr) td.first").first().innerText()).trim();
  await search.fill(target);
  // a card filed a moment ago reaches the dialog on its next read of the cockpit state (the dialog refetches every 5 s)
  await frame
    .waitForFunction(() => /card/.test(document.querySelector('[data-testid="detail-search-count"]')?.textContent || ""), null, { timeout: 30_000 })
    .catch(() => {});
  const firsts = await dlg.locator(".cp-tbl tbody tr:not(.cp-xr) td.first").allInnerTexts();
  const count = await dlg.locator('[data-testid="detail-search-count"]').innerText();
  check(`${label}: Board dialog has a search field`, true, `placeholder "${await search.getAttribute("placeholder")}"`);
  check(`${label}: typing ${target} narrows the list`, firsts.length >= 1 && firsts.length < rowsBefore && firsts.every((t) => t.trim() === target), `${rowsBefore} rows -> ${firsts.length} (${count}): ${firsts.slice(0, 3).join(", ")}`);
  check(`${label}: no sideways scroll with the dialog open`, !(await hScroll(frame)) && !(await pageHScroll(page)));
  await page.screenshot({ path: path.join(outDir, `board-search-${label}.png`) });
  await search.fill("zz-no-such-card-zz");
  check(`${label}: a query with no match says so`, (await dlg.locator('[data-testid="detail-search-count"]').innerText()) === "no match");
  await search.fill("");
  check(`${label}: clearing the search brings every row back`, (await dlg.locator(".cp-tbl tbody tr:not(.cp-xr)").count()) === rowsBefore);
  await dlg.getByRole("button", { name: "Close", exact: true }).click();
  return target;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const bad = [];
let filedFa = "";
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) bad.push(r.status() + " " + r.url());
  });
  const { frame, via } = await region(page);
  await waitCards(frame);
  check("1280: the card region loads", true, via);

  // (b) a layout ask still takes the layout path and rearranges
  const before = (await action(frame, "get-layout")).json;
  const compute = before.bands.find((b) => b.id === "compute");
  const halo = "halo";
  const wantTop = compute.cards[0] !== halo;
  const order = () => frame.$$eval('[data-band="compute"] .cp-card', (els) => els.map((e) => e.getAttribute("data-card")));
  const orderBefore = await order();
  const layoutAsk = await ask(frame, wantTop ? "Move Halo to the top of Models & compute" : "Move Halo to the bottom of Models & compute");
  await frame.waitForTimeout(6000); // the layout poll is 5 s
  const orderAfter = await order();
  check("layout ask takes the layout path", layoutAsk.kind === "layout", `${layoutAsk.kind}: ${layoutAsk.text} | ${layoutAsk.meta}`);
  check("layout ask rearranges the cards", JSON.stringify(orderAfter) !== JSON.stringify(orderBefore) && (wantTop ? orderAfter[0] === halo : orderAfter.at(-1) === halo), `${orderBefore.join(",")} -> ${orderAfter.join(",")}`);
  await page.screenshot({ path: path.join(outDir, "ask-layout-1280.png") });
  const restored = await action(frame, "set-layout", before);
  check("layout restored after the check", restored.status === 200, String(restored.status));

  // (a) a change request files a card and changes nothing
  if (fileCard) {
    const head0 = git("rev-parse", "HEAD");
    const tree0 = git("status", "--porcelain");
    const built0 = builtAt();
    const t0 = Date.now();
    const r = await ask(frame, "Add a search button to the board card's dialog");
    const m = /^(?:Filed|Already filed as) (FA-\d+): /.exec(r.text || "");
    filedFa = m ? m[1] : "";
    check("change request takes the change path", r.kind === "change", `${r.kind}: ${r.text} | ${r.meta}`);
    check("change request replies with the filed card number", !!filedFa, r.text);
    check("change request changed no code: fork HEAD and working tree as before", git("rev-parse", "HEAD") === head0 && git("status", "--porcelain") === tree0, head0.slice(0, 8));
    check("change request triggered no build", builtAt() === built0, `built server mtime ${new Date(built0).toISOString()}, ask took ${Math.round((Date.now() - t0) / 1000)} s`);
    await page.screenshot({ path: path.join(outDir, "ask-change-1280.png") });
  }

  // (c) the Board dialog's search, desktop
  const searched = await boardSearch(page, frame, "1280", filedFa || searchId);
  check("1280: no sideways scroll", !(await hScroll(frame)) && !(await pageHScroll(page)));

  // (c) phone
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await region(page);
  await waitCards(phone.frame);
  check("390: the card region loads", true, phone.via);
  await boardSearch(page, phone.frame, "390", searched);
  check("390: no sideways scroll", !(await hScroll(phone.frame)) && !(await pageHScroll(page)));
} catch (e) {
  check("run completed", false, String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await browser.close();
}
const own = errors.filter((t) => !/favicon/i.test(t));
check("no console errors", own.length === 0, own.slice(0, 3).join(" | ") + (bad.length ? " · failed requests: " + [...new Set(bad)].slice(0, 6).join(" | ") : ""));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${filedFa ? " · filed " + filedFa : ""}`);
process.exit(failed.length ? 1 : 0);
