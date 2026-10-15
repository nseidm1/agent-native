/**
 * FA-19135: the forge alert toasts and the "cockpit updated" bar, side by side with the legacy page.
 * Both pages load together; every toast either shows in its first 9 seconds is collected (a toast goes by itself after
 * 5-8 s) and the two sets must match word for word. The bar: absent while the build is the one the page loaded;
 * shown (with its reload button) once get-build answers another build (the answer is replaced in the browser).
 */
import path from "node:path";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export async function alertsPass({ browser, base, legacyUrl, outDir, check, proxyRoutes }) {
  for (const width of [1280, 390]) {
    const phone = width < 600;
    const ctx = await browser.newContext(phone ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width, height: 900 } });
    if (proxyRoutes) await proxyRoutes(ctx);
    const lp = await ctx.newPage(), np = await ctx.newPage();
    const errs = [];
    np.on("pageerror", (e) => errs.push(String(e)));
    np.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    await Promise.all([lp.goto(legacyUrl, { waitUntil: "domcontentloaded" }), np.goto(base + "/cards/cockpit", { waitUntil: "domcontentloaded" })]);
    const L = new Set(), N = new Set();
    let shot = false;
    for (let i = 0; i < 9; i++) {
      await np.waitForTimeout(1000);
      const [l, n] = await Promise.all([
        lp.evaluate(() => [...document.querySelectorAll(".toasts .toast")].map((t) => (t.querySelector(".pt") || t).textContent)).catch(() => []),
        np.evaluate(() => [...document.querySelectorAll("[data-alert] .cf-alert-t")].map((t) => t.textContent)),
      ]);
      l.forEach((x) => L.add(norm(x)));
      n.forEach((x) => N.add(norm(x)));
      if (!shot && n.length) {
        shot = true;
        await np.screenshot({ path: path.join(outDir, `alerts-${width}-agent-native.png`) });
        await lp.screenshot({ path: path.join(outDir, `alerts-${width}-legacy.png`) });
      }
    }
    // on a phone both show one at a time: compare what each showed, allowing the queue to differ in length
    const only = (a, b) => [...a].filter((x) => !b.has(x));
    const ln = only(L, N), nl = only(N, L);
    const ok = phone ? nl.length === 0 && (L.size === 0) === (N.size === 0) : ln.length === 0 && nl.length === 0;
    check(`alert toasts at ${width}: the same toasts as the legacy page (${L.size} legacy, ${N.size} agent-native)`, ok, ["legacy only: " + ln.slice(0, 3).join(" | "), "agent-native only: " + nl.slice(0, 3).join(" | ")].join("; "));
    if (!shot) await np.screenshot({ path: path.join(outDir, `alerts-${width}-agent-native.png`) });
    // the update bar
    const before = await np.locator("[data-testid=cf-verbar]").count();
    // the page loads under one build; every later read answers another (a newer build serving)
    let n = 0;
    await np.route(/\/_agent-native\/actions\/get-build/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ build: n++ ? "b-newer-build" : "b-loaded-build" }) }));
    await np.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    const shown = await np.waitForSelector("[data-testid=cf-verbar]", { timeout: 40_000 }).then(() => true, () => false);
    check(`the cockpit-updated bar at ${width}: hidden on the loaded build (${before === 0}), shown with reload once another build serves`, before === 0 && shown && (await np.locator("[data-testid=cf-verbar] button").innerText()) === "reload");
    if (shown) await np.screenshot({ path: path.join(outDir, `verbar-${width}-agent-native.png`) });
    check(`alerts and update bar at ${width}: no page errors`, errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  }
}
