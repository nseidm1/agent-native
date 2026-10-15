/**
 * The card faces (cards.ts) and click windows (detail.ts) were written against
 * one combined state object. This assembles that object from the cockpit
 * client's bounded resources (client.ts), so the mappers stay as they are while
 * nothing reads the cockpit's internal snapshot any more (FA-19027). Each key
 * below names the resource it comes from; a resource that does not answer
 * leaves its keys absent, and the mappers already turn an absent key into a
 * "no data" card rather than a throw.
 */
import { getMany } from "./client.js";

type J = any;

/** The resources the 14 cards and their windows read. */
export const STATE_RESOURCES = [
  "status",
  "score",
  "modes",
  "jobs",
  "agents",
  "forge",
  "features",
  "orphans",
  "pipeline",
  "production",
  "appkpis",
  "syskpis",
  "board",
  "board/cards",
  "models",
  "halo",
  "halocaps",
  "halosave",
  "balancer",
  "hygiene",
  "events",
  "office",
] as const;

export interface StateRead {
  at: number;
  ok: boolean;
  error?: string;
  /** The assembled state (the last good copy of each resource is kept while the cockpit is away), or null before the first read. */
  j: J | null;
}

const omit = (o: J, ...k: string[]) => {
  if (!o || typeof o !== "object") return o;
  const c = { ...o };
  for (const x of [...k, "truncated"]) delete c[x];
  return c;
};

/** Board cards back in the board's own field names (col, pr, est), which the board window and face read. */
function boardCards(bc: J): J[] {
  const list: J[] = Array.isArray(bc && bc.cards) ? bc.cards : [];
  // kids is the board's own flag (hasOpenChildren as 1 or 0): some card that names this one as its parent is not yet released
  const kids = new Map<string, number>();
  for (const c of list) if (c.parentFa && c.column !== "released") kids.set(c.parentFa, 1);
  return list.map((c: J) => ({
    id: c.id,
    fa: c.fa,
    title: c.title,
    col: c.column,
    pr: c.priority,
    est: c.estimate,
    parent: c.parent,
    parentFa: c.parentFa,
    kids: kids.get(c.fa) || 0,
    children: c.children,
    links: c.links,
    paused: c.paused,
    triaged: c.triaged,
    blocked: c.blocked,
    chips: c.chips,
    app: c.app,
    laneStage: c.laneStage,
    at: c.at,
  }));
}

/** The combined object from resource data keyed by resource name. Pure, so a test can feed it fixtures. */
export function assemble(d: Record<string, J>, at = Date.now()): J {
  const j: J = { now: at };
  const st = d.status;
  if (st) j.status = omit(st, "lane");
  const fo = d.forge;
  if (fo) {
    j.status = j.status || {};
    j.status.forgeAutonomy = omit(fo, "fails");
    if (fo.fails) j.status.forgeFails = fo.fails;
  }
  const sc = d.score;
  if (sc) j.scorecard = { ...omit(sc, "landedRecent"), landedAll: sc.landedRecent };
  const mo = d.modes;
  if (mo) {
    if (j.scorecard && mo.scoreModes) j.scorecard.modes = mo.scoreModes;
    j.draftingModes = omit(mo, "scoreModes");
  }
  if (d.jobs) j.jobs = omit(d.jobs);
  if (d.agents) {
    j.agents = d.agents.agents;
    j.roster = d.agents.roster;
  }
  if (d.features) j.features = omit(d.features);
  if (d.orphans) j.orphans = omit(d.orphans);
  const pi = d.pipeline;
  if (pi) {
    j.cards = pi.cards;
    j.counts = pi.counts;
    j.workInv = pi.workInv;
    j.pipeline = { lanes: pi.lanes, label: pi.label, n: pi.n, awaitingRelease: pi.awaitingRelease, autoRelease: pi.autoRelease, stranded: pi.stranded, releaseAlert: pi.releaseAlert, apps: pi.apps, outOfScope: pi.outOfScope };
  }
  const pr = d.production;
  if (pr) {
    j.prodReleases = pr.releases;
    j.readiness = pr.readiness;
    j.appData = pr.appData;
  }
  if (d.appkpis) j.appKpis = omit(d.appkpis);
  if (d.syskpis) j.sysKpis = omit(d.syskpis);
  if (d.board) j.board = { ...omit(d.board), cards: boardCards(d["board/cards"]) };
  if (d.models) j.models = omit(d.models);
  if (d.halo) j.halo = omit(d.halo);
  if (d.halocaps) j.haloCaps = omit(d.halocaps);
  if (d.halosave) j.haloSavings = omit(d.halosave);
  if (d.balancer) j.balancer = d.balancer.data;
  if (d.hygiene) j.hygiene = omit(d.hygiene);
  if (d.events) j.events = d.events.events;
  if (d.office) j.office = d.office.data;
  return j;
}

let last: { refs: unknown[]; read: StateRead } | null = null;

/** The combined state from the client's resources; re-assembled only when a resource's etag moved. */
export async function getState(): Promise<StateRead> {
  try {
    const r = await getMany([...STATE_RESOURCES]);
    const anyData = Object.values(r.data).some((v) => v != null);
    if (!anyData) return { at: last ? last.read.at : Date.now(), ok: false, error: r.errors[0] || "cockpit unreachable", j: last ? last.read.j : null };
    // the client hands back the same data object until its etag moves, so identity says "nothing changed"
    const refs = STATE_RESOURCES.map((n) => r.data[n]);
    if (last && last.read.ok === r.ok && last.refs.every((x, i) => x === refs[i])) return last.read;
    const read: StateRead = { at: r.at, ok: r.ok, error: r.ok ? undefined : "cockpit: " + r.errors[0], j: assemble(r.data, r.at) };
    last = { refs, read };
    return read;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { at: last ? last.read.at : Date.now(), ok: false, error: "cockpit unreachable: " + msg, j: last ? last.read.j : null };
  }
}
