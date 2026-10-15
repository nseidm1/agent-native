// FA-19087 (FA-19173): the native studio's Design and Verify tools against the legacy studio's (card-studio.js appMenus' design and
// verify parts, ND, RD, qaDialog + qa-panel.js, mk*). Read on both: the Design and Verify menus' items (label, why, disabled, badge; the
// legacy menu's own DOM, [data-k=menu-design|verify|all] > [data-k=mi-<k>], and the native menus' same keys), the QA agents dialog's
// readings (the quote for the default quantity, the personas, the newest run's headline, the mocks gate) and Review Existing Designs'
// design names (when it is enabled; an app with no earlier design has it off on both). Writes (1280) are REFUSAL PATHS ONLY: Run QA and
// a New Design Start, each with its request rewritten to the app no-such-app-fa19087, so the cockpit refuses before anything starts.
// NOTHING here starts, draws, applies, discards, swaps, generates or runs anything: the legacy New Design item is never clicked (legacy
// starts its paid job on open), and the native one only shows its cost first.
import { diffRecords, norm } from "./harness.mjs";
import studio from "./studio.mjs";

const APP = process.env.STUDIO_APP || "family-office";
const NOPE = "no-such-app-fa19087";
const DESIGN_K = ["mi-new-design", "mi-enhance-design", "mi-review-designs"];
const VERIFY_K = ["mi-qa-agents", "mi-qa-mocks", "mi-requirements"];

// one menu item, read the same way on both pages: its label (no badge, no reason), its reason, disabled, its badge
const READ_ITEM = (b) => {
  const tx = (n) => (n ? n.textContent || "" : "");
  const chip = b.querySelector(".cs-chip, .ap-chip, [class*=badge], [data-badge]");
  const whyEl = b.querySelector(".w") || (b.getAttribute("aria-describedby") ? document.getElementById(b.getAttribute("aria-describedby")) : null);
  const why = whyEl ? tx(whyEl) : b.getAttribute("title") || "";
  const labEl = b.querySelector(".l");
  let label = labEl ? tx(labEl) : tx(b);
  if (chip) label = label.replace(tx(chip), "");
  if (!labEl && whyEl && b.contains(whyEl)) label = label.replace(tx(whyEl), "");
  return [b.dataset.k, label.replace(/\s+/g, " ").trim(), why.replace(/\s+/g, " ").trim(), b.getAttribute("aria-disabled") === "true" || b.disabled ? "disabled" : "on", chip ? tx(chip).trim() : ""].join(" | ");
};

