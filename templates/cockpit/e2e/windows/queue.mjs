// FA-19131: the commit queue. The legacy qvDlg (window.openQueueView: the cockpit's queue-view text in a pre) against the agent-native
// window opened from the office card's Commits tile, line by line. A read-only window: no writes.
import { diffRecords } from "./harness.mjs";

export default {
  id: "queue",
  label: "Commit queue",
  async openLegacy(lp) {
    await lp.evaluate(() => window.openQueueView());
    await lp.waitForFunction(() => { const d = document.getElementById("qvDlg"); return d && d.open && !/^Reading the queue/.test(document.getElementById("qvPre").textContent); }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const x = document.getElementById("qvPre").textContent;
      return { title: document.getElementById("qvH").textContent, lines: x.split("\n").map((l) => l.trimEnd()).filter(Boolean) };
    }),
  async openNative(np) {
    await np.click("[data-of=commits]");
    await np.waitForSelector("[data-window=queue] .cp-text", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const w = document.querySelector("[data-window=queue]");
      const x = w.querySelector(".cp-text").textContent;
      return { title: w.querySelector(".cp-dlg-title").textContent.replace(/[✓⚠✕–]/g, ""), lines: x.split("\n").map((l) => l.trimEnd()).filter(Boolean) };
    }),
  compare: (L, N) => diffRecords(L, N),
};
