// FA-19131: Who's working. The legacy Everyone working table (#working) against the agent-native window opened from the office card:
// the header, the header line's parts, every row (worker, card, doing now, try and tier, host, cost; the age ticks every second on
// the legacy page, so it is left out of the comparison) and the day's totals. A read-only window: no writes.
import { diffRecords } from "./harness.mjs";

export default {
  id: "agents",
  label: "Who's working",
  async openLegacy(lp) {
    await lp.evaluate(() => { location.hash = "#working"; });
    await lp.waitForFunction(() => { const d = document.getElementById("secDlg"); return d && d.open && !document.getElementById("exBox").hidden && document.querySelector("#exRows tr"); }, null, { timeout: 30_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const t = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
      return {
        head: t(document.getElementById("exHead")),
        sub: t(document.getElementById("exSub")),
        line: [...document.getElementById("exLine").children].map(t),
        rows: [...document.querySelectorAll("#exRows tr")].filter((tr) => tr.cells.length >= 7).map((tr) => [...tr.cells].filter((_, i) => i !== 3).map(t).join(" | ")),
        empty: [...document.querySelectorAll("#exRows tr")].some((tr) => /Nobody is working/.test(tr.textContent)) ? "nobody" : "",
        foot: t(document.getElementById("exFoot")),
      };
    }),
  async openNative(np) {
    await np.click(".cf-office .cf-ofh");
    await np.waitForSelector("[data-window=agents] .cp-sec", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const t = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
      const w = document.querySelector("[data-window=agents]");
      const sec = (title) => [...w.querySelectorAll(".cp-sec")].find((s) => t(s.querySelector(".cp-sec-t")) === title);
      const lane = sec("Lane"), tbl = sec("Everyone working");
      return {
        head: t(w.querySelector(".cp-dlg-hl")),
        sub: t(w.querySelector(".cp-dlg-sub")),
        line: lane ? [...lane.querySelectorAll(".cp-stat")].map((s) => t(s.querySelector(".cp-stat-l")) + " " + t(s.querySelector(".cp-stat-v"))) : [],
        rows: tbl ? [...tbl.querySelectorAll("tbody tr:not(.cp-xr)")].map((tr) => [...tr.cells].filter((_, i) => i !== 3).map(t).join(" | ")) : [],
        empty: tbl && /Nobody is working/.test(t(tbl.querySelector(".cp-empty"))) ? "nobody" : "",
        foot: t(sec("Today") && sec("Today").querySelector(".cp-text")),
      };
    }),
  compare: (L, N) => diffRecords(L, N),
};
