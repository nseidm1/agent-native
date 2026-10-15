// FA-19133: Balancer savings. The legacy #balancer section (renderBalancer) against the agent-native balancer window,
// opened from the Balancer key tile: the headline and every table row by row. No writes. (The legacy balWhy line is
// never written - its setT sits inside a line comment - so the agent-native window's why line has no legacy reading.)
import { diffSavings, openLegacySection, openNativeTile, readLegacyIds, readNativeWindow } from "./savings-read.mjs";

const TABLES = [
  ["ex", "balEx", "By executor"],
  ["who", "balWho", "By who routed"],
  ["days", "balDay", "Per day · last 7 days"],
];

export default {
  id: "balancer",
  label: "Balancer savings",
  openLegacy: (lp) => openLegacySection(lp, "balancer", "balHead"),
  async readLegacy(lp) {
    const o = await readLegacyIds(lp, ["balHead", "balSrc"], TABLES.map((t) => t[1]));
    const r = { head: o.texts.balHead, src: o.texts.balSrc };
    for (const [k, id] of TABLES) r[k] = o.rows[id];
    return r;
  },
  openNative: (np) => openNativeTile(np, "kBalancer", "balancer"),
  async readNative(np) {
    const w = await readNativeWindow(np, "balancer");
    const S = (t) => w.sections[t] || { sub: "", text: "", rows: [] };
    const r = { head: w.headline, src: S("Source").text, bars: S("Saved per day").bars, rungs: S("Within Halo rung").rows };
    for (const [k, , title] of TABLES) r[k] = S(title).rows;
    return r;
  },
  compare: (L0, N0) => {
    // the legacy table nests the Halo's rungs as "↳" rows; the agent-native window lists them in "Within Halo rung"
    const L = { ...L0, ex: L0.ex.filter((x) => !x.startsWith("↳")), rungs: L0.ex.filter((x) => x.startsWith("↳")).map((x) => x.replace(/^↳ /, "").replace(/ \|  \| $/, "")) };
    const N = { ...N0 };
    const d = diffSavings(L, N);
    if (!N.bars) d.push("the per-day bars are missing");
    return d;
  },
};
