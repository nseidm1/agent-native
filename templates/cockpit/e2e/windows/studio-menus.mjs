// FA-19087 (FA-19173): the native studio's action menus against the legacy studio's (card-studio.js appMenus, studio-lifecycle.js
// menu / improveItems / the Optimizer and KPI dialogs, studio-pilot.js, studio-env.js). Readings, on both pages: every menu (opened
// by its own button [data-k=menu-<k>], in turn): its label and badge, and each item's label, why line, disabled state and badge (the
// headings and separators in place); at 1280 the five menus (Build, Design, Improve, Verify, Launch), at 390 the one Actions menu.
// Then the first Optimizer (Improve -> its first lens) and the KPIs dialog: their title and headline readings (the baseline or the
// never-run line, the proposals, the history, what qa measured; where the KPI model came from, its KPI names, the save label).
// The Design and Verify menus' first items are DesignTools.tsx's (studio-design.mjs proves them): while one is still a stub (no why
// line natively), only its label is compared. Variants is the live frame's: compared in full only once the native studio has its
// live frame (studio-frame.mjs proves it). Writes (1280, REFUSAL PATHS ONLY - every studio write of the page is rewritten to the app
// no-such-app-fa19087 for the whole run): an Optimizer run answers the cockpit's refusal in the dialog; Make Production Ready's and
// Rollback's confirms open, say what they would do, and are dismissed with nothing sent; Promote never sends without its confirm;
// env promote through the action answers its 404; the menus' keyboard (focus, arrows, Esc closes the menu alone).
import { diffRecords, norm } from "./harness.mjs";
import studio from "./studio.mjs";

const APP = process.env.STUDIO_APP || "family-office";
const DESIGN_OWNED = new Set(["New Design", "Enhance Existing Design", "Review Existing Designs", "QA agents", "API mocks", "Requirements"]);

