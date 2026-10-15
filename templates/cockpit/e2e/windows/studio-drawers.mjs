// FA-19087 (FA-19175): the native studio's drawers and tile details against the legacy studio's (card-studio.js renderQA /
// drawer, studio-lifecycle.js inboxTop / drawDetail). Both pages open the studio of the same app; the readings:
//   the INBOX: its section headings, the items under each (Needs you, Questions for you, Proposals, Suggested, Activity), the open
//     question cards or the calm card, the answered history, the Ask me Questions button;
//   DETAILS: the tab names with their counts, the header chips, the default tab's (Work) headline items: the staging changes (title
//     and state) and Its cards;
//   each lifecycle TILE's detail: Build (its hint), Quality (the text, the measured lines), Launch ready (% ready, n of m green,
//     every item with its mark), Deploy (the five stages and their states, the launch line), Live (its heading, the production
//     text, the KPI names or the no-model line).
// writes (1280, refusal paths ONLY, nothing reaches family-office): Note a question for later refused before any request (too
// short); then sent with the request rewritten to the app no-such-app-fa19087 and refused by the cockpit; Send message refused
// with no text; Fix all (it starts paid work) with every studio write rewritten to no-such-app-fa19087, each refused.
import { diffRecords } from "./harness.mjs";
import studio from "./studio.mjs";

const APP = process.env.STUDIO_APP || "family-office";
const NOAPP = "no-such-app-fa19087";
const TILES = ["build", "quality", "launch", "deploy", "live"];

/** Waits until a detail has finished reading (no "Reading …" spinner line left). */
async function settle(page, sel, ms = 15_000) {
  await page
    .waitForFunction(
      (s) => {
        const e = document.querySelector(s);
        return (
          e &&
          !/Reading (the|app)/.test(e.textContent || "") &&
          (e.textContent || "").trim().length > 10
        );
      },
      sel,
      { timeout: ms },
    )
    .catch(() => {});
}

/** A click on the legacy page by the DOM (its header is redrawn on every poll, so a located button can detach mid-click). */
const lclick = (lp, sel) =>
  lp.evaluate((s) => {
    const b = document.querySelector(s);
    if (b) b.click();
    return Boolean(b);
  }, sel);

