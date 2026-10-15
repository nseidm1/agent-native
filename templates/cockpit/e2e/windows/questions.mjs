// FA-19134: Questions for you. The legacy qDlg (index.html, the QUESTIONS FOR YOU script) against the agent-native questions
// window: the summary line, the open questions, and the answered list (the client carries the newest 30: compared against the
// legacy Answered tab's first 30). Opened on both pages by the #questions hash (the Lane button shows only while questions
// wait). Writes: never a real answer - questions.answer is proven by its refusal path (an id that does not exist: the
// cockpit's own "no such question").
import { diffRecords, norm } from "./harness.mjs";

const said = (s) => norm(s).replace(/\s*·\s*/g, " ");

export default {
  id: "questions",
  label: "Questions for you",
  async openLegacy(lp) {
    await lp.evaluate(() => { location.hash = "#questions"; });
    await lp.waitForFunction(() => { const d = document.getElementById("qDlg"); return d && d.open && !/Loading/.test(document.getElementById("fqSum").textContent); }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const tab = (v) => document.querySelector('#qDlg .fq-tabs button[data-view="' + v + '"]').click();
      const headline = document.getElementById("fqSum").textContent;
      tab("list");
      const open = [...document.querySelectorAll("#fqBody .fq-row .fq-rq")].map((n) => n.textContent);
      tab("done");
      const A = [...document.querySelectorAll("#fqBody .fq-ans")].slice(0, 30);
      const r = {
        headline,
        open,
        answered: A.map((a) => a.querySelector(".fq-rq").textContent),
        said: A.map((a) => { const s = a.querySelector(".fq-said"); return s ? s.textContent : ""; }),
        progress: A.map((a) => { const sp = [...a.querySelectorAll(".fq-steps span")], k = sp.filter((s) => s.className === "on" || s.className === "now").length; return k ? sp[k - 1].textContent : ""; }),
      };
      tab("one");
      return r;
    }).then((r) => ({ ...r, said: r.said.map(said) })),
  async openNative(np) {
    await np.evaluate(() => { location.hash = "#questions"; });
    await np.waitForSelector("[data-window=questions] .cp-sec", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=questions]");
      const secs = [...w.querySelectorAll(".cp-sec")];
      const title = (s) => s.querySelector(".cp-sec-t").textContent;
      const open = secs.filter((s) => /^Question \d+ of \d+$/.test(title(s))).map((s) => { const li = [...s.querySelectorAll(".cp-list li")].find((x) => x.querySelector("b") && x.querySelector("b").textContent === "Question: "); return li ? li.textContent.replace(/^Question: /, "") : ""; });
      const ans = secs.find((s) => title(s) === "Answered");
      const rows = ans ? [...ans.querySelectorAll("tbody tr:not(.cp-xr)")] : [];
      const cell = (r, i) => (r.children[i] ? r.children[i].textContent : "");
      return { headline: w.querySelector(".cp-dlg-hl") ? w.querySelector(".cp-dlg-hl").textContent : "", open, answered: rows.map((r) => cell(r, 0)), said: rows.map((r) => cell(r, 1)), progress: rows.map((r) => cell(r, 2)) };
    }).then((r) => ({ ...r, said: r.said.map(said) })),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    // 1. an answer to a question that does not exist round-trips to the cockpit's refusal: nothing is answered
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-question", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verb: "answer", id: "cq-nosuchq0fa19134", text: "parity probe" }) });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    });
    check("Questions: an answer to a question that does not exist round-trips to the cockpit's refusal (refusal path: no such question)", r.status === 404 && /no such question/.test(r.body), JSON.stringify(r));
    // 2. the window's way to Issues opens the Issues window
    await np.locator("[data-window=questions] [data-testid=questions-issues] button").click();
    const ok = await np.waitForSelector("[data-window=issues] .cp-dlg-hl", { timeout: 15_000 }).then(() => true, () => false);
    check("Questions: Open issues opens the Issues window", ok);
  },
};
