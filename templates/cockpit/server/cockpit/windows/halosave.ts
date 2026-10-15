/**
 * FA-19133: Halo savings, ported from the legacy renderHaloSave (tools/lane/maint/ui/index.html, with hsCard, fcHalo
 * and renderClaude): the Claude-spend KPI the Halo shares with JEV, today's net saving and its pricing, the face line
 * (net of power, the forecast, shadow and load), avoided / power / net / shadow today and cumulative, the Halo's
 * electricity, every use live or shadow with its agreement, and the last 7 days. Reads the client's halosave, home
 * (saveForecast, savedAll) and syskpis. No writes.
 */
import type { DetailSection } from "../../../shared/cockpit-detail.js";
import type { Tone } from "../../../shared/cockpit.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
import type { WindowBuilder } from "./registry.js";
import { cell, claudeSection, fcLine, hm, hsD, hsShare, type J, md, pairBars, row, savedChip, savedPct, table, text } from "./savings-common.js";

type Bar = { day: string; live: number; shadow: number };

/** hsCard: today's net saving on the Halo (Claude $ avoided − the box's power), the face lines and the 7-day bars */
export function hsCard(h: J) {
  if (!h || !h.live || !h.shadow)
    return { ok: false, val: "no data yet", head: "Halo savings data not available yet", a: "the cockpit has no haloSavings yet", s: "would save if live: no data yet", l: "", tone: "d" as Tone, bars: [] as Bar[] };
  const P = h.power && typeof h.power === "object" ? h.power : null,
    pw = P && P.measured ? P.today.box.usd : null,
    net = h.net && h.net.today != null ? h.net.today : null;
  const calls = h.live.callsToday ?? 0,
    val = hsD(net != null ? net : h.live.today);
  const a = "Claude " + hsD(h.live.today) + " avoided" + (pw != null ? " − power " + hsD(pw) : P ? " · power not measured yet" : " · power not counted") + " · " + calls + " local call" + (calls === 1 ? "" : "s") + " today";
  const s = "would save if live: " + hsD(h.shadow.today) + " today (shadow, not counted)";
  const l = "load off Claude today: " + hsShare(h.load && h.load.liveShareToday) + " of lane model work · " + hsD(h.live.cumulative) + " live since the first row";
  const head = net != null ? hsD(net) + " saved today on the Halo (Claude " + hsD(h.live.today) + " avoided − power " + hsD(pw) + ")" : h.headline || hsD(h.live.today) + " saved today on the Halo";
  return { ok: true, val, head, a, s, l, tone: ((net != null ? net : h.live.today) > 0 ? "g" : "a") as Tone, bars: ((h.bars || []) as J[]).map((b) => ({ day: String(b.day), live: b.live || 0, shadow: b.shadow || 0 })) };
}
/** fcHalo: the forecast's line leads the shadow line, and each day's hatched bar is the replay's Halo $ where it has that day */
export function fcHalo(c: ReturnType<typeof hsCard>, F: J): ReturnType<typeof hsCard> {
  if (!c || !F || !F.total) return c;
  const line = fcLine(F, "halo") || "";
  if (!c.ok) return { ...c, s: line };
  const by = new Map<string, number>(((F.days || []) as J[]).map((d) => [d.day, (d.halo || {}).usd]));
  return { ...c, s: line + " · " + c.s.replace(/^would save if live: /, "shadow "), bars: c.bars.map((b) => (by.has(b.day) ? { ...b, shadow: by.get(b.day) || 0 } : b)) };
}

const hsRange = (x: J) => (x ? hsD(x.usd) + " [" + hsD(x.lo) + "–" + hsD(x.hi) + "]" : "n/a");
const dmR = (x: J) => (x && x.n ? Math.round(100 * x.p) + "% (" + x.k + "/" + x.n + ") [" + Math.round(100 * x.lo) + "–" + Math.round(100 * x.hi) + "%]" : "n=0");
const hsAgree = (a: J) => (a ? a.what + ": " + dmR(a) : "no agreement measured");
const fx = (x: J, d: number) => (typeof x === "number" ? x.toFixed(d) : "n/a");

