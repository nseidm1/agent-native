// FA-19130: Overview. The legacy section (#overview: header chips, hint, idle reasons, the pills, the Hot red/green line, the
// land-card note, the strictness chip, stepper level and rule switches) against the agent-native Overview window opened from its
// face. The strict write is proven by re-sending one gate at its CURRENT value (a write that changes nothing), read back.
import { diffRecords } from "./harness.mjs";

const ACT = "/cards/_agent-native/actions/";

export default {
  id: "overview",
  label: "Overview",
  async openLegacy(lp) {
    await lp.evaluate(() => { location.hash = "#overview"; });
    await lp.waitForFunction(() => { const d = document.getElementById("secDlg"); return d && d.open && /overview/i.test(document.getElementById("secH").textContent) && document.getElementById("drv").textContent.trim() && document.querySelector("#strictBox .sstep button"); }, null, { timeout: 30_000 });
  },
  readLegacy: (lp) =>
    lp.evaluate(() => {
      const t = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
      const box = document.getElementById("strictBox").closest(".mr");
      const hot = document.getElementById("hotRg");
      const pressed = box.querySelector(".sstep button[aria-pressed=true]");
      return {
        chips: [...document.querySelectorAll("#secSum > *")].map(t),
        hint: t(document.getElementById("ovHint")),
        idle: document.getElementById("ovIdle").hidden ? [] : [...document.querySelectorAll("#ovIdle li")].map(t),
        pills: [...document.querySelectorAll("#ovPills .pill")].map((p) => t(p.querySelector(".k")) + ": " + t(p.querySelector("b"))),
        pillTones: [...document.querySelectorAll("#ovPills .pill b")].map((b) => (/(^| )(g|a|r)( |$)/.exec(b.className) || [])[2] || "-"),
        hot: hot.hidden ? "" : t(hot),
        landCard: t(document.getElementById("landCardNote")),
        strict: t(document.getElementById("strictChip")),
        level: pressed ? pressed.textContent : "custom",
        rules: [...box.querySelectorAll(".srules li[data-gates]")].map((li) => li.dataset.gates + "=" + (li.querySelector(".stog") ? li.querySelector(".stog").getAttribute("aria-checked") : "?")),
      };
    }),
  async openNative(np) {
    await np.click("[data-face=overview]");
    await np.waitForSelector("[data-window=overview] [data-testid=ov-strict]", { timeout: 20_000 });
  },
  readNative: (np) =>
    np.evaluate(() => {
      const t = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
      const w = document.querySelector("[data-window=overview]");
      const sec = (title) => [...w.querySelectorAll(".cp-sec")].find((s) => t(s.querySelector(".cp-sec-t")) === title);
      const items = (title) => { const s = sec(title); return s ? [...s.querySelectorAll(".cp-list li")].map(t) : []; };
      const hotLast = items("Hot system fixes").filter((x) => /^Today:/.test(x));
      const sysSub = t(sec("System cards") && sec("System cards").querySelector(".cp-sec-s"));
      const lane = sec("The lane now");
      const pressed = w.querySelector(".ov-step button[aria-pressed=true]");
      return {
        chips: [...w.querySelectorAll(".cp-dlg-sub .cp-chip")].map(t),
        hint: t(w.querySelector(".cp-lead")),
        idle: items("Cards not starting, because"),
        pills: lane ? [...lane.querySelectorAll(".cp-stat")].map((s) => t(s.querySelector(".cp-stat-l")) + ": " + t(s.querySelector(".cp-stat-v"))) : [],
        pillTones: lane ? [...lane.querySelectorAll(".cp-stat")].map((s) => (/t-(g|a|r)/.exec(s.className) || [])[1] || "-") : [],
        hot: hotLast[0] || "",
        landCard: sysSub.split(" · ").pop(),
        strict: t(w.querySelector("[data-testid=ov-strict-chip]")),
        level: pressed ? pressed.textContent : "custom",
        rules: [...w.querySelectorAll(".ov-rules li[data-gates]")].map((li) => li.dataset.gates + "=" + li.querySelector(".ov-tog").getAttribute("aria-checked")),
      };
    }),
  compare: (L, N) => diffRecords(L, N),
  async writes(np, check) {
    // (a) a write that changes nothing: the shipping gate re-sent through the client at its current value, every gate read back unchanged
    const r = await np.evaluate(async (ACT) => {
      const read = async () => (await (await fetch(new URL(ACT + "get-window?id=overview", location.origin))).json()).strict;
      const before = await read();
      if (!before || typeof before.shipping !== "boolean") return { skipped: "no strict reading", before };
      const w = await fetch(new URL(ACT + "cockpit-strict", location.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gate: "shipping", on: before.shipping }) });
      const body = (await w.text()).slice(0, 300);
      const after = await read();
      return { status: w.status, body, before, after, same: JSON.stringify(before) === JSON.stringify(after) };
    }, ACT);
    check("Overview: the strict write round-trips through the client (shipping re-sent at its current value; every gate reads back unchanged)", !r.skipped && r.status === 200 && /"ok":true/.test(r.body) && r.same, JSON.stringify(r).slice(0, 400));
    // the Door to landing face opens the same Overview window
    await np.keyboard.press("Escape");
    await np.waitForTimeout(400);
    await np.click("[data-face=doorLanding]");
    const ok = await np.waitForSelector("[data-testid=cf-window][data-window=overview] [data-testid=ov-strict]", { timeout: 15_000 }).then(() => true, () => false);
    check("Overview: the Door to landing face opens the agent-native Overview window", ok && (await np.locator("[data-testid=cf-legacy]").count()) === 0);
  },
};
