// FA-19133: Halo savings. The legacy #halosave section (renderHaloSave) against the agent-native halosave window, opened
// from the Halo key tile: the KPI line, the headline / pricing / face lines and every table row by row. No writes.
import { diffSavings, openLegacySection, openNativeTile, readLegacyIds, readNativeWindow } from "./savings-read.mjs";

const TABLES = [
  ["sum", "hsSum", "Claude $ avoided, power and shadow"],
  ["pow", "hsPow", "Power: the Halo's electricity"],
  ["uses", "hsUses", "Per use: live or shadow, and agreement with the Claude call it replaces"],
  ["days", "hsDays", "Per day · last 7 days"],
];

export default {
  id: "halosave",
  label: "Halo savings",
  openLegacy: (lp) => openLegacySection(lp, "halosave", "hsHead"),
  async readLegacy(lp) {
    const o = await readLegacyIds(lp, ["hsClaude", "hsClaudeP", "hsHead", "hsWhy", "hsFace", "hsUn", "hsSrc"], TABLES.map((t) => t[1]));
    const r = { claude: o.texts.hsClaude, claudeP: o.texts.hsClaudeP, head: o.texts.hsHead, why: o.texts.hsWhy, face: o.texts.hsFace, un: o.texts.hsUn, src: o.texts.hsSrc };
    for (const [k, id] of TABLES) r[k] = o.rows[id];
    return r;
  },
  openNative: (np) => openNativeTile(np, "kHalo", "halosave"),
  async readNative(np) {
    const w = await readNativeWindow(np, "halosave");
    const S = (t) => w.sections[t] || { sub: "", text: "", rows: [] };
    const c = S("Claude spend avoided by Halo + JEV");
    const r = {
      claude: "Claude spend avoided by Halo + JEV: " + c.sub,
      claudeP: c.text,
      head: w.headline,
      why: w.sub,
      face: w.lead,
      un: S("Not counted").text,
      src: S("Sources").text,
      bars: S("Per day · live and would save if live").bars,
    };
    for (const [k, , title] of TABLES) r[k] = S(title).rows;
    return r;
  },
  compare: (L, N) => {
    const d = diffSavings(L, N);
    if (!N.bars) d.push("the per-day bars are missing");
    return d;
  },
};
