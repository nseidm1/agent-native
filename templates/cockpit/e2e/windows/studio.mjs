// FA-19157: an app's studio. The legacy studio (card-studio.js openApp at #apps=<id>, its face from studio-lifecycle.js) against the
// agent-native studio (the Apps window on { app }, StudioView.tsx): the app's name, the identity line (staging and production, each
// with its age), the inbox badge and the five lifecycle tiles (label, value, line, which one needs you). The native studio is opened
// from its tile's Open studio (and, in writes, from #apps=<id> straight into the native studio, never a legacy frame). Its tools
// (the Agent chat, the menus, the live frame, the drawers) are proven by studio-chat.mjs, studio-menus.mjs, studio-design.mjs,
// studio-frame.mjs and studio-drawers.mjs. Its one write,
// Start staging (apps.staging), is proven by its refusal path only: an app id that does not exist, so nothing starts.
import { diffRecords, norm } from "./harness.mjs";

const APP = process.env.STUDIO_APP || "family-office";
const strip = (s) => norm(String(s || "").replace(/✉/g, ""));

export default {
  id: "studio",
  window: "apps",
  shot: "studio",
  label: "App studio",
  // the legacy page routes #apps=<id> once, at load (not on hashchange): load it with the hash
  async openLegacy(lp) {
    await lp.evaluate((app) => history.replaceState(null, "", location.pathname + "#apps=" + app), APP);
    await lp.reload({ waitUntil: "domcontentloaded" });
    await lp.waitForFunction(() => document.querySelectorAll("dialog[open] .lc-tiles .lc-tile").length === 5 && !!document.querySelector("dialog[open] .lc-id"), null, { timeout: 60_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const d = [...document.querySelectorAll("dialog[open]")].find((x) => x.querySelector(".lc-tiles"));
      const tx = (n) => (n ? n.textContent : "");
      const T = [...d.querySelectorAll(".lc-tiles .lc-tile")];
      return {
        identity: [...d.querySelectorAll(".lc-id > span")].map(tx),
        inbox: tx(d.querySelector("[data-k=inbox]")),
        tiles: T.map((t) => [tx(t.querySelector(".k")), tx(t.querySelector(".v")), tx(t.querySelector(".s"))].map((x) => x.replace(/\s+/g, " ").trim()).join(" / ")),
        need: T.filter((t) => t.classList.contains("need")).map((t) => (t.dataset.k || "").replace(/^tile-/, "")),
      };
    }).then((r) => ({ ...r, inbox: strip(r.inbox) })),
  async openNative(np) {
    const b = np.locator('button[aria-label="Apps (open the apps picker)"]');
    if (!(await b.isVisible())) await np.click(".cf-menu");
    await b.click();
    const tile = np.locator(`[data-window=apps] .ap-tile[data-app="${APP}"]`);
    await tile.waitFor({ timeout: 20_000 });
    await tile.getByRole("button", { name: "Open studio" }).click();
    await np.waitForFunction((app) => document.querySelectorAll(`[data-testid=studio][data-app="${app}"] .st-tile`).length === 5, APP, { timeout: 30_000 });
  },
  readNative: (np) =>
    np.evaluate((app) => {
      const s = document.querySelector(`[data-testid=studio][data-app="${app}"]`);
      const tx = (n) => (n ? n.textContent : "");
      const T = [...s.querySelectorAll(".st-tile")];
      return {
        title: tx(document.querySelector("[data-window=apps] .cp-dlg-title")),
        identity: [...s.querySelectorAll("[data-testid=studio-identity] > span")].map(tx),
        inbox: tx(s.querySelector("[data-testid=studio-inbox]")),
        tiles: T.map((t) => [tx(t.querySelector(".k")), tx(t.querySelector(".v")), tx(t.querySelector(".s"))].map((x) => x.replace(/\s+/g, " ").trim()).join(" / ")),
        need: T.filter((t) => t.classList.contains("need")).map((t) => t.dataset.k || ""),
      };
    }, APP).then((r) => ({ ...r, inbox: strip(r.inbox) })),
  compare: (L, N) => [...diffRecords(L, N, ["identity", "inbox", "tiles", "need"]), ...(/studio|reading/i.test(N.title) || !N.title ? ["the studio window is not titled with the app's name: " + N.title] : [])],
  async writes(np, check) {
    // 1. a tile opens its detail (Build: the definition of done)
    const st = np.locator(`[data-testid=studio][data-app="${APP}"]`);
    await st.locator('.st-tile[data-k="build"]').click();
    check("Studio: the Build tile opens its detail (the requirements)", (await st.locator("#st-detail").count()) === 1 && (await st.locator('.st-tile[data-k="build"]').getAttribute("aria-expanded")) === "true");
    // 2. Start staging through the client, refused by the cockpit for an app that does not exist: nothing starts
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-app-staging", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "no-such-app-fa19157" }) });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    });
    check("Studio: Start staging round-trips to the cockpit's refusal for an app that does not exist (nothing starts)", r.status >= 400 && r.status < 500 && /no such app|not|app/i.test(r.body), JSON.stringify(r));
    // 3. FA-19087: the studio's tools are native (FA-19172..FA-19175): nothing in the studio opens the legacy studio any more
    check("Studio: no control opens the legacy studio (the Agent, the menus, the live frame and the drawers are native)", (await st.getByRole("button", { name: "Agent, menus, live frame" }).count()) === 0 && (await np.locator("[data-testid=cf-legacy]").count()) === 0);
    // 4. #apps=<id> opens the studio natively, straight from the address (the legacy page's link form), with no legacy frame
    await np.waitForTimeout(400);
    await np.evaluate((app) => {
      location.hash = "#apps=" + app;
    }, APP);
    const ok = await np
      .waitForFunction((app) => document.querySelectorAll(`[data-testid=studio][data-app="${app}"] .st-tile`).length === 5, APP, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check("Studio: #apps=<id> opens the studio natively (no LegacyWindow)", ok && (await np.locator("[data-testid=cf-legacy]").count()) === 0);
    await np.evaluate(() => history.replaceState(null, "", location.pathname + location.search));
  },
};