// one page's readings; sel: where its studio, menus, items and dialogs are
async function read(page, side, width) {
  return page.evaluate(
    async ({ side, width }) => {
      const L = side === "legacy";
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const root = () => (L ? [...document.querySelectorAll("dialog[open]")].find((x) => x.querySelector(".lc-tiles")) : document.querySelector("[data-testid=studio]"));
      const until = async (f, ms = 20000) => {
        const t = Date.now();
        for (;;) {
          const v = f();
          if (v) return v;
          if (Date.now() - t > ms) return null;
          await sleep(150);
        }
      };
      const tx = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : "");
      const own = (n) => (n ? [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").replace(/\s+/g, " ").trim() : "");
      const btnOf = (k) => root().querySelector(`[data-k="menu-${k}"]`);
      const popOf = (b) => document.getElementById(b.getAttribute("aria-controls"));
      const openMenu = async (k) => {
        const b = btnOf(k);
        if (b.getAttribute("aria-expanded") !== "true") b.click();
        await until(() => b.getAttribute("aria-expanded") === "true" && popOf(b) && !popOf(b).hidden && popOf(b).children.length, 3000);
        return b;
      };
      const closeMenu = async (k) => {
        const b = btnOf(k);
        if (b && b.getAttribute("aria-expanded") === "true") b.click();
        await sleep(120);
      };
      const ITEM = L ? ".lc-item" : ".sm-item",
        SEP = L ? "lc-sep" : "sm-sep",
        HEAD = L ? "lc-mh" : "sm-mh",
        CHIP = L ? ".cs-chip" : ".ap-chip";
      const keys = [...root().querySelectorAll("[data-k^=menu-]")].map((b) => b.dataset.k.slice(5));
      // the dialogs first (Improve -> the first lens; Improve -> KPIs), then the menus, the last one left open for the screenshot
      const host = width < 760 ? "all" : "improve";
      const out = { menus: keys.join(" | ") };
      const lensK = await (async () => {
        await openMenu(host);
        const it = popOf(btnOf(host)).querySelector(`${ITEM}[data-k^="mi-lens-"]`);
        const k = it ? it.dataset.k : null;
        if (it) it.click();
        return k;
      })();
      if (lensK) {
        const dlg = await until(() => (L ? document.querySelector("dialog[open][data-k=lens-dialog]") : document.querySelector("[data-testid=lens-dialog]")));
        const ready = dlg && (await until(() => dlg.querySelector("[data-k=lens-measure]"), 30000));
        out.lens = ready
          ? [
              "title: " + tx(L ? dlg.querySelector("h3") : dlg.querySelector(".cp-dlg-title")),
              "baseline: " + (tx(dlg.querySelector("[data-k=lens-scorecard] h4")) || tx(dlg.querySelector("[data-k=lens-empty]"))),
              "proposals: " + tx(dlg.querySelector("[data-k=lens-proposals] h4")),
              "history: " + tx(dlg.querySelector("[data-k=lens-history] h4")),
              "measured: " + tx(dlg.querySelector("[data-k=lens-measure] p")),
              "run: " + tx(dlg.querySelector("[data-k=lens-run]")),
            ]
          : ["the Optimizer did not load"];
        if (L) dlg && dlg.close();
        else dlg && dlg.querySelector('button[aria-label="Close"]').click();
        await sleep(300);
      }
      await openMenu(host);
      const kp = popOf(btnOf(host)).querySelector(`${ITEM}[data-k="mi-kpis"]`);
      if (kp) {
        kp.click();
        const dlg = await until(() => (L ? document.querySelector("dialog[open][data-k=kpi-dialog]") : document.querySelector("[data-testid=kpi-dialog]")));
        const ready = dlg && (await until(() => dlg.querySelector("[data-k=kpi-table]"), 20000));
        out.kpis = ready
          ? [
              "title: " + tx(L ? dlg.querySelector("h3") : dlg.querySelector(".cp-dlg-title")),
              "from: " + tx(L ? dlg.querySelector(".lc-db > p.cs-hint") : dlg.querySelector("[data-k=kpi-from]")),
              "kpis: " + [...dlg.querySelectorAll("[data-k=kpi-table] tbody tr")].map((r) => (r.querySelector("input") || {}).value || "").join(", "),
              "now: " + dlg.querySelectorAll("[data-k=lc-kpi-cards] > *").length,
              "save: " + tx(dlg.querySelector("[data-k=kpi-save]")),
            ]
          : ["the KPIs did not load"];
        if (L) dlg && dlg.close();
        else dlg && dlg.querySelector('button[aria-label="Close"]').click();
        await sleep(300);
      }
      out.native_frame = !L && Boolean(root().querySelector("iframe"));
      for (const k of keys) {
        const b = await openMenu(k);
        const chip = b.querySelector(CHIP);
        out["menu-" + k] = own(b) + (chip ? " [" + tx(chip) + "]" : "") + (b.title ? " (" + b.title + ")" : "");
        out["items-" + k] = [...popOf(b).children].map((x) => {
          if (x.classList.contains(SEP)) return { sep: true };
          if (x.classList.contains(HEAD)) return { head: tx(x) };
          const l = x.querySelector(".l"),
            c = l && l.querySelector(CHIP);
          return { label: own(l), why: tx(x.querySelector(".w")), off: x.getAttribute("aria-disabled") === "true", badge: tx(c) };
        });
        await closeMenu(k);
      }
      await openMenu(keys[keys.length - 1]);
      return out;
    },
    { side, width },
  );
}

const itemLine = (x) => (x.sep ? "---" : x.head ? "# " + x.head : [x.label, x.why, x.off ? "disabled" : "", x.badge].join(" / "));

export default {
  id: "studio-menus",
  window: "apps",
  shot: "studio-menus",
  label: "App studio: menus",
  openLegacy: studio.openLegacy,
  readLegacy: (lp, o = {}) => read(lp, "legacy", o.width || 1280),
  openNative: studio.openNative,
  readNative: (np, o = {}) => read(np, "native", o.width || 1280),
  compare(L, N) {
    const out = diffRecords(L, N, ["menus", "lens", "kpis"]);
    const keys = String(L.menus || "").split(" | ").filter(Boolean);
    for (const k of keys) {
      out.push(...diffRecords(L, N, ["menu-" + k]));
      // Add a <other> theme is the live frame's proposal (its theme state): before the native live frame, it is not compared
      const a = (L["items-" + k] || []).filter((x) => N.native_frame || !/^Add a (dark|light) theme$/.test(x.label || "")),
        b = N["items-" + k] || [];
      if (a.length !== b.length) out.push(`menu ${k}: ${a.length} legacy items vs ${b.length} agent-native: ${a.map(itemLine).join(" | ").slice(0, 300)} vs ${b.map(itemLine).join(" | ").slice(0, 300)}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const x = a[i],
          y = b[i];
        // a DesignTools item still stubbed (no why natively), or Variants before the native live frame: its label alone
        const labelOnly = (DESIGN_OWNED.has(y.label) && !y.why) || (y.label === "Variants" && !N.native_frame);
        const f = (z) => norm(labelOnly ? (z.sep ? "---" : z.head ? "# " + z.head : z.label) : itemLine(z)).toLowerCase();
        if (f(x) !== f(y)) out.push(`menu ${k}, item ${i + 1}: legacy "${itemLine(x)}" vs agent-native "${itemLine(y)}"`);
      }
    }
    return out;
  },
  async writes(np, check) {
    const st = np.locator(`[data-testid=studio][data-app="${APP}"]`);
    // SAFETY: for the whole run every studio write this page makes goes to an app that does not exist (refused before acting)
    const sent = [];
    const isPost = (u) => /\/_agent-native\/actions\/cockpit-studio-post(\?|$)/.test(new URL(String(u)).pathname);
    const rewrite = (r) => {
      let b = {};
      try {
        b = JSON.parse(r.request().postData() || "{}");
      } catch {
        /* not json */
      }
      sent.push(b.root + "/" + b.path);
      return r.continue({ postData: JSON.stringify({ ...b, app: "no-such-app-fa19087" }) });
    };
    await np.route(isPost, rewrite);
    const close = async () => {
      await np.waitForTimeout(200); // a dialog registers its own Esc a frame after it shows
      await np.keyboard.press("Escape");
      await np.waitForTimeout(400);
    };
    const menu = async (k, item) => {
      await st.locator(`[data-k="menu-${k}"]`).click();
      await st.locator(`[data-k="mi-${item}"]`).click();
    };
    try {
      // 0. the rewrite is live before anything that writes is pressed: an empty chat message (refused by its body on any app) passes through it
      await np.evaluate(() =>
        fetch(new URL("/cards/_agent-native/actions/cockpit-studio-post", location.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ app: "family-office", root: "app", path: "chat/send", body: { text: "" } }),
        }).then((r) => r.status),
      );
      const armed = sent.includes("app/chat/send");
      check("Studio menus: every studio write of this run is rewritten to the refusing app (proven before any press)", armed, sent.join(", "));
      if (!armed) return;
      sent.length = 0;
      // the readings left a menu open for the screenshot: close it first
      const openB = st.locator('[data-k^="menu-"][aria-expanded="true"]');
      if (await openB.count()) await openB.first().click();
      await np.waitForTimeout(200);
      // 1. the menus' keyboard: the first enabled item takes focus, ArrowDown moves it, Esc closes the menu alone and returns focus
      await st.locator('[data-k="menu-launch"]').click();
      await np.waitForFunction(() => document.activeElement && /^mi-/.test(document.activeElement.dataset.k || ""), null, { timeout: 3000 }).catch(() => {});
      const f1 = await np.evaluate(() => document.activeElement && document.activeElement.dataset.k);
      await np.keyboard.press("ArrowDown");
      const f2 = await np.evaluate(() => document.activeElement && document.activeElement.dataset.k);
      await np.keyboard.press("Escape");
      await np.waitForTimeout(250);
      const f3 = await np.evaluate(() => document.activeElement && document.activeElement.dataset.k);
      check(
        "Studio menus: keyboard (focus on the first item, ArrowDown, Esc closes the menu alone and refocuses its button)",
        f1 === "mi-production-ready" && f2 === "mi-promote" && f3 === "menu-launch" && (await st.count()) === 1 && (await st.locator('[data-k="menu-launch"]').getAttribute("aria-expanded")) === "false",
        [f1, f2, f3].join(" "),
      );
      // 2. an Optimizer run, refused by the cockpit for an app that does not exist: its refusal shows in the dialog
      await menu("improve", "lens-feature");
      const lens = np.locator("[data-testid=lens-dialog]");
      await lens.locator("[data-k=lens-run]").waitFor({ timeout: 30_000 });
      const n0 = sent.length;
      await lens.locator("[data-k=lens-run]").click();
      const refused = await lens
        .locator(".sm-err", { hasText: /no such app|not found|404/i })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      check("Studio menus: an Optimizer run round-trips to the cockpit's refusal (no such app), shown in its dialog", refused && sent.slice(n0).includes("app/lens/feature/run"), sent.slice(n0).join(", "));
      await close();
      check("Studio menus: Esc closes the Optimizer alone (the studio stays)", (await lens.count()) === 0 && (await st.count()) === 1);
      // 3. Make Production Ready: its confirm (the plan's quote and cards) opens, Not now dismisses it, nothing is sent
      let n1 = sent.length;
      await menu("launch", "production-ready");
      const rc = np.locator("[data-testid=env-ready-confirm]");
      const rOpen = await rc
        .waitFor({ timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (rOpen) {
        await rc.locator("[data-k=env-ready-quote]").waitFor({ timeout: 20_000 }).catch(() => {});
        const q = norm(await rc.locator("[data-k=env-ready-quote]").textContent().catch(() => ""));
        await rc.locator("[data-k=env-ready-notnow]").click();
        await np.waitForTimeout(300);
        check("Studio menus: Make Production Ready opens its confirm (the quote), Not now closes it, nothing sent", /→ \d+ cards?/.test(q) && (await rc.count()) === 0 && sent.length === n1, q + " | sent " + sent.slice(n1).join(","));
      } else {
        // off (the legacy reason in its why): the Launch tile opens instead, nothing sent
        const exp = await st.locator('.st-tile[data-k="launch"]').getAttribute("aria-expanded");
        check("Studio menus: Make Production Ready (off) opens the Launch tile, nothing sent", exp === "true" && sent.length === n1);
      }
      // 4. Rollback: its confirm says what it does, Not now dismisses it, nothing is sent
      n1 = sent.length;
      const rbOff = (await st.locator('[data-k="menu-launch"]').click().then(() => st.locator('[data-k="mi-rollback"]').getAttribute("aria-disabled"))) === "true";
      if (!rbOff) {
        await st.locator('[data-k="mi-rollback"]').click();
        const bc = np.locator("[data-testid=env-rollback-confirm]");
        await bc.waitFor({ timeout: 10_000 });
        const q = norm(await bc.locator("[data-k=env-rollback-q]").textContent());
        await bc.locator("[data-k=env-rollback-notnow]").click();
        await np.waitForTimeout(300);
        check("Studio menus: Rollback asks first (the previous build, the phone's fingerprint), Not now sends nothing", /previous production build of .+ back/.test(q) && (await bc.count()) === 0 && sent.length === n1, q);
      } else {
        await np.keyboard.press("Escape");
        check("Studio menus: Rollback is off with its reason (no earlier production build)", true);
      }
      // 5. Promote: never sent without its confirm. On (promotable): the confirm opens and is cancelled; off: the Deploy tile opens
      n1 = sent.length;
      await menu("launch", "promote");
      await np.waitForTimeout(600);
      const pc = np.locator("[data-testid=env-promote-confirm]");
      if (await pc.count()) {
        await pc.locator("[data-k=env-promote-notnow]").click();
        await np.waitForTimeout(300);
        check("Studio menus: Promote opens its confirm and Not now sends nothing", (await pc.count()) === 0 && sent.length === n1);
      } else {
        check(
          "Studio menus: Promote (not production ready) opens the Deploy tile and sends nothing",
          (await st.locator('.st-tile[data-k="deploy"]').getAttribute("aria-expanded")) === "true" && sent.length === n1,
        );
      }
      // 6. env promote through the action: the cockpit answers its 404 for an app that does not exist
      const r = await np.evaluate(async () => {
        const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-studio-post", location.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ app: "no-such-app-fa19087", root: "env", path: "promote", body: {} }),
        });
        return { status: res.status, body: (await res.text()).slice(0, 240) };
      });
      check("Studio menus: env promote round-trips to the cockpit's 404 for an app that does not exist", r.status >= 400 && r.status < 500 && /no such app/i.test(r.body), JSON.stringify(r));
      // 7. the dialogs other tools open: the requirements (Verify) and the checkpoints (Build)
      await menu("verify", "requirements");
      const cl = np.locator("[data-testid=pilot-checklist-dialog]");
      const clOk = await cl
        .locator("[data-k=pilot-cl-dialog]")
        .waitFor({ timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      check("Studio menus: Requirements opens the checklist (its groups, Write the checks, Verify staging now)", clOk && (await cl.locator("[data-k=pilot-verify]").count()) === 1, norm(await cl.locator(".cp-dlg-title").textContent().catch(() => "")));
      await close();
      await menu("build", "checkpoints");
      const cp = np.locator("[data-testid=pilot-cp-dialog]");
      const cpOk = await cp
        .locator("[data-k=pilot-cp-body], .sm-empty")
        .first()
        .waitFor({ timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      check("Studio menus: Checkpoints opens its dialog (save, experiment, the list)", cpOk);
      await close();
      check("Studio menus: every write this run made was rewritten to the refusing app (none reached " + APP + ")", sent.every((p) => p === "app/lens/feature/run" || p === "env/promote"), sent.join(", "));
    } finally {
      await np.unroute(isPost, rewrite);
    }
  },
};
