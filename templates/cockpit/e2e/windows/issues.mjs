// FA-19134: Issues. The legacy issDlg (index.html; js/issues.mjs draws the list) against the agent-native issues window: the open
// count, and every issue's card line (card, and its closed reason) in the cockpit's order, open ones first on the native side.
// The legacy issBtn is CSS-hidden: it is pressed by script there; the native window opens from the #issues hash. Writes: never a
// real retry - issues.act is proven by its refusal path (an id that does not exist: the cockpit's own "no such issue").
import { diffRecords } from "./harness.mjs";

export default {
  id: "issues",
  label: "Issues",
  async openLegacy(lp) {
    await lp.evaluate(() => document.getElementById("issBtn").click());
    await lp.waitForFunction(() => { const d = document.getElementById("issDlg"); return d && d.open && document.querySelectorAll("#issList .iss, #issList .il").length > 0; }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const I = [...document.querySelectorAll("#issList .iss")];
      return {
        open: document.getElementById("issN").textContent + " open",
        openCards: I.filter((i) => !i.classList.contains("closed")).map((i) => i.querySelector(".ic").textContent),
        openWhy: I.filter((i) => !i.classList.contains("closed")).map((i) => [...i.children].filter((c) => c.tagName === "DIV" && !c.className).map((c) => c.textContent).join(" ")),
        closedCards: I.filter((i) => i.classList.contains("closed")).map((i) => i.querySelector(".ic").textContent),
      };
    }),
  async openNative(np) {
    await np.evaluate(() => { location.hash = "#issues"; });
    await np.waitForSelector("[data-window=issues] .cp-sec", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=issues]");
      const secs = [...w.querySelectorAll(".cp-sec")];
      const title = (s) => s.querySelector(".cp-sec-t").textContent;
      const opens = secs.filter((s) => !["Closed", "No issues"].includes(title(s)));
      const closed = secs.find((s) => title(s) === "Closed");
      const rows = closed ? [...closed.querySelectorAll("tbody tr:not(.cp-xr)")] : [];
      const hl = w.querySelector(".cp-dlg-hl") ? w.querySelector(".cp-dlg-hl").textContent : "";
      const m = /^(\d+) issues? open$/.exec(hl);
      return {
        open: (m ? m[1] : /^No open/.test(hl) ? "0" : hl) + " open",
        openCards: opens.map(title),
        openWhy: opens.map((s) => { const li = s.querySelector(".cp-list li"); return li && !li.querySelector("b") ? li.firstChild.textContent : ""; }),
        closedCards: rows.map((r) => r.children[0].textContent + " (" + r.children[1].textContent + ")"),
      };
    }),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-issue", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "is-nosuchissue0fa19134", do: "retry" }) });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    });
    check("Issues: a retry of an issue that does not exist round-trips to the cockpit's refusal (refusal path: no such issue)", r.status >= 400 && r.status < 500 && /no such issue/.test(r.body), JSON.stringify(r));
  },
};