async function readLegacy(lp) {
  const out = {};
  // the inbox (the questions column of the app studio; its button toggles the sheet)
  await lp.evaluate(() => {
    const d = [...document.querySelectorAll("dialog[open]")].find((x) =>
      x.querySelector(".lc-tiles"),
    );
    const b = d && d.querySelector("[data-k=q-back]");
    if (b && d.classList.contains("q-sheet")) b.click();
  });
  await lclick(lp, "dialog[open] [data-k=inbox]");
  await lp.waitForTimeout(800);
  Object.assign(
    out,
    await lp.evaluate(() => {
      const d = [...document.querySelectorAll("dialog[open]")].find((x) =>
        x.querySelector(".lc-tiles"),
      );
      const q = d.querySelector(".cs-qa");
      const tx = (n) => (n ? n.textContent : "");
      return {
        inboxHeadings: [...q.querySelectorAll("h4.cs-qah4")].map(tx),
        inboxItems: [...q.querySelectorAll("[data-k^=inbox-] li")].map(tx),
        inboxCards: [...q.querySelectorAll(".cs-qcard:not(.calm) .cs-qt")].map(
          tx,
        ),
        inboxCalm: tx(q.querySelector(".cs-qcard.calm")),
        inboxAnswered: tx(q.querySelector("[data-k=qa-answered] > summary")),
        inboxHistory: [...q.querySelectorAll("[data-k=qa-history] > li")].map(
          (li) => [...li.children].map(tx).join(" "),
        ),
        inboxAskMe: tx(q.querySelector("[data-k=qa-askme]")),
      };
    }),
  );
  await lclick(lp, "dialog[open] [data-k=q-back]");
  // the tiles' details
  for (const k of TILES) {
    await lclick(lp, `dialog[open] [data-k=tile-${k}]`);
    await settle(lp, "dialog[open] .lc-detail");
    await lp.waitForTimeout(300);
    out["tile_" + k] = await lp.evaluate((k) => {
      const d = [...document.querySelectorAll("dialog[open]")]
        .find((x) => x.querySelector(".lc-tiles"))
        .querySelector(".lc-detail");
      const tx = (n) => (n ? n.textContent : "");
      if (k === "build") return [tx(d.querySelector("p.cs-hint"))];
      if (k === "quality")
        return [
          tx(d.querySelector(".lc-row > span")),
          ...[...d.querySelectorAll("[data-k=lc-measure] li")].map(tx),
          tx(d.querySelector("p.cs-hint")),
        ].filter(Boolean);
      if (k === "launch") {
        const l = d.querySelector("[data-k=lc-launch]");
        return [
          tx(l.querySelector(".lc-row b")),
          tx(l.querySelector(".lc-row .cs-hint")),
          ...[...l.querySelectorAll("[data-k=lc-launch-items] li")].map(tx),
        ];
      }
      if (k === "deploy") {
        const l = d.querySelector("[data-k=lc-deploy]");
        return [
          ...[...l.querySelectorAll(".lc-stage")].map(
            (s) =>
              tx(s.querySelector("b")) + ": " + tx(s.querySelector(".cs-hint")),
          ),
          tx(l.querySelector("[data-k=lc-deploy-launch]")),
        ];
      }
      const l = d.querySelector("[data-k=lc-live]");
      return [
        tx(l.querySelector("h4")),
        tx(l.querySelector("[data-k=lc-kpis-edit]")),
        ...[...l.querySelectorAll(":scope > p.cs-hint")].map(tx),
        ...[...l.querySelectorAll(".lc-kpi > .cs-hint:first-child")].map(tx),
      ];
    }, k);
    await lclick(lp, `dialog[open] [data-k=tile-${k}]`);
  }
  // Details (left open, for the screenshot)
  if (
    (await lp.evaluate(() => {
      const b = document.querySelector("dialog[open] [data-k=details]");
      return b && b.getAttribute("aria-expanded");
    })) !== "true"
  )
    await lclick(lp, "dialog[open] [data-k=details]");
  await lp.waitForTimeout(800);
  await lclick(lp, "dialog[open] .cs-tab[data-t=work]");
  await lp.waitForTimeout(300);
  Object.assign(
    out,
    await lp.evaluate(() => {
      const d = [...document.querySelectorAll("dialog[open]")].find((x) =>
        x.querySelector(".lc-tiles"),
      );
      const tx = (n) => (n ? n.textContent : "");
      const w = d.querySelector("#cs-p-work");
      return {
        tabs: [...d.querySelectorAll(".cs-tab")].map((t) => {
          const n = t.querySelector(".n");
          return (
            tx(t.firstChild) +
            (n && !n.hidden && n.textContent ? " " + n.textContent : "")
          );
        }),
        dhead: [...d.querySelectorAll(".cs-dhead .cs-chip")].map(tx),
        workHeads: [...w.querySelectorAll("h3")].map(tx),
        workChanges: [...w.querySelectorAll(".cs-stg1")].map(
          (li) =>
            tx(li.querySelector(".t")) +
            " / " +
            tx(li.querySelector(".cs-chip")),
        ),
      };
    }),
  );
  return out;
}

/** Closes an open studio drawer (Esc closes the top layer only; with none open it would close the studio window). */
async function closeDrawers(np) {
  for (let i = 0; i < 3; i++) {
    if (
      !(await np
        .locator(
          "[data-testid=studio-details], [data-testid=studio-inbox-drawer]",
        )
        .count())
    )
      return;
    await np.keyboard.press("Escape");
    await np.waitForTimeout(300);
  }
}

