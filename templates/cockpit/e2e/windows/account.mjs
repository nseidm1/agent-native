// FA-19125: Claude account. The legacy acctDlg (page/account.js) against the agent-native account window. No flow is ever started:
// the write path is proven by its refusal only (account.step retry with no flow running: the cockpit answers "Nothing to retry").
import { diffRecords } from "./harness.mjs";

export default {
  id: "account",
  label: "Claude account",
  async openLegacy(lp) {
    await lp.evaluate(() => document.getElementById("acctBtn").click());
    await lp.waitForFunction(() => { const d = document.getElementById("acctDlg"); return d && d.open && document.getElementById("acctWho").textContent.trim() && document.getElementById("acctBody").childNodes.length; }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const $ = (id) => document.getElementById(id);
      const shown = (id) => ($(id).hidden ? "" : $(id).textContent);
      return {
        who: $("acctWho").textContent,
        halo: shown("acctHalo"),
        budget: $("acctBud").textContent,
        hold: shown("acctHold"),
        steps: [...document.querySelectorAll("#acctBody .acsteps li")].map((li) => li.className + " " + li.querySelector(".lb").textContent),
        buttons: [...document.querySelectorAll("#acctBody button, #acctBody a.btn")].map((b) => b.textContent).filter((t) => t !== "Close"),
      };
    }),
  async openNative(np) {
    await np.click(".cf-acct");
    await np.waitForSelector("[data-window=account] .cf-ac", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=account]");
      const sec = (t) => [...w.querySelectorAll(".cp-sec")].find((x) => { const h = x.querySelector(".cp-sec-t"); return h && h.textContent === t; });
      const budget = sec("Budget");
      const hold = sec("Lane paused") || sec("Lane resumed");
      const desc = w.querySelector(".cp-dlg-sub");
      return {
        who: w.querySelector(".cp-dlg-hl") ? w.querySelector(".cp-dlg-hl").textContent : "",
        halo: desc ? [...desc.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : "",
        budget: budget ? budget.querySelector(".cp-list li").textContent : "",
        hold: hold ? hold.querySelector(".cp-list li").textContent : "",
        steps: [...w.querySelectorAll(".cf-ac-step")].map((li) => li.className.replace("cf-ac-step ", "") + " " + li.querySelector(".lb").textContent),
        buttons: [...w.querySelectorAll(".cf-ac > .cf-ac-row button, .cf-ac .cf-ac-other button, .cf-ac .cf-ac-steps button, .cf-ac .cf-ac-steps a")].map((b) => b.textContent),
      };
    }),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    // never start a flow: only when none is running, account.step retry is refused by the cockpit before it touches anything
    const flow = await np.evaluate(() => { const e = document.querySelector("[data-window=account] .cf-ac"); return e ? e.getAttribute("data-flow") : "unknown"; });
    if (flow !== "none") { check("Claude account: write path skipped (a sign-in or swap is in flight: " + flow + ")", true); return; }
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-account-step", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ act: "retry" }) });
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    });
    check("Claude account: account.step retry with no flow running is refused by the cockpit in its own words (refusal path, nothing started)", r.status >= 400 && r.status < 500 && /Nothing to retry|owns the account flow|only reads/.test(r.body), JSON.stringify(r));
  },
};
