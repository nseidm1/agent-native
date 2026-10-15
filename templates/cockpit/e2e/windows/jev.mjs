// FA-19132: JEV + JevGrep savings. The legacy #jev section (renderJev) against the agent-native jev window, opened from the
// JEV key tile: the KPI line, the headline / why / face lines and every table row by row. No writes.
import { diffSavings, openLegacySection, openNativeTile, readLegacyIds, readNativeWindow } from "./savings-read.mjs";

const TABLES = [
  ["brk", "jvBrk", "Breakdown"],
  ["wl", "jvWl", "Live vs replay per workload"],
  ["lr", "jvLR", "Live vs replay per day"],
  ["days", "jvDays", "Saved per day · 7 days"],
  ["fail", "jvFail", "Why JevGrep gave no leads"],
  ["cls", "jvCls", "JevGrep lead effect by card class"],
  ["build", "jvBuild", "Library assimilation · build state"],
];

export default {
  id: "jev",
  label: "JEV + JevGrep savings",
  openLegacy: (lp) => openLegacySection(lp, "jev", "jvBrk"),
  async readLegacy(lp) {
    // the opportunities table shows one window at a time: read 7 days, then put Today back
    await lp.click("#jvOpW");
    const week = await readLegacyIds(lp, [], ["jvOpp"]);
    await lp.click("#jvOpT");
    const o = await readLegacyIds(lp, ["jvClaude", "jvClaudeP", "jvHead", "jvWhy", "jvFace", "jvBasis", "jvWlHead", "jvRpCost", "jvLeadN", "jvBuildSum"], [...TABLES.map((t) => t[1]), "jvOpp"], ["jvWl"]);
    const r = {
      claude: o.texts.jvClaude,
      claudeP: o.texts.jvClaudeP,
      head: o.texts.jvHead,
      why: o.texts.jvWhy,
      face: o.texts.jvFace,
      basis: o.texts.jvBasis,
      wlHead: o.texts.jvWlHead,
      rpCost: o.texts.jvRpCost,
      leadN: o.texts.jvLeadN,
      buildSum: o.texts.jvBuildSum,
      oppToday: o.rows.jvOpp,
      oppWeek: week.rows.jvOpp,
    };
    for (const [k, id] of TABLES) r[k] = o.rows[id];
    return r;
  },
  openNative: (np) => openNativeTile(np, "kJev", "jev"),
  async readNative(np) {
    const w = await readNativeWindow(np, "jev");
    const S = (t) => w.sections[t] || { sub: "", text: "", rows: [] };
    const c = S("Claude spend avoided by Halo + JEV");
    const r = {
      claude: "Claude spend avoided by Halo + JEV: " + c.sub,
      claudeP: c.text,
      head: w.headline,
      why: w.sub,
      face: w.lead,
      basis: S("How it is priced").text,
      wlHead: S("Going forward").text,
      rpCost: S("Replay").text,
      leadN: S("JevGrep lead effect by card class").sub,
      buildSum: S("Library assimilation · build state").sub,
      oppToday: S("Opportunities · today").rows,
      oppWeek: S("Opportunities · 7 days").rows,
      bars: S("Saved per day · live and if online").bars,
    };
    for (const [k, , title] of TABLES) r[k] = S(title).rows;
    // the workload's history sits on the row's second line, "History: <the full text>"
    r.wl = r.wl.map((x) => x.replace(/ \| History: /, " | "));
    return r;
  },
  compare: (L, N) => {
    // the client cuts a jevbuild unit's why at 400 characters (reported to master): such a row matches as a prefix
    const d = diffSavings(L, N, { clipped: ["build"] });
    if (!N.bars) d.push("the per-day bars are missing");
    return d;
  },
};