/** The pure half: the client's halosave, home and syskpis data -> the window (exported for its spec). */
export function halosaveWindow(h: J, h0: J, sys: J, at: number, ok: boolean, error?: string): WindowDetail {
  const F = h0 && h0.saveForecast,
    c = hsCard(h),
    P = h && h.power && typeof h.power === "object" ? h.power : null;
  // the face line, as the tile writes it into the dialog: net of power first, the forecast, then the load
  const t = fcHalo(hsCard(h), F),
    sp = savedPct(h0, "halo");
  const face = [sp ? t.val + " net of power · " + t.a : t.a, t.s, t.l].filter(Boolean).join(" · ");
  const sections: DetailSection[] = [claudeSection(sys, "halo", F)];
  if (t.bars.length)
    sections.push(
      pairBars(
        "Per day · live and would save if live",
        t.bars.map((b) => ({ label: md(Date.parse(b.day + "T12:00:00Z")), live: b.live, other: b.shadow })),
        ["live", "if live"],
        (x) => hsD(x),
        "live: Claude $ avoided on the Halo · if live: the forecast's Halo $ for that day (the shadow where it has none) - never added to live",
      ),
    );
  const rp = { tone: "d" as Tone };
  const sum = c.ok
    ? [
        ["Claude $ avoided (live uses that earned live)", hsD(h.live.today), hsD(h.live.cumulative)],
        ["Power $ (the whole box)", P && P.measured ? hsRange(P.today.box) : P ? "not measured yet" : String(h.power || "not counted"), P && P.measured ? hsRange(P.cumulative.box) : ""],
        ["Net saved (avoided − power)", h.net ? hsD(h.net.today) : "n/a", h.net ? hsD(h.net.cumulative) : "n/a"],
        ["Live calls handled on the Halo", String(h.live.callsToday ?? "n/a"), h.live.calls + " calls · " + h.live.tokens + " tokens"],
        ["Load off Claude: share of lane model work done live on the Halo", hsShare(h.load && h.load.liveShareToday) + " of " + hsD(h.load && h.load.claudeUsdToday), hsShare(h.load && h.load.liveShareOfSpend) + " of " + hsD(h.load && h.load.claudeUsd)],
        ["Shadow: would save if live (never added to live)", hsD(h.shadow.today), hsD(h.shadow.cumulative) + " · " + h.shadow.calls + " calls · " + h.shadow.tokens + " tokens"],
      ]
    : [];
  sections.push(
    table("Claude $ avoided, power and shadow", ["", "Today", "Cumulative"], sum.map((r) => (/^Shadow/.test(r[0]) ? row([r[0], cell(r[1], rp), cell(r[2], rp)]) : row(r))), {
      numeric: [1, 2],
      sub: "today (UTC day) and cumulative",
    }),
  );
  const pr = P
    ? [
        ["Electricity rate", "$" + fx(P.rate && P.rate.usdPerKwh, 3) + "/kWh used (range $" + fx(P.rate && P.rate.lo, 2) + "–$" + fx(P.rate && P.rate.hi, 2) + "/kWh) · " + ((P.rate && P.rate.source) || "")],
        ["Package power now (APU: CPU + GPU, not wall)", P.latest ? fx(P.latest.w, 1) + " W at " + hm(P.latest.at) + (P.latest.busy != null ? " · " + P.latest.busy + " model slots busy" : "") : "no sample yet"],
        ["Idle draw (no model slot busy)", P.idle && P.idle.w != null ? fx(P.idle.w, 1) + " W · " + P.idle.label : (P.idle && P.idle.label) || "n/a"],
        ["Measured today", P.today ? fx(P.today.hours, 2) + " h · " + fx(P.today.kwhPackage, 3) + " kWh package · " + P.today.samples + " samples" : "n/a"],
        ["Box $ today (whole box)", hsRange(P.today && P.today.box)],
        ["Model-work share today (watts above idle while busy)", P.today && P.today.modelWork ? hsRange(P.today.modelWork) : "needs the idle draw"],
        ["Wall overhead", (P.overhead || {}).factor + "x · " + (P.overhead || {}).label],
        ["How", P.label + " · " + P.source],
      ]
    : [
        ["Power", String((h && h.power) || "not counted")],
        ["Electricity rate (console ~13:40Z)", "$0.145/kWh (range $0.14–$0.15/kWh): applied once the cockpit samples the Halo's package power"],
      ];
  sections.push(table("Power: the Halo's electricity", ["What", "Measured"], c.ok ? pr.map((r) => row(r)) : []));
  const us: J[] = c.ok ? h.uses || [] : [];
  sections.push(
    table(
      "Per use: live or shadow, and agreement with the Claude call it replaces",
      ["Use", "Model", "Replaces", "State", "Live calls", "Live $ avoided", "Shadow calls", "Would save if live"],
      us.map((u) =>
        row(
          [
          cell(u.job, { mono: true, ...(u.basis ? { title: String(u.basis) } : {}) }),
          u.model || "-",
          u.replaces || "no Claude call",
          cell(u.state, /^live$/.test(u.state) ? { tone: "g" } : {}),
          String((u.live || {}).n),
          u.replaces ? hsD((u.live || {}).usd) : "-",
          String((u.shadow || {}).n),
          cell(u.replaces ? hsD((u.shadow || {}).usd) : "-", rp),
          ],
          // the agreement with the incumbent, the legacy table's last column, on the row's second line
          { note: hsAgree(u.agreement) },
        ),
      ),
      { numeric: [4, 5, 6, 7] },
    ),
  );
  const un = c.ok ? [h.unearned && h.unearned.label + ": " + hsD(h.unearned.usd), h.lab && h.lab.label + ": " + h.lab.rows + " rows"].filter(Boolean).join(" · ") : "";
  if (un) sections.push(text("Not counted", un));
  const pd: Record<string, number> = Object.fromEntries(((P && P.bars) || []).map((b: J) => [b.day, b.usd]));
  sections.push(
    table(
      "Per day · last 7 days",
      ["Day", "Live $ avoided", "Would save if live (shadow)", "Power $ (box)"],
      c.ok ? c.bars.slice().reverse().map((b) => row([b.day, hsD(b.live), cell(hsD(b.shadow), rp), pd[b.day] != null ? hsD(pd[b.day]) : "not measured"])) : [],
      { numeric: [1, 2, 3] },
    ),
  );
  const src = c.ok && h.sources ? "Sources: " + h.sources.join(" · ") + (h.at ? " · computed " + hm(h.at) : "") : "";
  if (src) sections.push(text("Sources", src));
  return {
    id: "halosave",
    title: "Halo savings",
    tone: c.tone,
    headline: c.head,
    sub: c.ok ? (h.pricing || "") + (h.net && h.net.label ? " · net = " + h.net.label : "") : c.a,
    chips: savedChip(h0, "halo"),
    lead: face,
    at,
    ok,
    error,
    sections,
  };
}

const build: WindowBuilder = async () => {
  const r = await getMany(["halosave", "home", "syskpis"]);
  return halosaveWindow(r.data.halosave, r.data.home || {}, r.data.syskpis || {}, r.at, r.ok, r.ok ? undefined : r.errors.join("; ").slice(0, 300));
};
export default build;
