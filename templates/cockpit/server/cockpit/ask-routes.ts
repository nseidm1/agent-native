/**
 * THE ROUTING KPI of the Ask agent (FA-19087; CLAUDE.md: every saving ships
 * with its KPI and its backfill; the RSI hallmark: the loop measures itself so
 * it can tune itself). Every ask appends one row to ask-routes.jsonl in the
 * region's state (the data dir): the classifier's parts, the path each part
 * finally took (its trail: layout -> change when it escalated) and its outcome
 * at ask time. An applied change's outcome is resolved when the KPI is read,
 * from its job record (live, failed, no-change, needs-system, undone).
 *
 * A request counts as MISROUTED when any of these says the first label was wrong:
 *   escalated          a part had to move to a stronger path (layout -> change)
 *   needs-system       the code agent found its change needs the system side
 *   dead-end           a layout run changed nothing, or the code agent changed nothing
 *   undone             the applied change was undone
 *   re-asked           the same request came again within 10 minutes
 *   classifier-failed  the classifier did not answer; the read default ran
 *
 * BACKFILL: ask-agent.log (one line per ask since FA-18951, kind only) is read
 * for the asks before the first route row, with the signals it can carry
 * (dead-end, needs-system, undone, re-asked); escalation did not exist then.
 * Pure apart from routesFile/readRows/appendRoute.
 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import type { PartKind } from "./classify.js";

export const ROUTES_FILE = "ask-routes.jsonl";
export const REASK_WINDOW_MS = 10 * 60_000;
export const MISROUTE_REASONS = ["escalated", "needs-system", "dead-end", "undone", "re-asked", "classifier-failed"] as const;
export type MisrouteReason = (typeof MISROUTE_REASONS)[number];

/** The path a part finally ran on. */
export type RoutePath = "layout" | "read" | "change" | "filed" | "board";
export interface RoutePart {
  kind: PartKind;
  path: RoutePath;
  /** The paths tried in order; more than one is an escalation. */
  trail: RoutePath[];
  /** At ask time: moved | unchanged | answered | applying | filed | offered | needs-pairing | refused */
  outcome: string;
  job?: string;
  card?: string;
  fa?: string;
  action?: string;
}
export interface RouteRow {
  at: string;
  q: string;
  ok: boolean;
  canApply?: boolean;
  parts: RoutePart[];
  backfill?: boolean;
}

export const routesFile = (dir: string) => path.join(dir, ROUTES_FILE);

export async function appendRoute(dir: string, row: RouteRow): Promise<void> {
  await appendFile(routesFile(dir), JSON.stringify(row) + "\n").catch(() => {});
}

export async function readRows(file: string): Promise<Record<string, unknown>[]> {
  const txt = await readFile(file, "utf8").catch(() => "");
  const out: Record<string, unknown>[] = [];
  for (const l of txt.split("\n")) {
    if (!l.trim()) continue;
    try {
      const o = JSON.parse(l);
      if (o && typeof o === "object") out.push(o);
    } catch {
      // a torn line is skipped, never fatal
    }
  }
  return out;
}

/** ask-agent.log lines (before the first route row) as backfilled route rows. Pure. */
export function backfillRows(log: Record<string, unknown>[], before?: string): RouteRow[] {
  const cut = before ? Date.parse(before) : Infinity;
  const out: RouteRow[] = [];
  for (const l of log) {
    const at = typeof l.time === "string" ? l.time : "";
    if (!at || !(Date.parse(at) < cut) || typeof l.question !== "string") continue;
    if (l.error && !l.kind) continue; // refused before classifying (busy, bad input): not a routing decision
    const kind = (typeof l.kind === "string" ? l.kind : "read") as PartKind;
    const filed = typeof l.card === "string";
    const p: RoutePart = filed
      ? { kind, path: "filed", trail: ["filed"], outcome: "filed", card: l.card as string }
      : kind === "change" && typeof l.job === "string"
        ? { kind, path: "change", trail: ["change"], outcome: "applying", job: l.job }
        : kind === "layout"
          ? { kind, path: "layout", trail: ["layout"], outcome: l.layoutChanged ? "moved" : "unchanged" }
          : { kind, path: "read", trail: ["read"], outcome: "answered" };
    out.push({ at, q: l.question, ok: true, parts: [p], backfill: true });
  }
  return out;
}

