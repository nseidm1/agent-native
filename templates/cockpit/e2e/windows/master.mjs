// FA-19126: Message master. The legacy msgDlg against the agent-native master window: the same newest messages, in order, and the
// same live line. The send path is proven by its refusal (a blank message, refused by the cockpit); no real message is sent unless
// verify-cockpit-full.mjs is run with --send-master, which sends one marked "no action needed" and waits for it in the thread.
import { diffRecords } from "./harness.mjs";

const N = 12;
const PARITY_TEXT = "cockpit parity check FA-19126 - no action needed";

export default {
  id: "master",
  label: "Message master",
  async openLegacy(lp) {
    await lp.evaluate(() => document.getElementById("msgBtn").click());
    await lp.waitForFunction(() => { const d = document.getElementById("msgDlg"); return d && d.open && !/Loading/.test((document.querySelector("#msgLog .mold") || {}).textContent || "Loading"); }, null, { timeout: 20_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate((n) => {
      const bubs = [...document.querySelectorAll("#msgLog .bub")];
      const dels = [...document.querySelectorAll("#msgLog .mdel")];
      return {
        count: String(bubs.length),
        last: bubs.slice(-n).map((b) => (b.classList.contains("me") ? "me" : "re") + ": " + b.textContent),
        live: document.getElementById("msgLive").textContent.replace(/^·\s*/, ""),
        delivery: dels.length ? dels[dels.length - 1].textContent : "",
      };
    }, N),
  async openNative(np) {
    await np.click(".cf-msg");
    await np.waitForSelector("[data-window=master] .cf-mm-log", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate((n) => {
      const w = document.querySelector("[data-window=master]");
      const bubs = [...w.querySelectorAll(".cf-mm-bub")];
      const dels = [...w.querySelectorAll(".cf-mm-del")];
      return {
        count: String(bubs.length),
        last: bubs.slice(-n).map((b) => b.getAttribute("data-side") + ": " + b.textContent),
        live: w.querySelector(".cp-dlg-hl") ? w.querySelector(".cp-dlg-hl").textContent : "",
        delivery: dels.length ? dels[dels.length - 1].textContent : "",
      };
    }, N),
  compare: (L, N2) => diffRecords(L, N2),
  async writes(np, check) {
    const scrolled = await np.evaluate(() => { const l = document.querySelector("[data-window=master] .cf-mm-log"); return l ? l.scrollHeight - l.scrollTop - l.clientHeight : -1; });
    check("Message master: the thread opens scrolled to the newest message", scrolled >= 0 && scrolled < 4, "distance from the end " + scrolled);
    const seen = await np.evaluate(() => ({ unread: !!document.querySelector(".cf-msg .cf-msgn"), seen: localStorage.getItem("msgSeen") }));
    check("Message master: opening the window marks the replies seen (msgSeen) and the header's unread count clears", !seen.unread && Number(seen.seen) > 0, JSON.stringify(seen));
    const post = (text) =>
      np.evaluate(async (t) => {
        const res = await fetch(new URL("/cards/_agent-native/actions/cockpit-master-send", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
        return { status: res.status, body: (await res.text()).slice(0, 300) };
      }, text);
    const r = await post("   ");
    check("Message master: a blank message is refused by the cockpit in its own words (refusal path, nothing sent)", r.status >= 400 && r.status < 500 && /needs a message/.test(r.body), JSON.stringify(r));
    if (process.argv.includes("--send-master")) {
      const s = await post(PARITY_TEXT);
      check("Message master: --send-master sent the parity message through master.send", s.status === 200, JSON.stringify(s).slice(0, 200));
      const shown = await np
        .waitForFunction((t) => [...document.querySelectorAll("[data-window=master] .cf-mm-bub.me")].some((b) => b.textContent === t), PARITY_TEXT, { timeout: 40_000 })
        .then(() => true, () => false);
      check("Message master: the sent message comes back in the thread from the client", shown);
    }
  },
};
