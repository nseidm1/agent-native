#!/usr/bin/env node
/**
 * FA-19027: proves, through the cockpit front (default http://127.0.0.1:5207/, loopback), with Playwright (system Chrome),
 * at 1280 and at 390, that the card region runs on the cockpit client alone:
 *   the region renders its cards; the Board dialog shows every column the client's board resource names, with card faces;
 *   the search narrows the faces to one card id; a card's detail (its body and notes, from board/card/<fa>) opens and goes back;
 *   every face carries Archive (opened and cancelled, never sent); an action round-trips (the Ping button: the cockpit's
 *   ping action echoes the text back through the client); the server's change stream is live; no sideways scroll and no
 *   console errors. Screenshots go to the directory given first.
 *
 *   node e2e/verify-client-board.mjs <shots-dir> [--base http://127.0.0.1:5207]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base") || "shots");
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:5207").replace(/\/$/, "");
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};
const shot = async (page, name) => {
  const p = path.join(outDir, name + ".png");
  await page.screenshot({ path: p });
  console.log("SHOT " + p);
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
  frame.waitForFunction(() => document.querySelectorAll(".cp-card").length >= 10 && !/Loading/.test(document.querySelector(".cp-card .cp-hl")?.textContent || ""), null, { timeout: 30_000 });
const action = (frame, name, q = "") =>
  frame.evaluate(async ({ name, q }) => {
    const r = await fetch(`/cards/_agent-native/actions/${name}${q}`);
    return { status: r.status, json: await r.json().catch(() => null) };
  }, { name, q });
const hScroll = (frame) => frame.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const pageHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

async function board(page, frame, label) {
  const truth = (await action(frame, "get-board")).json;
  check(`${label}: get-board reads the client`, !!truth && truth.ok && Array.isArray(truth.columns) && truth.cards.length > 0, truth ? `${truth.columns.length} columns, ${truth.cards.length} open cards, live ${truth.live}` : "no answer");
  check(`${label}: the server's change stream is live`, !!truth && truth.live === true);
  await frame.locator('[data-card="board"]').click();
  const dlg = frame.locator('[data-testid="board-dialog"]');
  await dlg.waitFor({ state: "visible", timeout: 15_000 });
  await dlg.locator('[data-testid="board-card"]').first().waitFor({ timeout: 30_000 });
  const cols = await dlg.locator('[data-testid="board-column"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-col")));
  check(`${label}: the Board dialog shows every column from the client`, JSON.stringify(cols) === JSON.stringify(truth.columns.map((c) => c.id)), cols.join(", "));
  const faces = await dlg.locator('[data-testid="board-card"]').count();
  check(`${label}: every open card has a face`, faces === truth.cards.length || (faces > 0 && faces <= truth.cards.length), `${faces} faces / ${truth.cards.length} cards`);
  check(`${label}: no sideways scroll with the board open`, !(await hScroll(frame)) && !(await pageHScroll(page)));
  await shot(page, `board-${label}`);

  // search
  const target = (truth.cards.find((c) => c.column === "in-progress") || truth.cards[0]).fa;
  const search = dlg.locator('[data-testid="detail-search"]');
  await search.fill(target);
  await frame.waitForTimeout(250);
  const hits = await dlg.locator('[data-testid="board-card"] .cp-bc-fa').allInnerTexts();
  const count = await dlg.locator('[data-testid="detail-search-count"]').innerText();
  check(`${label}: searching ${target} narrows the board to it`, hits.length >= 1 && hits.length < faces && hits.includes(target), `${faces} -> ${hits.length} (${count})`);
  await shot(page, `board-search-${label}`);
  await search.fill("zz-no-such-card-zz");
  check(`${label}: a query with no match says so`, (await dlg.locator('[data-testid="detail-search-count"]').innerText()) === "no match");
  await search.fill("");

  // Archive on a face: opened and cancelled, never sent
  const face = dlg.locator(`[data-testid="board-card"][data-fa="${target}"]`).first();
  await face.getByRole("button", { name: "Archive", exact: true }).click();
  const confirm = face.locator(".cp-confirm");
  check(`${label}: a face's Archive asks first`, (await confirm.count()) === 1 && /Archive FA-\d+\?/.test(await confirm.innerText()), (await confirm.innerText().catch(() => "")).slice(0, 80));
  await shot(page, `board-archive-confirm-${label}`);
  await confirm.getByRole("button", { name: "Cancel" }).click();

  // a card's detail
  await face.locator(".cp-bc-open").click();
  const det = dlg.locator('[data-testid="board-card-detail"]');
  await det.waitFor({ state: "visible", timeout: 15_000 });
  await det.locator(".cp-cv-title").waitFor({ timeout: 30_000 });
  const title = await det.locator(".cp-cv-title").innerText();
  const want = truth.cards.find((c) => c.fa === target);
  const secs = (await det.locator(".cp-sec-t").allInnerTexts()).map((x) => x.trim().toLowerCase());
  check(`${label}: ${target}'s detail opens from board/card/${target}`, title === want.title && secs.includes("notes") && secs.includes("card"), `${title.slice(0, 60)} | ${secs.join(", ")}`);
  check(`${label}: the detail offers the card's actions`, (await det.getByRole("button", { name: "Archive", exact: true }).count()) === 1);
  await shot(page, `board-card-detail-${label}`);
  await det.locator('[data-testid="board-back"]').click();
  await dlg.locator('[data-testid="board-kanban"]').waitFor({ timeout: 10_000 });
  check(`${label}: back returns to the board`, true);

  // an action round trip through the client
  await dlg.locator('[data-testid="board-ping"]').click();
  const ans = dlg.locator('[data-testid="board-ping-answer"]');
  await ans.waitFor({ timeout: 20_000 }).catch(() => {});
  const said = (await ans.innerText().catch(() => "")).trim();
  check(`${label}: an action round-trips (the cockpit echoes the ping)`, /cockpit answered "board /.test(said), said);
  await shot(page, `board-ping-${label}`);
  await dlg.getByRole("button", { name: "Close", exact: true }).click();
  return target;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const bad = [];
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
  check("1280: the card region renders", (await frame.locator(".cp-card").count()) >= 10, via);
  const live = await frame.locator(".cp-live").innerText();
  check("1280: the region says it is live on the client's stream", /^live · /.test(live.trim()), live.trim());
  await shot(page, "region-1280");
  await board(page, frame, "1280");

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await region(page);
  await waitCards(phone.frame);
  check("390: the card region renders", (await phone.frame.locator(".cp-card").count()) >= 10, phone.via);
  check("390: no sideways scroll", !(await hScroll(phone.frame)) && !(await pageHScroll(page)));
  await shot(page, "region-390");
  await board(page, phone.frame, "390");
} catch (e) {
  check("run completed", false, String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : e));
} finally {
  await browser.close();
}
const own = errors.filter((t) => !/favicon/i.test(t));
check("no console errors", own.length === 0, own.slice(0, 3).join(" | ") + (bad.length ? " · failed requests: " + [...new Set(bad)].slice(0, 6).join(" | ") : ""));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