const STOP = new Set("the and for with that this from into only just then them its it's are was what when where which while have has had you your our can could would should please also very".split(" "));
export function tokens(q: string): Set<string> {
  return new Set(
    q
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}
/** Jaccard similarity of two requests' content words. */
export function similarity(a: string, b: string): number {
  const A = tokens(a),
    B = tokens(b);
  if (!A.size || !B.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
export const REASK_SIMILARITY = 0.5;

export type JobStatusOf = (id: string) => string | null;

/** The outcome of an applied change, resolved from its job: applied, failed, no-change, needs-system, undone, or still applying. */
export function resolveOutcome(p: RoutePart, jobStatus: JobStatusOf): string {
  if (p.path !== "change" || !p.job) return p.outcome;
  const s = jobStatus(p.job);
  return s === "live" ? "applied" : s === "running" || !s ? "applying" : s;
}

/** Why one row was misrouted (empty when it was not). rows must be in time order; i is this row's index. Pure. */
export function misrouteReasons(rows: RouteRow[], i: number, jobStatus: JobStatusOf): MisrouteReason[] {
  const r = rows[i];
  const why = new Set<MisrouteReason>();
  if (!r.ok) why.add("classifier-failed");
  for (const p of r.parts) {
    if (p.trail.length > 1) why.add("escalated");
    const o = resolveOutcome(p, jobStatus);
    if (o === "needs-system") why.add("needs-system");
    if (o === "undone") why.add("undone");
    if ((p.path === "layout" && o === "unchanged") || o === "no-change") why.add("dead-end");
  }
  const t = Date.parse(r.at);
  for (let j = i + 1; j < rows.length; j++) {
    const dt = Date.parse(rows[j].at) - t;
    if (dt > REASK_WINDOW_MS) break;
    if (dt >= 0 && similarity(r.q, rows[j].q) >= REASK_SIMILARITY) {
      why.add("re-asked");
      break;
    }
  }
  return MISROUTE_REASONS.filter((x) => why.has(x));
}

export interface RouteKpi {
  /** misrouted / asks, 0..1; null with no asks */
  rate: number | null;
  asks: number;
  misrouted: number;
  reasons: Record<MisrouteReason, number>;
  /** the same over rows written since the parts classifier (no backfill) */
  live: { rate: number | null; asks: number; misrouted: number };
  /** the same over the backfilled ask-agent.log history */
  backfill: { rate: number | null; asks: number; misrouted: number };
  /** how many requests were split into more than one part */
  split: number;
  recent: { at: string; q: string; paths: string[]; misrouted: MisrouteReason[] }[];
}

/** The KPI over every row (time-ordered here). Pure. */
export function routeKpi(rowsIn: RouteRow[], jobStatus: JobStatusOf, recentN = 8): RouteKpi {
  const rows = [...rowsIn].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const reasons = Object.fromEntries(MISROUTE_REASONS.map((k) => [k, 0])) as Record<MisrouteReason, number>;
  const tally = { all: [0, 0], live: [0, 0], backfill: [0, 0] };
  const per = rows.map((r, i) => {
    const why = misrouteReasons(rows, i, jobStatus);
    for (const w of why) reasons[w]++;
    const bad = why.length ? 1 : 0;
    tally.all[0]++;
    tally.all[1] += bad;
    const k = r.backfill ? "backfill" : "live";
    tally[k][0]++;
    tally[k][1] += bad;
    return { r, why };
  });
  const rate = ([n, m]: number[]) => (n ? Math.round((m / n) * 1000) / 1000 : null);
  return {
    rate: rate(tally.all),
    asks: tally.all[0],
    misrouted: tally.all[1],
    reasons,
    live: { rate: rate(tally.live), asks: tally.live[0], misrouted: tally.live[1] },
    backfill: { rate: rate(tally.backfill), asks: tally.backfill[0], misrouted: tally.backfill[1] },
    split: rows.filter((r) => r.parts.length > 1).length,
    recent: per
      .slice(-recentN)
      .reverse()
      .map(({ r, why }) => ({ at: r.at, q: r.q.slice(0, 120), paths: r.parts.map((p) => p.trail.join(">") + ":" + resolveOutcome(p, jobStatus)), misrouted: why })),
  };
}

/** The KPI from the data dir: ask-routes.jsonl plus the ask-agent.log backfill before it. */
export async function readRouteKpi(dir: string, jobStatus: JobStatusOf): Promise<RouteKpi> {
  const routes = (await readRows(routesFile(dir))).filter((r): r is RouteRow & Record<string, unknown> => typeof r.at === "string" && Array.isArray(r.parts)) as RouteRow[];
  const first = routes.length ? routes.map((r) => r.at).sort()[0] : undefined;
  const back = backfillRows(await readRows(path.join(dir, "ask-agent.log")), first);
  return routeKpi([...back, ...routes], jobStatus);
}
