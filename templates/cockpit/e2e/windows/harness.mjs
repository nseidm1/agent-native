/**
 * FA-19087: the windows' parity harness (verify-cockpit-full.mjs runs it). Each window is a module in this
 * directory (listed in ./index.mjs) exporting:
 *   id, label
 *   openLegacy(lp)    open the legacy page's own window (by its button or hash) and wait for it
 *   readLegacy(lp)    the readings the legacy window shows, as plain data
 *   openNative(np)    open the agent-native window from its own control (never LegacyWindow) and wait for it
 *   readNative(np)    the same readings from the agent-native window
 *   compare(L, N)     differences, as sentences ([] = parity)
 *   writes?(np, check, { width })   optional, 1280 only: a write that round-trips through the client
 *   window?, shot?    optional: the agent-native window id it opens (default id) and the screenshot name (default id)
 * At 1280 and 390, side by side on the same data (re-read up to four times, a few seconds apart, for a live
 * reading that moved between the reads): parity, no legacy frame in the agent-native window, no sideways
 * scroll, and screenshots of both into <shots>/windows/<id>-<width>-{legacy,agent-native}.png.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

export const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
/** A list of differences between two flat records (strings, numbers, arrays of strings), case- and space-blind. */
export function diffRecords(L, N, keys = Object.keys(L || {})) {
  const out = [];
  const f = (v) => (Array.isArray(v) ? v.map(norm).join(" | ") : norm(v)).toLowerCase();
  for (const k of keys) if (f(L && L[k]) !== f(N && N[k])) out.push(`${k}: legacy "${f(L && L[k]).slice(0, 160)}" vs agent-native "${f(N && N[k]).slice(0, 160)}"`);
  return out;
}

export async function runWindows({ browser, windows, base, legacyUrl, outDir, check, proxyRoutes, widths = [1280, 390], writes = true }) {
  const dir = path.join(outDir, "windows");
  mkdirSync(dir, { recursive: true });
  for (const width of widths) {
    const phone = width < 600;
    const ctx = await browser.newContext(phone ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width, height: 900 } });
    if (proxyRoutes) await proxyRoutes(ctx);
    const lp = await ctx.newPage(), np = await ctx.newPage();
    const errs = [];
    np.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    np.on("pageerror", (e) => errs.push(String(e)));
    np.on("response", (r) => r.status() >= 400 && r.frame() === np.mainFrame() && errs.push(r.status() + " " + r.url()));
    lp.on("dialog", (d) => d.dismiss().catch(() => {}));
    await Promise.all([lp.goto(legacyUrl, { waitUntil: "domcontentloaded" }), np.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" })]);
    await np.waitForSelector("[data-testid=cf-home] [data-tile=kMin]", { timeout: 40_000 });
    await lp.waitForFunction(() => { const e = document.querySelector("#tMin"); return e && e.textContent.trim().length > 0; }, null, { timeout: 40_000 });
    await np.waitForTimeout(2500);
    for (const w of windows) {
      const tag = `${w.label} at ${width}`;
      try {
        await w.openLegacy(lp, { width });
        await w.openNative(np, { width });
        const win = np.locator(`[data-testid=cf-window][data-window=${w.window || w.id}]`);
        const native = (await win.count()) > 0 && (await np.locator("[data-testid=cf-legacy]").count()) === 0;
        check(`${tag}: opens in agent-native (its own window, no legacy frame)`, native);
        let L, N, diffs = ["not read"];
        for (let round = 0; round < 4 && diffs.length; round++) {
          if (round) await np.waitForTimeout(3000);
          [L, N] = await Promise.all([w.readLegacy(lp, { width }), w.readNative(np, { width })]);
          diffs = w.compare(L, N);
        }
        check(`${tag}: the same readings as the legacy window`, !diffs.length, diffs.slice(0, 6).join("; "));
        check(`${tag}: no sideways scroll`, (await np.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
        await lp.screenshot({ path: path.join(dir, `${w.shot || w.id}-${width}-legacy.png`) });
        await np.screenshot({ path: path.join(dir, `${w.shot || w.id}-${width}-agent-native.png`) });
        if (writes && !phone && w.writes) {
          // a write proves itself (its own checks); a refusal it provokes on purpose is not a page error
          const n0 = errs.length;
          await w.writes(np, check, { width });
          errs.splice(n0);
        }
      } catch (e) {
        check(`${tag}: the window run completed`, false, String(e && e.message).slice(0, 300));
      }
      await closeAll(lp, np);
    }
    check(`windows at ${width}: no console errors or failed requests`, errs.length === 0, errs.slice(0, 4).join(" | "));
    await ctx.close();
  }
}

async function closeAll(lp, np) {
  await np.keyboard.press("Escape").catch(() => {});
  await np.waitForTimeout(300);
  if (await np.locator("[data-testid=cf-window]").count()) await np.keyboard.press("Escape").catch(() => {});
  await lp.evaluate(() => {
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    if (location.hash) history.replaceState(null, "", location.pathname);
  }).catch(() => {});
  await np.waitForTimeout(300);
}
