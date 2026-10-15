// FA-19129: the Apps picker. The legacy appsDlg (index.html, the APPS SCREEN script) against the agent-native apps window (AppsPart):
// tile by tile, the name, the description, the staging preview's state in words, the staging line, the open-card chips and the
// release line; FA-19157: the autopilot / definition-of-done chip and the staging picture (the same picture: app and sha). Writes: apps.request
// is proven by its refusal path only (an app id that does not exist: the cockpit's own "Pick an app."); Open studio opens the app's studio
// natively (the Apps window on { app }), never a legacy frame.
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
        pics: T.map((t) => { const i = t.querySelector(".apv img"); const m = i && /([a-z0-9-]+\/[0-9a-f]{12}\.jpg)$/.exec(i.dataset.src || i.src || ""); return m ? m[1] : "none"; }),
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
        pilot: T.map((t) => tx(t.querySelector(".ap-pilot"))),
        pics: T.map((t) => { const i = t.querySelector(".ap-pv img"); const m = i && /([a-z0-9-]+\/[0-9a-f]{12}\.jpg)$/.exec(i.getAttribute("src") || ""); return m ? m[1] : "none"; }),
        picsLoaded: T.map((t) => { const i = t.querySelector(".ap-pv img"); return !i || (i.complete && i.naturalWidth > 0); }).every(Boolean),
      };
    }).then((r) => ({ ...r, previews: r.previews.map(([st, t, s]) => pv(st, t, s)) })),
  // FA-19157: the autopilot / checklist chip and the staging picture are on the client now; every reading must match, and a shown picture loaded
  compare: (L, N) => [...diffRecords(L, N, ["mode", "names", "descs", "previews", "staging", "chips", "last", "pilot", "pics"]), ...(N.picsLoaded ? [] : ["a staging picture did not load in agent-native"])],
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
    // 3. FA-19157: Open studio opens the app's studio natively, in this window (no legacy frame), and All apps comes back to the picker
    const id = await tile.getAttribute("data-app");
    await tile.getByRole("button", { name: "Open studio" }).click();
    const st = np.locator(`[data-window=apps] [data-testid=studio][data-app="${id}"]`);
    await st.waitFor({ timeout: 20_000 }).catch(() => {});
    check("Apps: Open studio opens the app's studio natively (no legacy frame)", (await st.count()) === 1 && (await np.locator("[data-testid=cf-legacy]").count()) === 0 && (await st.locator(".st-tile").count()) === 5);
    await st.getByRole("button", { name: "← All apps" }).click();
    await np.waitForSelector("[data-window=apps] .ap-tile", { timeout: 20_000 }).catch(() => {});
    check("Apps: All apps returns from the studio to the picker", (await np.locator("[data-window=apps] .ap-tile").count()) > 0 && (await np.locator("[data-testid=studio]").count()) === 0);
  },
};