async function readNative(np) {
  const S = `[data-testid=studio][data-app="${APP}"]`;
  const out = {};
  await closeDrawers(np);
  await np.click(S + " [data-testid=studio-inbox]");
  const ID = "[data-testid=studio-inbox-drawer]";
  await np.waitForSelector(ID + " .sd-qh4", { timeout: 20_000 });
  await np.waitForTimeout(500);
  Object.assign(
    out,
    await np.evaluate((ID) => {
      const q = document.querySelector(ID);
      const tx = (n) => (n ? n.textContent : "");
      return {
        inboxHeadings: [...q.querySelectorAll(".sd-qh4")]
          .filter((h) => !h.closest("[data-k=qpv]"))
          .map(tx),
        inboxItems: [...q.querySelectorAll("[data-k^=inbox-] li")].map(tx),
        inboxCards: [...q.querySelectorAll(".sd-qcard:not(.calm) .sd-qt")].map(
          tx,
        ),
        inboxCalm: tx(q.querySelector("[data-k=qa-calm]")),
        inboxAnswered: tx(q.querySelector("[data-k=qa-answered] > summary")),
        inboxHistory: [...q.querySelectorAll("[data-k=qa-history] > li")].map(
          (li) => [...li.children].map(tx).join(" "),
        ),
        inboxAskMe: tx(q.querySelector("[data-k=qa-askme]")),
      };
    }, ID),
  );
  await np.keyboard.press("Escape");
  await np.waitForTimeout(300);
  for (const k of TILES) {
    await np.click(`${S} .st-tile[data-k="${k}"]`);
    await settle(np, "#st-detail");
    await np.waitForTimeout(300);
    out["tile_" + k] = await np.evaluate((k) => {
      const d = document.querySelector("#st-detail");
      const tx = (n) => (n ? n.textContent : "");
      if (k === "build") return [tx(d.querySelector("[data-k=lc-build-hint]"))];
      if (k === "quality")
        return [
          tx(d.querySelector(".sd-row > span")),
          ...[...d.querySelectorAll("[data-k=lc-measure] li")].map(tx),
          tx(d.querySelector("p.sd-hint")),
        ].filter(Boolean);
      if (k === "launch") {
        const l = d.querySelector("[data-k=lc-launch]");
        return [
          tx(l.querySelector("[data-k=lc-launch-pct]")),
          tx(l.querySelector(".sd-row .sd-hint")),
          ...[...l.querySelectorAll("[data-k=lc-launch-items] li")].map(tx),
        ];
      }
      if (k === "deploy") {
        const l = d.querySelector("[data-k=lc-deploy]");
        return [
          ...[...l.querySelectorAll(".sd-stage")].map(
            (s) =>
              tx(s.querySelector("b")) + ": " + tx(s.querySelector(".sd-hint")),
          ),
          tx(l.querySelector("[data-k=lc-deploy-launch]")),
        ];
      }
      const l = d.querySelector("[data-k=lc-live]");
      return [
        tx(l.querySelector("h4")),
        tx(l.querySelector("[data-k=lc-kpis-edit]")),
        ...[...l.querySelectorAll(":scope > p.sd-hint")].map(tx),
        ...[...l.querySelectorAll(".sd-kpi > .sd-kn")].map(tx),
      ];
    }, k);
    await np.click(`${S} .st-tile[data-k="${k}"]`);
  }
  await np.click(S + " [data-k=details]");
  const DD = "[data-testid=studio-details]";
  await np.waitForSelector(DD + " [data-k=stg-history] h3", {
    timeout: 20_000,
  });
  await np.waitForTimeout(500);
  Object.assign(
    out,
    await np.evaluate((DD) => {
      const d = document.querySelector(DD);
      const tx = (n) => (n ? n.textContent : "");
      const w = d.querySelector("[data-k=pane-work]");
      return {
        tabs: [...d.querySelectorAll(".sd-tab")].map((t) => {
          const n = t.querySelector(".n");
          return (
            tx(t.firstChild) + (n && n.textContent ? " " + n.textContent : "")
          );
        }),
        dhead: [...d.querySelectorAll("[data-k=dhead] .ap-chip")].map(tx),
        workHeads: [...w.querySelectorAll("h3")].map(tx),
        workChanges: [...w.querySelectorAll(".sd-stg1")].map(
          (li) =>
            tx(li.querySelector(".t")) +
            " / " +
            tx(li.querySelector(".ap-chip")),
        ),
      };
    }, DD),
  );
  return out;
}

const KEYS = [
  "inboxHeadings",
  "inboxItems",
  "inboxCards",
  "inboxCalm",
  "inboxAnswered",
  "inboxHistory",
  "inboxAskMe",
  "tabs",
  "dhead",
  "workHeads",
  "workChanges",
  ...TILES.map((k) => "tile_" + k),
];

/** Every studio write in this block goes to NOAPP: the app id is rewritten, and anything else is aborted. */
async function rewriteWrites(np, sent) {
  const h = async (r) => {
    let b;
    try {
      b = JSON.parse(r.request().postData() || "{}");
    } catch {
      return r.abort();
    }
    sent.push({ root: b.root, path: b.path, app: b.app });
    if (!b || typeof b !== "object") return r.abort();
    return r.fallback({ postData: JSON.stringify({ ...b, app: NOAPP }) });
  };
  await np.route("**/_agent-native/actions/cockpit-studio-post**", h);
  return () => np.unroute("**/_agent-native/actions/cockpit-studio-post**", h);
}

