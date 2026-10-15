/**
 * FA-19132 / FA-19133: what the three savings windows (JEV + JevGrep, Halo savings, Balancer) share, ported from the
 * legacy page (tools/lane/maint/ui/index.html): the money and time formats, the "today against if it was off" figure
 * (savedPct), the one top-level KPI both JEV and Halo carry (claudeHead), the save forecast's line (fcLine) and the
 * per-day pairs the key tiles draw, here as "bars" sections. Pure.
 */
import type { DetailBar, DetailCell, DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import type { Tone } from "../../../shared/cockpit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type J = any;

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** the legacy $2 / d2: two decimals, a negative keeps its sign after the $ ("$-2.35") */
export const $2 = (x: unknown) => (x == null ? "n/a" : "$" + Number(x).toFixed(2));
export const n0 = (x: unknown) => (x == null ? "n/a" : String(x));
export const pl = (n: unknown, w: string) => (n ?? 0) + " " + w + (n === 1 ? "" : "s");
/** hsD: sub-cent amounts keep 3 decimals, a negative reads −$ */
export const hsD = (x: unknown) => {
  if (x == null || !isNum(Number(x))) return "n/a";
  const n = Number(x),
    v = Math.abs(n),
    t = v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2);
  return (n < 0 && +t ? "−$" : "$") + t;
};
export const hsShare = (x: unknown) => (!isNum(x) ? "n/a" : x > 0 && x < 0.001 ? "<0.1%" : (100 * x).toFixed(x < 0.1 ? 1 : 0) + "%");
export const balD = (v: unknown) => (!isNum(v) ? "n/a" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2));
/** the legacy md(): "Oct 15" in the machine's own zone */
export const md = (t: unknown) => {
  if (!t) return "";
  const d = new Date(t as string);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
/** the legacy hm(): 24-hour HH:MM in the machine's own zone */
export const hm = (t: unknown) => {
  if (!t) return "";
  const d = new Date(t as string);
  return isNaN(+d) ? "" : String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};
const fcPct = (x: unknown) => (x == null ? "n/a" : (100 * Number(x)).toFixed(1) + "%");

export const cell = (t: unknown, o: { tone?: Tone; mono?: boolean; title?: string } = {}): DetailCell => ({ t: String(t ?? ""), ...o });
export const row = (cells: DetailCell[], o: Partial<DetailRow> = {}): DetailRow => ({ cells, ...o });
export const table = (title: string, columns: string[], rows: DetailRow[], o: Partial<DetailSection> = {}): DetailSection => ({ title, kind: "table", columns, rows, empty: "none", ...o });
export const text = (title: string, t: string, o: Partial<DetailSection> = {}): DetailSection => ({ title, kind: "text", text: t, ...o });

/** savedPct: today against "if it was off" (savedAll.<part>Today) leads; all history when today cannot be computed */
export function savedPct(h0: J, part: "jev" | "halo" | "balancer") {
  const sa = (h0 && h0.savedAll) || {},
    tp = sa[part + "Today"],
    td = tp && tp.headline ? tp : null,
    a = td || sa[part];
  return a && a.headline ? { txt: String(a.headline), vs: a.vs as string | undefined, since: td ? "today" : String(a.sinceTxt || ""), today: Boolean(td), why: td ? (td.why as string) : null } : null;
}
/** the header chip: the figure the key tile leads with */
export const savedChip = (h0: J, part: "jev" | "halo" | "balancer") => {
  const sp = savedPct(h0, part);
  return sp ? [{ t: sp.today ? sp.txt : sp.txt + " " + sp.since }] : [];
};

/** claudeHead: the claude.savedShare KPI both the JEV and the Halo windows lead with, and this window's part of it */
export function claudeHead(sys: J, part: "jev" | "halo", fc: J) {
  const regs: J[] = ((sys && sys.groups) || []).flatMap((g: J) => g.rows || []);
  const R: Record<string, J> = {};
  for (const r of regs) R[r.id] = r;
  const k = R["claude.savedShare"],
    p = R["claude.savedShare." + part],
    name = part === "jev" ? "JEV" : "Halo";
  if (!k || !k.value) return { head: "Claude spend avoided by Halo + JEV: not measured yet", part: "", drivers: "", tone: "d" as Tone, backfill: "", value: "", target: "" };
  const rc = fc && fc.recent && fc.recent.days && fc.recent.claude > 0 ? fc.recent : null,
    t = rc || (fc && fc.total),
    ok = t && t.days && t.claude > 0,
    share = (x: number) => ((100 * x) / t.claude).toFixed(1) + "%";
  const together = ok ? (t.halo + t.jev) / t.claude : 0,
    perDay = rc ? rc.claude / rc.days : ((t && t.perDay) || {}).claude || 0;
  const backfill = !ok
    ? ""
    : "if online " + (rc ? "now (last " + t.days + " d)" : "(" + t.days + " d)") + ": " + name + " " + share(part === "jev" ? t.jev : t.halo) + ", together " + share(t.halo + t.jev) +
      ", " + (100 * Math.max(0, 0.5 - together)).toFixed(1) + " points short of 50% = $" + Math.round(Math.max(0, 0.5 - together) * perDay) + " a day";
  return {
    head: "Claude spend avoided by Halo + JEV: " + k.value + " (target " + (k.target || "50%") + ")",
    value: String(k.value),
    target: String(k.target || "50%"),
    part: name + " part: " + (p && p.value ? p.value : "not measured yet"),
    drivers: "drivers: " + (k.drivers || []).join(", "),
    tone: (k.tone || "d") as Tone,
    backfill,
  };
}
/** the legacy jvClaude/jvClaudeP and hsClaude/hsClaudeP paragraphs, as one text section (title + its value in the sub) */
export function claudeSection(sys: J, part: "jev" | "halo", fc: J): DetailSection {
  const c = claudeHead(sys, part, fc);
  const body = c.part + (c.drivers ? " · " + c.drivers : "") + (c.backfill ? " · " + c.backfill : "");
  return c.value
    ? text("Claude spend avoided by Halo + JEV", body, { sub: c.value + " (target " + c.target + ")" })
    : text("Claude spend avoided by Halo + JEV", body || "not measured yet", { sub: "not measured yet" });
}

/** fcLine: the save forecast's line for a part (the JEV tile's replay line, the Halo dialog's face) */
export function fcLine(F: J, part: "jev" | "halo"): string | null {
  const t = F && F.total;
  if (!t) return null;
  const share = part === "jev" ? t.jevShare : t.haloShare,
    per = part === "jev" ? (t.perDay || {}).jev : (t.perDay || {}).halo;
  const why =
    part === "jev"
      ? Object.entries(F.tier || {}).filter(([, m]: [string, J]) => !m.counted).map(([c]) => c).join(", ")
      : Object.entries(F.pi || {}).map(([a, m]: [string, J]) => a + " " + m.why).slice(0, 2).join("; ");
  const st =
    part === "halo" && t.stake
      ? " · at stake: ~$" + Math.round(t.stake.piworkPerDay || 0) + "/day of tasks once Pi's " +
        Object.entries(F.piwork || {}).filter(([, m]: [string, J]) => m.n || m.state === "live").map(([c, m]: [string, J]) => c + " " + m.pass + "/" + m.n).join(", ") +
        " clear 10 runs at 80%, ~$" + Math.round(t.stake.wholeRunPerDay || 0) + "/day of whole remedy and verification runs once Pi's agent replays pass"
      : "";
  const rn = F.recent && F.recent.days ? (part === "jev" ? F.recent.jevShare : F.recent.haloShare) : null;
  const vg = t.stake && t.stake.valueGate,
    cn = (x: number) => (x < 0.01 ? String(Math.round(x * 1e4) / 1e4) : String(Math.round(x * 100) / 100));
  const cl =
    part === "jev" && t.jevClients != null
      ? " · client scripts $" + cn(t.jevClients) + " (clientCache $" + cn(t.clientCache) + ", cadence $" + cn(t.cadence) + ", fallbackStop $" + cn(t.fallbackStop) + ", dedupe $" + cn(t.dedupe) + ")" +
        (vg ? " · value gate (shadow, not counted): would skip " + vg.wouldSkip + " of " + vg.items + " tidy items, $" + cn(vg.usd) + " at stake" : "")
      : "";
  const fr = part === "halo" && t.freed && t.freed.gpuS ? " · freed " + Math.round(t.freed.gpuS) + " Halo GPU-s (capacity, no $)" : "";
  const RT = F.retired || t.retired;
  const rt =
    part === "halo" && RT && RT.usd
      ? " · RETIRED since " + String(RT.at).slice(5, 16).replace("T", " ") + "Z (drafting left the Halo): $" + Math.round(RT.usd) + " of that is history (crafted $" + Math.round(RT.crafted || 0) +
        ", piwork $" + Math.round(RT.piwork || 0) + ", door draft verbs $" + Math.round(RT.uses || 0) + ", master xe test $" + Math.round((RT.masterTest || 0) * 100) / 100 + "), forward Halo $" +
        Math.round(t.haloForward != null ? t.haloForward : 0)
      : "";
  return (
    (rn != null ? "if online now (last " + F.recent.days + " d): " + fcPct(rn) + " · " : "") +
    "since " + md(F.since + "T12:00:00") + ": " + fcPct(share) + " of Claude $ (~$" + Math.round(per || 0) + "/day, replay of " + F.runs + " runs)" +
    (part === "jev"
      ? cl + (t.cap ? " · search cap ~$" + (t.capPerDay >= 1 ? Math.round(t.capPerDay) : t.capPerDay) + "/day (MI-101: door-run replay + live cuts)" : "") + (why ? " · not counted: " + why + " (bar not met)" : "")
      : (share ? "" : " · nothing built clears its bar yet" + (why ? ": " + why : "")) + st + rt + fr)
  );
}

/**
 * The key tile's per-day pairs as a bars section: per day a solid "live" bar (green) and the
 * counterfactual beside it (sky), on one scale - side by side, never added, as the tile draws them.
 */
export function pairBars(title: string, days: { label: string; live: number | null; other: number | null }[], names: [string, string], fmt: (x: number | null) => string, sub?: string): DetailSection {
  const mx = Math.max(1e-9, ...days.map((d) => Math.max(d.live || 0, d.other || 0)));
  const bars: DetailBar[] = [];
  for (const d of days) {
    bars.push({ label: d.label + " · " + names[0], value: fmt(d.live), frac: (d.live || 0) / mx, tone: "g" });
    bars.push({ label: d.label + " · " + names[1], value: fmt(d.other), frac: (d.other || 0) / mx });
  }
  return { title, kind: "bars", bars, empty: "no days yet", ...(sub ? { sub } : {}) };
}
