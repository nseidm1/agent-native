/**
 * FA-19131: Who's working, ported from the legacy page's Everyone working table (tools/lane/maint/ui/index.html:
 * renderExecutors, exHeader, fineAge / ageTitle; page/agents.js renderAgents): the header line (slots, next in line,
 * last landing, the commit queue, the overseer, the last 30 min), one row per executor grouped by kind with each door
 * run's subagents under it, and the day's totals. Read from the client resource home (officeShape).
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailRow, DetailStat } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type J = any;

export const EX_KIND: Record<string, string> = { master: "Master", subagent: "App subagents", engine: "Halo engine", halo: "Halo client", door: "Door runs", roster: "Roster agents", lander: "Lander" };
const short = (t: unknown, n: number) => {
  const s = String(t || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
/** Working time to the second ("42s", "3m 07s", "1h 04m"), the legacy fineAge. */
export function fineAge(ms: unknown): string {
  const s = Math.floor(Math.max(0, Number(ms) || 0) / 1000),
    m = Math.floor(s / 60),
    p2 = (n: number) => String(n).padStart(2, "0");
  return s < 60 ? s + "s" : m < 60 ? m + "m " + p2(s % 60) + "s" : Math.floor(m / 60) + "h " + p2(m % 60) + "m";
}
/** The office's internal 'maintenance' is Production off (MI-171). */
export const modeLabel = (m: unknown) => (!m ? "" : m === "maintenance" ? "production off" : m === "production" ? "production on" : String(m));
const usdT = (u: unknown) => (u == null || !Number.isFinite(Number(u)) ? "-" : "$" + (Number(u) > 0 && Number(u) < 0.01 ? Number(u).toFixed(3) : Number(u).toFixed(2)));
const tm = (t: unknown) => {
  const d = new Date(t as string);
  return isNaN(+d) ? String(t) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/** The header line (exHeader): one stat per part, in the legacy order. */
export function exHeader(H: J): DetailStat[] {
  const p: DetailStat[] = [];
  const add = (label: string, value: string, tone?: Tone) => p.push({ label, value, ...(tone ? { tone } : {}) });
  if (H.used != null || H.free != null) add("Slots", (H.used ?? "?") + " in use, " + (H.free ?? "?") + " free");
  if (Array.isArray(H.next) && H.next.length) add("Next", H.next.map((x: J) => x.fa + (x.title ? " " + short(x.title, 28) : "")).join(" "));
  if (H.sinceLandMin != null) add("Last landing", H.sinceLandMin + " min ago");
  if (H.queued != null) add("Commit queue", String(H.queued));
  if (H.overseer && H.overseer.at) {
    const o = H.overseer;
    add("Overseer", "snapshot " + tm(o.at) + ", " + (o.open ? o.open + " open finding" + (o.open === 1 ? "" : "s") : "no open findings"), o.open ? "r" : undefined);
  }
  const fx = Object.entries(H.remedies || {}),
    nf = Number(H.failed) || 0;
  add("Last 30 min", (nf ? nf + " failed" : "none failed") + (fx.length ? " · " + fx.map(([k, n]) => n + " " + k.replace(/-/g, " ")).join(", ") : ""), nf ? "r" : undefined);
  return p;
}

/** The footer (exFoot): the Halo client now, then today's totals. */
export function exFoot(T: J): string {
  const hv = T.haloVsPaid || {},
    en = T.engine || {},
    ln = T.lander || {},
    dr = T.doors || null,
    hz = T.halo;
  const hzT = hz
    ? "Halo client now: " +
      hz.n +
      " call" +
      (hz.n === 1 ? "" : "s") +
      (Object.keys(hz.byTier || {}).length ? " (" + Object.entries(hz.byTier).map(([k, v]) => k + " " + v).join(", ") + ")" : "") +
      (hz.unattributed ? ", " + hz.unattributed + " slot" + (hz.unattributed === 1 ? "" : "s") + " busy outside it" : "")
    : "";
  return (
    (hzT ? hzT + " · " : "") +
    "Today: " +
    [
      dr ? dr.n + " door runs (" + dr.halo + " on the Halo, " + dr.mac + " on the Mac, " + usdT(dr.usd) + ")" : "",
      T.subagent ? (T.subagent.n || 0) + " subagent runs" : "",
      en.n ? en.n + " engine runs (" + (en.halo || 0) + " on the Halo, " + (en.paid || 0) + " paid, " + usdT(en.usd) + ")" : "",
      ln.n != null ? ln.n + " landed (" + (ln.hot || 0) + " hot)" : "",
      hv.haloShare != null ? "Halo share of " + (hv.of || "steps") + " " + Math.round(100 * hv.haloShare) + "% (" + hv.halo + " of " + (hv.halo + hv.paid) + ")" : "Halo share of steps: none measured today",
    ]
      .filter(Boolean)
      .join(" · ")
  );
}

export const AGENT_COLUMNS = ["Worker", "Card", "Doing now", "Age of estimate", "Try · tier", "Host", "Cost"];

/** The pure half: home.officeShape -> the window. now is the server's clock (the age is now - the row's exact start). */
export function agentsWindow(S: J, at: number, ok: boolean, error?: string, now = Date.now()): WindowDetail {
  const W = S && S.who;
  if (!W || !Array.isArray(W.rows)) {
    return {
      id: "agents",
      title: "Who's working",
      tone: "d",
      headline: "Everyone working",
      sub: "",
      chips: [],
      at,
      ok: false,
      error: error || "The office shape is not in the home reading yet.",
      sections: [],
    };
  }
  const kinds: string[] = Array.isArray(W.groups) && W.groups.length ? W.groups : Object.keys(EX_KIND);
  const rows: DetailRow[] = [];
  for (const k of kinds) {
    const rs = W.rows.filter((x: J) => x && x.kind === k);
    for (const x of rs) {
      const step = String(x.step || x.state || "-");
      const st = Number(x.startedAt),
        hasSt = x.startedAt != null && Number.isFinite(st),
        ms = hasSt ? Math.max(0, now - st) : Number(x.ageMs) || 0;
      let age: { t: string; tone?: Tone; title?: string } = { t: "-" };
      if (ms && !x.name) age = { t: fineAge(ms), title: hasSt ? "started " + new Date(st).toLocaleTimeString() : undefined };
      else if (ms) {
        const est = Number(x.estMin) || 5,
          f = ms / (est * 60e3);
        age = { t: fineAge(ms), tone: f > 3 ? "r" : f > 1 ? "a" : undefined, title: fineAge(ms) + " of an estimate of " + est + " min (" + f.toFixed(1) + "x)" };
      }
      const nm = x.kind === "master" ? "Master" : x.name || EX_KIND[x.kind] || x.kind || "";
      const tier = x.tier || x.model || "-";
      const card = x.fa ? x.fa + " " + (x.cardKind && !x.name ? x.cardKind + " · " : "") + (x.title || "") : x.title || "-";
      rows.push({
        cells: [nm, card, step, age.title ? { t: age.t, ...(age.tone ? { tone: age.tone } : {}), title: age.title } : age.t, x.attempt ? "try " + x.attempt + " · " + tier : tier, x.host || "-", x.kind === "master" && !(Number(x.usd) > 0) ? "-" : usdT(x.usd)],
        ...(age.tone ? { tone: age.tone } : {}),
        find: [x.fa, x.title].filter(Boolean).join(" "),
      });
      for (const sa of Array.isArray(x.subagents) ? x.subagents : []) {
        rows.push({
          cells: ["Subagent" + (sa.type ? " · " + sa.type : ""), "↳ " + (sa.title || "subagent"), sa.state === "done" ? "done" : "running", sa.startedAt ? fineAge(Math.max(0, now - Number(sa.startedAt))) : "-", sa.model || "-", x.host || "-", "-"],
        });
      }
    }
  }
  const H = W.header || {};
  const failed = Number(H.failed) || 0;
  return {
    id: "agents",
    title: "Who's working",
    tone: failed ? "r" : W.rows.length ? "g" : "d",
    headline: "Everyone working: " + W.rows.length + (S.mode ? " · " + modeLabel(S.mode) : ""),
    sub: "longest-running first",
    chips: [],
    at,
    ok,
    error,
    sections: [
      { title: "Lane", kind: "stats", stats: exHeader(H) },
      { title: "Everyone working", kind: "table", columns: AGENT_COLUMNS, numeric: [6], rows, empty: "Nobody is working right now" },
      { title: "Today", kind: "text", text: exFoot(W.totals || {}) },
    ],
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get("home");
    return agentsWindow(r.data && r.data.officeShape, r.at, r.ok, r.error);
  } catch (e) {
    return agentsWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
