// FA-19127: Push to remote. The legacy pushDlg (index.html) against the agent-native push window; the push itself is proven by its refusal path only.
import { diffRecords } from "./harness.mjs";

export default {
  id: "push",
  label: "Push to remote",
  async openLegacy(lp) {
    await lp.evaluate(() => document.getElementById("pushBtn").click());
    await lp.waitForFunction(() => { const d = document.getElementById("pushDlg"); return d && d.open && !/Checking/.test(document.getElementById("pushSum").textContent); }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => ({
      headline: document.getElementById("pushSum").textContent.split(". ")[0].replace(/\.$/, "") + ".",
      subjects: [...document.querySelectorAll("#pushSubj li")].map((li) => li.textContent),
      notes: [...document.querySelectorAll("#pushNotes p")].map((p) => p.textContent),
      button: getComputedStyle(document.getElementById("pushGo")).display === "none" ? "" : document.getElementById("pushGo").textContent,
    })),
  async openNative(np) {
    await np.click(".cf-push");
    await np.waitForSelector("[data-window=push] .cp-sec", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=push]");
      const secs = [...w.querySelectorAll(".cp-sec")];
      const items = (t) => { const s = secs.find((x) => x.querySelector(".cp-sec-t").textContent === t); return s ? [...s.querySelectorAll(".cp-list li")].map((li) => li.textContent.replace(/^([0-9a-f]{6,40}): /, "$1")) : []; };
      const b = w.querySelector(".cp-acts button");
      return { headline: w.querySelector(".cp-dlg-hl") ? w.querySelector(".cp-dlg-hl").textContent : "", subjects: items("Newest commits waiting").filter((x) => x !== "nothing waiting"), notes: items("Notes"), button: b ? b.textContent : "" };
    }),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    // the push is the console's act: proven by its refusal path only (no confirm -> refused before anything is sent)
    const r = await np.evaluate(async () => {
      const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-release-push", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: false }) });
      return { status: res.status, body: (await res.text()).slice(0, 200) };
    });
    check("Push to remote: a push without the confirm is refused before anything is sent", r.status >= 400 && r.status < 500, JSON.stringify(r));
  },
};
