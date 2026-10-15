/**
 * FA-19133: Balancer savings, ported from the legacy renderBalancer (tools/lane/maint/ui/index.html): the $ saved
 * over all history and how far under the without-it spend that is, who did the work the balancer routed (a Halo
 * rung, Haiku, Sonnet, Opus, with the Halo's rungs beneath), who routed it, and the last 7 days. Reads the client's
 * balancer (data) and home (savedAll). No writes.
 */
import type { DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
import type { WindowBuilder } from "./registry.js";
import { balD, cell, type J, md, savedChip, table, text } from "./savings-common.js";

const COLS = ["Executor", "Units", "Saved $", "Spent $", "Missed"];

/** The pure half: the client's balancer data (its data.data) and home -> the window (exported for its spec). */
export function balancerWindow(c0: J, h0: J, at: number, ok: boolean, error?: string): WindowDetail {
  const c = c0 || { ok: false, txt: "no data yet", why: "the cockpit has no balancer yet", byExecutor: [], byWho: [], bars: [] };
  const a = ((h0 && h0.savedAll) || {}).balancer;
  const headline = a ? a.headline + " by the balancer · " + a.vs + " · " + a.sinceTxt : c.ok ? c.txt + " of Claude spend saved by the balancer (latest day)" : "Balancer savings data not available yet";
  const sa = (h0 && h0.savedAll) || {},
    lead = sa.balancerToday && sa.balancerToday.headline ? sa.balancerToday : sa.balancer;
  const good = lead ? lead.share > 0 : c.ok && c.share > 0;
  const line = (r: J): DetailRow => ({ cells: [String(r.name), String(r.units), balD(r.savedUsd), balD(r.actualUsd), String(r.misses)] });
  // the legacy table nests each executor's breakdown (the Halo's rungs) as "↳" rows under it; here each breakdown is its own small table
  const ex: J[] = (c.byExecutor || []) as J[];
  const within: DetailSection[] = ex
    .filter((r) => (r.detail || []).length)
    .map((r) =>
      table("Within " + r.name, ["Rung", "Units", "Saved $"], ((r.detail || []) as J[]).map((d) => ({ cells: [cell(String(d.name), { mono: true }), String(d.units), balD(d.savedUsd)] })), {
        numeric: [1, 2],
        sub: "which " + r.name + " did the " + r.units + " units",
      }),
    );
  const bars: J[] = c.bars || [];
  const mx = Math.max(1e-9, ...bars.map((b) => Math.max(0, b.usd || 0)));
  const sections: DetailSection[] = [];
  if (bars.length)
    sections.push({
      title: "Saved per day",
      sub: "last 7 days (UTC): the $ the balancer saved, and its share of that day's Claude spend",
      kind: "bars",
      bars: bars.map((b) => ({ label: md(Date.parse(b.day + "T12:00:00Z")), value: balD(b.usd), frac: Math.max(0, b.usd || 0) / mx, tone: (b.usd || 0) > 0 ? "g" : undefined, sub: undefined, title: ((b.share || 0) * 100).toFixed(1) + "% of Claude spend" })),
    });
  sections.push(
    table("By executor", COLS, ex.map(line), { numeric: [1, 2, 3, 4], sub: "who did the work the balancer routed: a Halo rung ($0), Haiku or Sonnet" }),
    ...within,
    table("By who routed", ["Routed by", ...COLS.slice(1)], ((c.byWho || []) as J[]).map(line), { numeric: [1, 2, 3, 4], sub: "master: a card's door run or routed spawn · roster: a tasking-ladder step" }),
    table("Per day · last 7 days", ["Day", "Saved $", "Share of Claude spend"], bars.slice().reverse().map((r) => ({ cells: [String(r.day), balD(r.usd), ((r.share || 0) * 100).toFixed(1) + "%"] })), { numeric: [1, 2] }),
  );
  if (c.ok)
    sections.push(
      text(
        "Source",
        "Source: run/balancer-backfill.json (estimate/balancer-backfill.mjs), since " + c.since + (c.at ? ", written " + String(c.at).slice(0, 16).replace("T", " ") + "Z" : "") +
          ". Share = saved / (saved + that day's Claude spend); a missed unit counts against the saving.",
      ),
    );
  return {
    id: "balancer",
    title: "Balancer savings",
    tone: good ? "g" : "a",
    headline,
    // the legacy balWhy: its setT sits inside a line comment in renderBalancer, so the legacy window never shows it
    sub: String(c.why || ""),
    chips: savedChip(h0, "balancer"),
    at,
    ok,
    error,
    sections,
  };
}

const build: WindowBuilder = async () => {
  const r = await getMany(["balancer", "home"]);
  const b = r.data.balancer;
  return balancerWindow(b && b.data ? b.data : null, r.data.home || {}, r.at, r.ok, r.ok ? undefined : r.errors.join("; ").slice(0, 300));
};
export default build;
