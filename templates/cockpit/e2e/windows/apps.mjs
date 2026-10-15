// FA-19129: the Apps picker. The legacy appsDlg (index.html, the APPS SCREEN script) against the agent-native apps window (AppsPart):
// tile by tile, the name, the description, the staging preview's state in words, the staging line, the open-card chips and the
// release line. Writes: apps.request is proven by its refusal path only (an app id that does not exist: the cockpit's own
// "Pick an app."); Open studio is proven to open the legacy studio frame at #apps=<id> with that frame's load blocked, so the
// studio never opens and cuts nothing.
import { diffRecords, norm } from "./harness.mjs";

const pv = (st, t, s) => (st === "live" ? "live" : st + ": " + norm(t) + (norm(s) ? " " + norm(s) : ""));

export default {
  id: "apps",
  label: "Apps",
  async openLegacy(lp) {
    await lp.evaluate(() => document.getElementById("appsBtn").click());
    await lp.waitForFunction(() => {
      const d = document.getElementById("appsDlg"), tiles = [...document.querySelectorAll("#appsGrid .atile")];
      return d && d.open && tiles.length && tiles.every((t) => t.querySelector(".apv").dataset.st && t.querySelector(".apv").dataset.st !== "wait" && t.querySelector(".ast").getAttribute("aria-busy") !== "true");
    }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const T = [...document.querySelectorAll("#appsGrid .atile")];
      const tx = (n) => (n ? n.textContent : "");
      return {
        mode: tx(document.getElementById("appsMode")),
        names: T.map((t) => tx(t.querySelector(".atb b"))),
        descs: T.map((t) => tx(t.querySelector(".atb .ad"))),
        previews: T.map((t) => { const b = t.querySelector(".apv"), o = b.querySelector(".apo"); return [b.dataset.st, tx(o && o.querySelector("b")), tx(o && o.querySelector("span"))]; }),
        staging: T.map((t) => tx(t.querySelector(".ast > span:not(.dot)"))),
        chips: T.map((t) => [...t.querySelectorAll(".arow .chip")].map((c) => c.textContent).join(", ")),
        last: T.map((t) => tx(t.querySelector(":scope > .sub"))),
        pilot: T.map((t) => tx(t.querySelector(".apch"))),
      };
    }).then((r) => ({ ...r, previews: r.previews.map(([st, t, s]) => pv(st, t, s)) })),
  async openNative(np) {
    const b = np.locator('button[aria-label="Apps (open the apps picker)"]');
    // the phone keeps the header buttons behind the More menu
    if (!(await b.isVisible())) await np.click(".cf-menu");
    await b.click();
    await np.waitForSelector("[data-window=apps] .ap-tile", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=apps]");
      const T = [...w.querySelectorAll(".ap-tile")];
      const tx = (n) => (n ? n.textContent : "");
      const chip = w.querySelector(".cp-dlg-sub .cp-chip");
      return {
        mode: tx(chip),
        names: T.map((t) => tx(t.querySelector(".ap-n"))),
        descs: T.map((t) => tx(t.querySelector(".ap-d"))),
        previews: T.map((t) => { const b = t.querySelector(".ap-pv"); return [b.dataset.st, tx(b.querySelector(".ap-pv-t")), tx(b.querySelector(".ap-pv-s"))]; }),
        staging: T.map((t) => tx(t.querySelector(".ap-st"))),
        chips: T.map((t) => [...t.querySelectorAll(".ap-chips .ap-chip")].map((c) => c.textContent).join(", ")),
        last: T.map((t) => tx(t.querySelector(".ap-last"))),
      };
    }).then((r) => ({ ...r, previews: r.previews.map(([st, t, s]) => pv(st, t, s)) })),
  // the studio autopilot / checklist chip is not on the client (reported); every other reading must match
  compare: (L, N) => diffRecords(L, N, ["mode", "names", "descs", "previews", "staging", "chips", "last"]),
  async writes(np, check) {
    // 1. apps.request through the client, refused by the cockpit for an app that does not exist: nothing is filed
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-app-request", location.origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app: "no-such-app-fa19129", kind: "feature", title: "Parity probe", what: "A refusal probe from the parity run; never filed." }),
      });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    });
    check("Apps: a request for an app that does not exist round-trips to the cockpit's refusal (refusal path: Pick an app.)", r.status === 400 && /Pick an app/.test(r.body), JSON.stringify(r));
    // 2. the Request form opens on a tile, with the request kinds and the cockpit's hint (not submitted)
    const tile = np.locator("[data-window=apps] .ap-tile").first();
    await tile.getByRole("button", { name: "Request work" }).click();
    const form = tile.locator("form.ap-form");
    check("Apps: Request work opens the request form (Feature / Fix / Polish, title, what, done, where)", (await form.count()) === 1 && (await form.locator(".cp-seg button").allTextContents()).join(",") === "Feature,Fix,Polish" && (await form.locator("input, textarea").count()) === 4);
    await tile.getByRole("button", { name: "Cancel" }).click();
    // 3. Open studio opens the legacy studio at #apps=<id> in the LegacyWindow (its load blocked: the studio never opens)
    const id = await tile.getAttribute("data-app");
    await np.route("**/legacy/**", (rt) => rt.abort());
    await tile.getByRole("button", { name: "Open studio" }).click();
    const frame = np.locator("[data-testid=cf-legacy] iframe");
    await frame.waitFor({ timeout: 5000 }).catch(() => {});
    const src = (await frame.count()) ? await frame.getAttribute("src") : "";
    check("Apps: Open studio opens the legacy studio at #apps=<id> (the window closes first)", src.endsWith("#apps=" + id) && (await np.locator("[data-testid=cf-window]").count()) === 0, src);
    await np.locator("[data-testid=cf-legacy] .cf-legacy-bar button").click().catch(() => {});
    await np.unroute("**/legacy/**");
  },
};