export default {
  id: "studio-drawers",
  window: "apps",
  shot: "studio-drawers",
  label: "App studio: drawers",
  openLegacy: studio.openLegacy,
  readLegacy,
  openNative: studio.openNative,
  readNative,
  compare: (L, N) => diffRecords(L, N, KEYS),
  async writes(np, check) {
    const S = `[data-testid=studio][data-app="${APP}"]`;
    const sent = [],
      blocked = [];
    // a hard guard for the whole block (it runs after the rewrite): no studio write may leave unless it names NOAPP
    const guard = (r) => {
      let b = {};
      try {
        b = JSON.parse(r.request().postData() || "{}");
      } catch {
        /* aborted below */
      }
      if (b && b.app === NOAPP) return r.continue();
      blocked.push(String((b && b.path) || "?"));
      return r.abort();
    };
    await np.route("**/_agent-native/actions/cockpit-studio-post**", guard);
    const unroute = await rewriteWrites(np, sent);
    try {
      await closeDrawers(np);
      // 1. Note a question for later: too short is refused before any request
      await np.click(S + " [data-testid=studio-inbox]");
      const ID = "[data-testid=studio-inbox-drawer]";
      const add = np.locator(ID + " [data-k=q-add]");
      await add.waitFor({ timeout: 20_000 });
      await add.fill("abc");
      await add.press("Enter");
      await np.waitForTimeout(600);
      check(
        "Studio drawers: Note a question for later refuses a too-short question before any request",
        /Write the question first/.test(
          await np.locator(ID + " [data-k=q-add-err]").innerText(),
        ) && sent.length === 0,
      );
      // 2. sent, rewritten to an app that does not exist: the cockpit refuses it, and the refusal shows under the field
      await add.fill("FA-19087 e2e refusal probe: is this noted?");
      await add.press("Enter");
      await np
        .waitForFunction(
          (ID) => {
            const e = document.querySelector(ID + " [data-k=q-add-err]");
            return e && e.textContent.trim().length > 0;
          },
          ID,
          { timeout: 30_000 },
        )
        .catch(() => {});
      const t2 = await np.locator(ID + " [data-k=q-add-err]").innerText();
      check(
        "Studio drawers: Note a question for later round-trips to the cockpit's refusal for an app that does not exist",
        /no such app|not on the board/i.test(t2) &&
          sent.some((x) => x.path === "questions"),
        t2.slice(0, 160),
      );
      await np.keyboard.press("Escape");
      await np.waitForTimeout(300);
      // 3. Details > Agents: Send message with no text is refused before any request
      const n0 = sent.length;
      await np.click(S + " [data-k=details]");
      const DD = "[data-testid=studio-details]";
      await np.click(DD + " .sd-tab[data-t=agents]");
      await np.click(DD + " [data-k=send]");
      await np.waitForTimeout(500);
      check(
        "Studio drawers: Send message with no text is refused before any request",
        /Write a message first, or pick an action below/.test(
          await np.locator(DD + " [data-k=send-err]").innerText(),
        ) && sent.length === n0,
      );
      await np.keyboard.press("Escape");
      await np.waitForTimeout(300);
      // 4. Launch ready > Fix all (it starts paid work: Build it, the Optimizers that never ran): every write rewritten and refused
      const n1 = sent.length;
      await np.click(`${S} .st-tile[data-k="launch"]`);
      await settle(np, "#st-detail");
      const fix = np.locator("#st-detail [data-k=lc-fix-all]");
      await fix.waitFor({ timeout: 20_000 });
      await fix.click();
      await np
        .waitForFunction(
          () => {
            const e = document.querySelector("#st-detail [data-k=lc-fix-err]");
            return e && e.textContent.trim().length > 0;
          },
          null,
          { timeout: 60_000 },
        )
        .catch(() => {});
      const t4 = await np
        .locator("#st-detail [data-k=lc-fix-err]")
        .innerText()
        .catch(() => "");
      const fixSent = sent.slice(n1);
      check(
        "Studio drawers: Fix all round-trips each of its writes to the cockpit's refusal (rewritten to an app that does not exist)",
        fixSent.length > 0 && /no such app|not on the board/i.test(t4),
        t4.slice(0, 200) +
          " | sent: " +
          fixSent.map((x) => x.root + " " + x.path).join(", "),
      );
      // Fix all also opens the KPI dialog (the KPI model is red); close it (when the menus' tool draws one), and the detail
      if (await np.locator(".st-modal").count()) {
        await np.keyboard.press("Escape");
        await np.waitForTimeout(300);
      }
      if (
        await np
          .locator(`${S} .st-tile[data-k="launch"][aria-expanded=true]`)
          .count()
      )
        await np.click(`${S} .st-tile[data-k="launch"]`);
      check(
        "Studio drawers: no write in the block reached the real app (every studio write left as " +
          NOAPP +
          ")",
        blocked.length === 0 && sent.length > 0,
        blocked.join(", "),
      );
    } finally {
      await unroute();
      await np.unroute("**/_agent-native/actions/cockpit-studio-post**", guard);
    }
  },
};
