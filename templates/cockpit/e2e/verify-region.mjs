#!/usr/bin/env node
/**
 * Drives the BUILT card region with Playwright (system Chrome) and proves:
 *   - get-cards returns 14 cards; set-layout refuses an unknown id;
 *   - a set-layout move changes the rendered order;
 *   - a card click posts { type: 'cockpit-open', sec } and the region posts
 *     { type: 'cockpit-height', h } to its parent (run inside an iframe);
 *   - no horizontal scroll and no clipped text at 1280x900 and 390x844;
 *   - with --agent, a real "Ask agent" question rearranges the cards.
 * Screenshots go to the directory given as the first argument.
 *
 *   node e2e/verify-region.mjs <shots-dir> [--agent] [--base http://127.0.0.1:5241]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith("--")) || "shots");
const withAgent = args.includes("--agent");
const base = (args[args.indexOf("--base") + 1] && args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://127.0.0.1:5241").replace(/\/$/, "");
const url = base + "/cards/";
mkdirSync(outDir, { recursive: true });

const DEFAULT = {
  bands: [
    { id: "flow", title: "Flow", cards: ["score", "pipeline", "production", "board"] },
    { id: "work", title: "Work", cards: ["jobs", "forge", "orphans", "hygiene", "events"] },
    { id: "compute", title: "Models & compute", cards: ["models", "halo", "halocaps", "modes", "appkpis"] },
  ],
  hidden: [],
  size: {},
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
};

const call = (page, name, body) =>
  page.evaluate(
    async ({ name, body }) => {
      const r = await fetch(`/cards/_agent-native/actions/${name}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try {
        json = await r.json();
      } catch {}
      return { status: r.status, json };
    },
    { name, body },
  );

const waitForData = (page) =>
  page.waitForFunction(
    () => {
      const hls = [...document.querySelectorAll(".cp-card .cp-hl")].map((e) => e.textContent);
      return hls.length === 14 && !hls.includes("Loading…") && /live/.test(document.querySelector(".cp-live")?.textContent || "");
    },
    null,
    { timeout: 30_000 },
  );

const bandOrder = (page, band) =>
  page.$$eval(`[data-band="${band}"] .cp-card`, (els) => els.map((e) => e.getAttribute("data-card")));

async function layoutAudit(page, label) {
  const a = await page.evaluate(() => {
    const doc = document.documentElement;
    const clipped = [];
    for (const el of document.querySelectorAll(".cp-title span, .cp-hl, .cp-sub, .cp-chip")) {
      if (getComputedStyle(el).display === "none") continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) clipped.push(el.textContent);
    }
    const cards = [...document.querySelectorAll(".cp-card")].map((c) => c.getBoundingClientRect());
    const rows = new Map();
    for (const r of cards) {
      const k = Math.round(r.top);
      rows.set(k, [...(rows.get(k) || []), r]);
    }
    const misaligned = [...rows.values()].filter((rs) => new Set(rs.map((r) => Math.round(r.height))).size > 1).length;
    return {
      hScroll: doc.scrollWidth > doc.clientWidth,
      clipped,
      heights: cards.map((r) => Math.round(r.height)),
      misaligned,
      lowContrast: (() => {
        // the dimmest text colour used on a card against the panel
        const lum = (c) => {
          // rgb(r, g, b) or color(srgb r g b) (what color-mix computes to)
          let m = c.match(/\d+(\.\d+)?/g).map(Number);
          if (c.startsWith("color(")) m = m.map((v) => v * 255);
          const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        const bg = lum("rgb(6,16,29)");
        let worst = 99;
        for (const el of document.querySelectorAll(".cp-sub, .cp-title, .cp-chip, .cp-hl")) {
          const l = lum(getComputedStyle(el).color);
          worst = Math.min(worst, (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05));
        }
        return Math.round(worst * 10) / 10;
      })(),
    };
  });
  check(`${label}: no horizontal scroll`, !a.hScroll);
  check(`${label}: no clipped text`, a.clipped.length === 0, a.clipped.length ? "clipped: " + a.clipped.slice(0, 5).join(" | ") : "");
  check(`${label}: cards in a row share a height`, a.misaligned === 0, `${a.misaligned} uneven rows`);
  check(`${label}: text contrast >= 4.5`, a.lowContrast >= 4.5, `worst ${a.lowContrast}:1`);
  return a;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  // ---------- desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await call(page, "set-layout", DEFAULT);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForData(page);

  const gc = await call(page, "get-cards");
  check("get-cards returns 14 cards", gc.status === 200 && gc.json?.cards?.length === 14, `status ${gc.status}, ${gc.json?.cards?.length} cards, ${JSON.stringify(gc.json).length} bytes`);

  const bad = await call(page, "set-layout", { ...DEFAULT, bands: [{ id: "flow", title: "Flow", cards: ["score", "bogus-card"] }] });
  check("set-layout refuses an unknown id", bad.status >= 400 && /unknown card id: bogus-card/.test(JSON.stringify(bad.json)), `status ${bad.status}: ${JSON.stringify(bad.json).slice(0, 160)}`);
  const after = await call(page, "get-layout");
  check("refused set-layout wrote nothing", JSON.stringify(after.json) === JSON.stringify(DEFAULT));

  // a band title in the main column, a size 'l' card spanning both columns
  await page.screenshot({ path: path.join(outDir, "desktop-1280.png"), fullPage: true });
  const desk = await layoutAudit(page, "desktop 1280");
  console.log("desktop card heights", desk.heights.join(","));

  const before = await bandOrder(page, "compute");
  const moved = {
    ...DEFAULT,
    bands: DEFAULT.bands.map((b) => (b.id === "compute" ? { ...b, cards: ["halo", ...b.cards.filter((c) => c !== "halo")] } : b)),
    size: { halo: "l" },
  };
  const set = await call(page, "set-layout", moved);
  check("set-layout accepts a move", set.status === 200, `status ${set.status}`);
  await page.waitForFunction(() => document.querySelector('[data-band="compute"] .cp-card')?.getAttribute("data-card") === "halo", null, { timeout: 12_000 }).catch(() => {});
  const afterMove = await bandOrder(page, "compute");
  check("a set-layout move changes the rendered order", before[0] !== "halo" && afterMove[0] === "halo", `${before.join(",")} -> ${afterMove.join(",")}`);
  const spans = await page.$eval('[data-card="halo"]', (e) => e.getBoundingClientRect().width > e.parentElement.getBoundingClientRect().width * 0.9);
  check("size 'l' spans both columns", spans);
  await page.screenshot({ path: path.join(outDir, "desktop-1280-moved.png"), fullPage: true });
  await call(page, "set-layout", DEFAULT);

  // keyboard: cards are focusable buttons with labels
  const kb = await page.$eval(".cp-card", (e) => ({ tag: e.tagName, label: e.getAttribute("aria-label") }));
  check("cards are keyboard-focusable buttons with aria-labels", kb.tag === "BUTTON" && kb.label.length > 20, kb.label.slice(0, 80));
  check("no page errors on desktop", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  // ---------- embedded in a parent page: messages ----------
  const ectx = await browser.newContext({ viewport: { width: 640, height: 1520 } });
  const epage = await ectx.newPage();
  const msgs = [];
  await epage.exposeFunction("__cockpitMsg", (m) => msgs.push(m));
  // the harness is served from the app's own origin, as the cockpit serves the region through its same-origin proxy
  const harness = base + "/__cockpit-harness";
  await epage.route(harness, (r) =>
    r.fulfill({
      contentType: "text/html",
      // the cockpit's neon page: #03070f with its 40 px circuit grid; the iframe declares color-scheme dark as the cockpit's does
      body: `<!doctype html><body style="margin:0;padding:10px;background:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 20h40M20 0v40' stroke='%230d2a45' stroke-width='.5' stroke-opacity='.5' fill='none'/%3E%3Ccircle cx='20' cy='20' r='1' fill='%231a4a70' fill-opacity='.6'/%3E%3C/svg%3E&quot;) 0 0/40px 40px,#03070f"><iframe id="f" src="${url}" style="display:block;width:620px;height:1500px;border:0;background:transparent;color-scheme:dark"></iframe>
<script>addEventListener("message", (e) => window.__cockpitMsg(e.data));</script></body>`,
    }),
  );
  await epage.goto(harness);
  const frame = await (await epage.waitForSelector("#f")).contentFrame();
  await waitForData(frame);
  await epage.screenshot({ path: path.join(outDir, "embedded-620-on-cockpit-grid.png") });
  await layoutAudit(frame, "embedded 620");
  const transparent = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(document.documentElement).backgroundColor === "rgba(0, 0, 0, 0)");
  check("the region's page background is transparent", transparent);
  await frame.click('[data-card="board"]');
  await frame.focus('[data-card="halo"]');
  await epage.keyboard.press("Enter");
  await epage.waitForTimeout(500);
  const opens = msgs.filter((m) => m && m.type === "cockpit-open").map((m) => m.sec);
  check("a card click posts cockpit-open to the parent", opens.includes("board"), JSON.stringify(opens));
  check("Enter on a focused card posts cockpit-open", opens.includes("halo"));
  const heights = msgs.filter((m) => m && m.type === "cockpit-height").map((m) => m.h);
  check("the region posts cockpit-height to the parent", heights.length > 0 && heights.every((h) => h > 200), heights.join(","));
  await ectx.close();

  // ---------- phone ----------
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ppage = await pctx.newPage();
  await ppage.goto(url, { waitUntil: "domcontentloaded" });
  await waitForData(ppage);
  await ppage.screenshot({ path: path.join(outDir, "phone-390.png"), fullPage: true });
  const ph = await layoutAudit(ppage, "phone 390");
  const inRange = ph.heights.every((h) => h >= 76 && h <= 88);
  check("phone cards are compact (76-88 px)", inRange, ph.heights.join(","));
  const total = await ppage.evaluate(() => Math.ceil(document.querySelector("[data-testid=cockpit-region]").getBoundingClientRect().height));
  check("phone region far shorter than 17 rows x 178 px", total < 17 * 178 * 0.6, `${total} px vs ${17 * 178} px`);
  await ppage.click('[data-band="work"] .cp-band-h');
  const collapsed = await ppage.$eval('[data-band="work"] .cp-grid', (e) => getComputedStyle(e).display === "none");
  check("phone bands collapse", collapsed);
  await ppage.screenshot({ path: path.join(outDir, "phone-390-collapsed.png"), fullPage: true });
  await ppage.click('[data-band="work"] .cp-band-h');
  await pctx.close();

  // ---------- the agent ----------
  if (withAgent) {
    const actx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    const apage = await actx.newPage();
    await apage.goto(url, { waitUntil: "domcontentloaded" });
    await call(apage, "set-layout", DEFAULT);
    await apage.reload({ waitUntil: "domcontentloaded" });
    await waitForData(apage);
    const pre = await bandOrder(apage, "compute");
    await apage.click("button.cp-btn[aria-controls=cp-ask]");
    await apage.fill("#cp-ask-q", "move Halo to the top of Models & compute");
    await apage.screenshot({ path: path.join(outDir, "agent-asking.png") });
    await apage.click(".cp-ask-row .cp-btn");
    await apage.waitForSelector(".cp-ask-out:not(.busy)", { timeout: 140_000 });
    const out = await apage.$eval(".cp-ask-out", (e) => ({ text: e.textContent, err: e.classList.contains("err") }));
    await apage.waitForFunction(() => document.querySelector('[data-band="compute"] .cp-card')?.getAttribute("data-card") === "halo", null, { timeout: 10_000 }).catch(() => {});
    const post = await bandOrder(apage, "compute");
    check("Ask agent answered", !out.err, out.text.slice(0, 200));
    check("the agent moved Halo to the top of Models & compute", pre[0] !== "halo" && post[0] === "halo", `${pre.join(",")} -> ${post.join(",")}`);
    await apage.screenshot({ path: path.join(outDir, "agent-moved-halo.png"), fullPage: true });
    await call(apage, "set-layout", DEFAULT); // leave the region on its default layout
    await actx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