export default {
  id: "studio-design",
  window: "apps",
  shot: "studio-design",
  label: "App studio: design and verify",
  async openLegacy(lp) {
    await studio.openLegacy(lp);
    // the menus settle once the designs and the mocks gate are read
    await lp.waitForFunction(() => {
      const r = document.querySelector('[data-k="mi-review-designs"] .w');
      return r && !/Reading the designs/.test(r.textContent || "");
    }, null, { timeout: 30_000 });
    await lp.waitForTimeout(1500);
  },
  async readLegacy(lp) {
    const items = await lp.evaluate(
      ({ D, V, READ }) => {
        const read = new Function("return " + READ)();
        const pick = (ks) => ks.map((k) => document.querySelector('[data-k="' + k + '"]')).filter(Boolean).map(read);
        return { design: pick(D), verify: pick(V) };
      },
      { D: DESIGN_K, V: VERIFY_K, READ: READ_ITEM.toString() },
    );
    // QA agents: its dialog (opening it reads, the quote is a GET); readings once the quote has answered
    await lp.evaluate(() => document.querySelector("[data-k=mi-qa-agents]").click());
    await lp.waitForFunction(() => {
      const d = document.querySelector("dialog[data-k=qa-dialog][open]");
      if (!d) return false;
      if (d.querySelector("[data-k=qa-mocks-body]:not([hidden])")) return true;
      const sec = d.querySelector('section[aria-labelledby="qa-h"]');
      return sec && sec.querySelector(":scope > div.qa-dim, :scope > div.qa-err");
    }, null, { timeout: 40_000 });
    const qa = await lp.evaluate(() => {
      const d = document.querySelector("dialog[data-k=qa-dialog][open]");
      const tx = (n) => (n ? (n.textContent || "").replace(/\s+/g, " ").trim() : "");
      const sec = d.querySelector('section[aria-labelledby="qa-h"]');
      const g = d.querySelector("[data-k=qa-gate]");
      return {
        qaTitle: tx(d.querySelector("#cs-qadh")),
        quote: sec ? tx(sec.querySelector(":scope > div.qa-dim, :scope > div.qa-err")) : "",
        personas: sec ? tx([...sec.querySelectorAll(":scope > p.qa-dim")].find((p) => /^Personas:/.test(p.textContent))) : "",
        run: tx(d.querySelector("#qa-run-h")),
        gate: g && !g.hidden ? tx(g) : "",
      };
    });
    await lp.evaluate(() => document.querySelector("dialog[data-k=qa-dialog][open]").close());
    // Review Existing Designs: its names, when it is on
    let designs = [];
    const on = await lp.evaluate(() => document.querySelector('[data-k="mi-review-designs"]').getAttribute("aria-disabled") !== "true");
    if (on) {
      await lp.evaluate(() => document.querySelector('[data-k="mi-review-designs"]').click());
      await lp.waitForFunction(() => document.querySelectorAll("dialog[data-k=rd-dialog][open] [data-k=rd-card]").length > 0, null, { timeout: 30_000 });
      designs = await lp.evaluate(() => [...document.querySelectorAll("dialog[data-k=rd-dialog][open] [data-k=rd-card] h4")].map((h) => h.textContent.trim()));
      await lp.evaluate(() => document.querySelector("dialog[data-k=rd-dialog][open]").close());
    }
    return { ...items, ...qa, designs };
  },
  async openNative(np) {
    await studio.openNative(np);
    // the menus settle once the designs and the mocks gate are read
    await np.waitForTimeout(2500);
  },
  async readNative(np) {
    const st = np.locator(`[data-testid=studio][data-app="${APP}"]`);
    // the Design and Verify menus (on a phone one Actions menu holds them all)
    const openMenu = async (k) => {
      const b = st.locator(`[data-k=menu-${k}]`);
      if (await b.count()) {
        if ((await b.first().getAttribute("aria-expanded")) !== "true") await b.first().click();
        return true;
      }
      const all = st.locator("[data-k=menu-all]");
      if (await all.count()) {
        if ((await all.first().getAttribute("aria-expanded")) !== "true") await all.first().click();
        return true;
      }
      return false;
    };
    const closeMenus = async () => {
      for (const k of ["design", "verify", "all"]) {
        const b = st.locator(`[data-k=menu-${k}][aria-expanded=true]`);
        if (await b.count()) await b.first().click();
      }
    };
    const readItems = async (k, ks) => {
      if (!(await openMenu(k))) return null;
      await np.waitForSelector(`[data-k="${ks[0]}"]`, { timeout: 10_000 });
      await np.waitForFunction(() => {
        const r = document.querySelector('[data-k="mi-review-designs"]');
        return !r || !/Reading the designs/.test(r.textContent || "");
      }, null, { timeout: 20_000 });
      const out = await np.evaluate(
        ({ ks, READ }) => {
          const read = new Function("return " + READ)();
          return ks.map((x) => document.querySelector('[data-k="' + x + '"]')).filter(Boolean).map(read);
        },
        { ks, READ: READ_ITEM.toString() },
      );
      await closeMenus();
      return out;
    };
    const design = await readItems("design", DESIGN_K);
    const verify = await readItems("verify", VERIFY_K);
    // QA agents
    let qa = { qaTitle: "", quote: "", personas: "", run: "", gate: "" };
    if (await openMenu("verify")) {
      await np.click("[data-k=mi-qa-agents]");
      await np.waitForFunction(() => {
        const d = document.querySelector("[data-testid=sg-qa]");
        if (!d) return false;
        if (d.querySelector("[data-k=qa-mocks-body]")) return true;
        return !!d.querySelector("[data-k=qa-quote]");
      }, null, { timeout: 40_000 });
      qa = await np.evaluate(() => {
        const d = document.querySelector("[data-testid=sg-qa]");
        const tx = (n) => (n ? (n.textContent || "").replace(/\s+/g, " ").trim() : "");
        return { qaTitle: tx(d.querySelector(".cp-dlg-title")), quote: tx(d.querySelector("[data-k=qa-quote]")), personas: tx(d.querySelector("[data-k=qa-personas]")), run: tx(d.querySelector("#sg-qa-run-h")), gate: tx(d.querySelector("[data-k=qa-gate]")) };
      });
      await np.keyboard.press("Escape");
      await np.waitForSelector("[data-testid=sg-qa]", { state: "detached", timeout: 5000 });
    }
    // Review Existing Designs
    let designs = [];
    const rdOn = design && design.find((x) => x.startsWith("mi-review-designs") && / \| on \| /.test(x));
    if (rdOn && (await openMenu("design"))) {
      await np.click('[data-k="mi-review-designs"]');
      await np.waitForFunction(() => document.querySelectorAll("[data-testid=sg-rd] [data-k=rd-card]").length > 0, null, { timeout: 30_000 });
      designs = await np.evaluate(() => [...document.querySelectorAll("[data-testid=sg-rd] [data-k=rd-card] h4")].map((h) => h.textContent.trim()));
      await np.keyboard.press("Escape");
      await np.waitForSelector("[data-testid=sg-rd]", { state: "detached", timeout: 5000 });
    }
    return { design, verify, ...qa, designs };
  },
  compare(L, N) {
    const out = [];
    if (!N.design || !N.verify) out.push("the native studio has no Design / Verify menu ([data-k=menu-design], [data-k=menu-verify] or [data-k=menu-all])");
    else out.push(...diffRecords(L, N, ["design", "verify"]));
    out.push(...diffRecords(L, N, ["qaTitle", "quote", "personas", "run", "gate", "designs"]));
    return out;
  },
  async writes(np, check) {
    const st = np.locator(`[data-testid=studio][data-app="${APP}"]`);
    const posts = [];
    const seen = (r) => r.url().includes("/_agent-native/actions/cockpit-studio-post") && posts.push(r.postData() || "");
    np.on("request", seen);
    // THE REWRITE: every studio write from this page goes to an app that does not exist; a body it cannot read is aborted, never sent
    const rewrite = async (r) => {
      try {
        const b = JSON.parse(r.request().postData() || "");
        if (!b || typeof b !== "object") return r.abort();
        await r.continue({ postData: JSON.stringify({ ...b, app: NOPE }) });
      } catch {
        await r.abort();
      }
    };
    const proveRewrite = async () => {
      // a body the studio refuses anyway (an ask with no action: 400 "Pick an action", before any job), so even unrewritten it does
      // nothing; rewritten, the cockpit answers for the app that does not exist ("APP-no-such-app-fa19087 is not on the board")
      const r = await np.evaluate(async () => {
        const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-studio-post", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "family-office", root: "app", path: "ask", body: { action: "" } }) });
        return { status: res.status, body: (await res.text()).slice(0, 300) };
      });
      return r.status >= 400 && /not on the board|no such app|no-such-app/i.test(r.body) && !/Pick an action/i.test(r.body) ? r : { failed: r };
    };
    const openFrom = async (menu, item) => {
      const b = st.locator(`[data-k=menu-${menu}]`);
      await (((await b.count()) ? b : st.locator("[data-k=menu-all]")).first()).click();
      await np.click(`[data-k="${item}"]`);
    };
    // 1. Run QA, refused by the cockpit for an app that does not exist (nothing runs)
    await np.route("**/_agent-native/actions/cockpit-studio-post", rewrite);
    try {
      const proof = await proveRewrite();
      check("Design tools: the write rewrite is in place before any click (the cockpit answers for the app that does not exist)", Boolean(proof) && !proof.failed, JSON.stringify(proof));
      if (proof && !proof.failed) {
        await openFrom("verify", "mi-qa-agents");
        await np.waitForSelector("[data-testid=sg-qa] [data-k=qa-run]", { timeout: 40_000 });
        const run = np.locator("[data-testid=sg-qa] [data-k=qa-run]");
        if (await run.isEnabled()) {
          await run.click();
          const said = await np.waitForSelector("[data-testid=sg-qa] [data-k=qa-say]", { timeout: 30_000 }).then((e) => e.textContent()).catch(() => "");
          check("Design tools: Run QA round-trips to the cockpit's refusal for an app that does not exist (nothing runs)", /QA run refused:/.test(said || "") && /no such app|not on the board|no-such-app/i.test(said || ""), said);
        } else check("Design tools: Run QA is off here, with its reason: " + ((await run.getAttribute("title")) || "(none)"), true);
        await np.keyboard.press("Escape");
        await np.waitForSelector("[data-testid=sg-qa]", { state: "detached", timeout: 5000 });
      }
      // 2. New Design: opening it spends nothing (it names the cost first); Start, refused for an app that does not exist
      const n0 = posts.length;
      await openFrom("design", "mi-new-design");
      await np.waitForSelector("[data-testid=sg-nd]", { timeout: 20_000 });
      await np.waitForTimeout(1500);
      check("Design tools: opening New Design starts nothing (no studio write on open)", posts.length === n0, posts.slice(n0).join(" | ").slice(0, 200));
      const go = np.locator("[data-testid=sg-nd] [data-k=nd-go]");
      if (proof && !proof.failed && (await go.count())) {
        await np.waitForFunction(() => /cap \$\d/.test((document.querySelector("[data-testid=sg-nd] [data-k=nd-caps]") || {}).textContent || ""), null, { timeout: 20_000 }).catch(() => {});
        const cost = norm(await np.locator("[data-testid=sg-nd] [data-k=nd-cost]").textContent());
        check("Design tools: New Design names its cost before Start (the model, its cap, the apply estimate)", /cap \$\d/.test(cost) && /before anything is spent/i.test(cost), cost.slice(0, 200));
        await go.click();
        const said = await np.waitForSelector("[data-testid=sg-nd] .sg-err", { timeout: 30_000 }).then((e) => e.textContent()).catch(() => "");
        check("Design tools: New Design Start round-trips to the cockpit's refusal for an app that does not exist (nothing starts)", /not on the board|no such app|no-such-app/i.test(said || ""), said);
      } else check("Design tools: New Design opens on a job already running or awaiting review (no Start to refuse)", (await np.locator("[data-testid=sg-nd]").count()) === 1);
      await np.keyboard.press("Escape");
    } finally {
      await np.unroute("**/_agent-native/actions/cockpit-studio-post", rewrite);
      np.off("request", seen);
    }
  },
};
