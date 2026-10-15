/**
 * Maps the cockpit's FULL /api/state (about 1.2 MB) to the compact card model
 * (a few KB). The words follow the cockpit's own tile renderers, headers(j)
 * and tileArt(j) in tools/lane/maint/ui/index.html, so a card here says what
 * the tile it replaces said. Each card is built on its own: a missing or odd
 * field gives that card tone 'd' and "no data", never a throw.
 */
import {
  CARD_IDS,
  CARD_TITLES,
  type CardId,
  type CardMeter,
  type CardsResult,
  type CockpitCard,
  type Tone,
} from "../../shared/cockpit.js";

// The state is untyped JSON from another process; read it defensively.
type J = any;

interface Face {
  tone: Tone;
  headline: string;
  sub?: string;
  chip?: string;
  spark?: number[];
  meters?: CardMeter[];
}

const usd = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? "$" + x.toFixed(2) : "n/a");
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
const pctOf = (v: number, t: number) => (t > 0 ? Math.max(0, Math.min(100, Math.round((100 * v) / t))) : 0);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const wkPct = (p: number | null) =>
  p == null || !Number.isFinite(p) ? "n/a" : p >= 10 ? Math.round(p) + "%" : p >= 1 ? p.toFixed(1) + "%" : p.toFixed(2) + "%";
const minTxt = (m: number) => (m < 60 ? Math.round(m) + " min" : m < 1440 ? (m / 60).toFixed(1) + " h" : (m / 1440).toFixed(1) + " d");
const asTone = (c: unknown, fallback: Tone = "g"): Tone =>
  c === "g" || c === "a" || c === "r" || c === "d" ? c : c === "s" || c === "v" ? "g" : fallback;

function bc(j: J): Record<string, number> {
  const B = j.board || {};
  if (B.counts && typeof B.counts === "object") return B.counts;
  const out: Record<string, number> = {};
  for (const c of B.cards || []) out[c.col] = (out[c.col] || 0) + 1;
  return out;
}

const FACES: Record<CardId, (j: J, now: number) => Face> = {
  score: (j) => {
    const sc = j.scorecard;
    if (!sc || typeof sc !== "object") throw new Error("no scorecard");
    if (num(sc.landed) == null && !(sc.units && sc.units.today)) throw new Error("no landed count");
    const landed = num(sc.landed) ?? 0;
    const v = sc.velocity;
    const fph = v ? num(v.finishedPerHour) : null;
    const rows = ((j.sysKpis || {}).groups || []).flatMap((g: J) => g.rows || []);
    const tRow = rows.find((r: J) => r.id === "velocity.finishedPerHour");
    const fT = tRow && tRow.target ? parseFloat(String(tRow.target).replace(/[^0-9.-]/g, "")) : null;
    const u = sc.units && sc.units.today;
    const spark = Array.isArray(sc.byHour) && sc.byHour.length ? sc.byHour.map((x: unknown) => num(x) ?? 0) : undefined;
    const busiest = spark ? Math.max(0, ...spark) : 0;
    return {
      tone: !(u && u.n) && !landed ? "r" : fph != null && fT != null && fph < fT ? "a" : "g",
      headline: landed + " released today",
      sub: (u ? u.n + " units today" : landed + " cards today") + (busiest ? " · busiest hour " + busiest : ""),
      chip: (fph == null ? "n/a" : fph + " units/hour") + (fT != null && Number.isFinite(fT) ? " · target " + fT : ""),
      spark,
    };
  },
  pipeline: (j) => {
    const P = j.pipeline;
    if (!P || !P.lanes) throw new Error("no pipeline lanes");
    const S = P.lanes.system || {};
    const s = S.steps || {};
    const al = P.releaseAlert || [];
    const sub =
      "System: writing " + (s.writing || 0) + " › review " + (s.review || 0) + " › ship " + (s.ship || 0) +
      (s.blocked ? " · " + s.blocked + " stuck" : "") + (s.queued ? " · " + s.queued + " queued" : "");
    return {
      tone: al.length || s.blocked ? "a" : s.writing || s.review || s.ship ? "g" : "d",
      headline: String(P.lanes.headline || P.label || "no data"),
      sub,
      chip: al.length
        ? al[0].fa + " waiting " + al[0].ageMin + " min" + (al.length > 1 ? " (+" + (al.length - 1) + ")" : "")
        : "auto-release " + (S.autoRelease === false ? "off" : "on"),
    };
  },
  production: (j) => {
    const rs: J[] = Array.isArray(j.prodReleases) ? j.prodReleases : [];
    if (!rs.length) return { tone: "d", headline: "Reading the apps", sub: "no app release state yet", chip: "no data" };
    const n = (k: string) => rs.filter((r) => r.state === k).length;
    const err = n("error");
    const ahead = rs.filter((r) => r.ahead).length;
    const live = rs.filter((r) => r.state !== "error" && r.prod && r.prod.sha).length;
    const w: [string, Tone] = n("fingerprint")
      ? [n("fingerprint") + " awaiting your fingerprint", "a"]
      : n("ready")
        ? [n("ready") + " ready to promote", "g"]
        : n("making") + n("promoting")
          ? [n("making") + n("promoting") + " being made ready", "g"]
          : ahead
            ? [ahead + " ahead of production", "a"]
            : err
              ? ["open the app to see why", "r"]
              : [n("published") + " published", "g"];
    return {
      tone: err ? "r" : n("fingerprint") || n("ready") || ahead ? "a" : "g",
      headline: live + " of " + pl(rs.length, "app") + " live",
      sub: w[0],
      chip: err ? err + " unavailable" : n("published") + " published",
    };
  },
  board: (j) => {
    const B = j.board;
    if (!B) throw new Error("no board");
    if (B.err) return { tone: "r", headline: "Unreachable", sub: "can't reach the board", chip: String(B.err).slice(0, 40) };
    const c = bc(j);
    const open = ["in-progress", "todo", "pending", "reopened", "recommendations"].reduce((a, k) => a + (c[k] || 0), 0);
    return {
      tone: c.reopened ? "a" : c["in-progress"] ? "g" : "d",
      headline: open + " open cards",
      sub: c.reopened ? c.reopened + " blocked, waiting on you" : (c["in-progress"] || 0) + " being worked",
      chip: (c["in-progress"] || 0) + " in progress · " + (c.todo || 0) + " to do",
    };
  },
  jobs: (j) => {
    const jb = j.jobs;
    if (!jb || !Array.isArray(jb.live)) return { tone: "d", headline: "Unavailable", sub: "job list unavailable", chip: "no data" };
    const jr = jb.live.filter((x: J) => x.state === "running");
    const jw = jb.live.filter((x: J) => x.state === "waiting");
    const jl = (jb.finished || [])[0];
    return {
      tone: jr.length ? "g" : jl && jl.outcome === "failed" ? "a" : "d",
      headline: jr.length ? jr.length + " running" : "Idle",
      sub: (jb.todayN ?? 0) + " finished today · " + usd(jb.todayUsd),
      chip: jl ? "last: " + jl.outcome + " · " + jl.who : jw.length ? jw.length + " waiting" : "no recent job",
    };
  },
  forge: (j, now) => {
    const F = (j.status || {}).forgeAutonomy;
    if (!F) return { tone: "d", headline: "Not measured yet", sub: "the forge writes run/forge-autonomy.json each pass", chip: "no data" };
    const age = now - Date.parse(F.at);
    if (!(age <= 10 * 60e3)) {
      return { tone: "d", headline: "Stale", sub: "not updated for " + minTxt(age / 60e3), chip: "stale" };
    }
    const T = F.today || {};
    const rate = num(T.rate);
    const past = (F.rows || []).reduce((n: number, r: J) => n + (r.open || []).filter((o: J) => o.past).length, 0);
    const trend = Array.isArray(F.trend) ? F.trend.map((d: J) => (num(d.rate) == null ? 0 : Math.round(100 * d.rate))) : undefined;
    return {
      tone: F.tone === "r" ? "r" : rate == null ? "d" : rate >= 0.8 ? "g" : "a",
      headline: rate == null ? "Nothing found today" : "Fixed by itself: " + Math.round(100 * rate) + "%",
      sub: (T.auto ?? 0) + " of " + (T.detected ?? 0) + " found today · " + (past ? past + " past target" : "none past target"),
      chip: F.toneWhy ? String(F.toneWhy) : (F.fixing ?? 0) + " being fixed",
      spark: trend && trend.length > 1 ? trend : undefined,
    };
  },
  orphans: (j) => {
    const o = j.orphans;
    if (!o || !o.running) return { tone: "d", headline: "Ledger not running yet", sub: "waiting for run/orphans.json", chip: "no data" };
    const ws = o.ws;
    const orphaned = ws ? ws.orphaned.n : o.orphans || 0;
    const stuck = ws ? (ws.stuck.items || []).length : 0;
    const files = ws ? ws.inProgress.files : o.inFlight || 0;
    const oldest = ws ? ws.orphaned.oldestMin : o.oldestMin || 0;
    const stale = o.ageS != null && o.ageS > 1800;
    if (!stuck && !orphaned && !files && !o.stranded) {
      return { tone: "d", headline: "Nothing open", sub: "no stuck, unlanded or in-progress work", chip: "quiet" };
    }
    return {
      tone: stuck || o.stranded ? "r" : orphaned ? "a" : "g",
      headline: stuck ? stuck + " stuck" + (orphaned ? " · " + orphaned + " unlanded" : "") : orphaned ? orphaned + " unlanded" : "All work in progress",
      sub: files + " in progress" + (orphaned ? " · oldest " + minTxt(oldest) : ""),
      chip: stale ? "ledger last ran " + minTxt(o.ageS / 60) + " ago" : o.stranded ? o.stranded + " stranded" : "ledger current",
    };
  },
  hygiene: (j) => {
    const hy = j.hygiene;
    if (!hy || !hy.relevance) throw new Error("no hygiene");
    const secs = hy.relevance.sections || [];
    const arch = (secs.find((x: J) => /archive/i.test(x.name)) || {}).n || 0;
    const dec = (secs.find((x: J) => /master/i.test(x.name)) || {}).n || 0;
    const ac = hy.awaitingChip || { t: "…", c: "g" };
    const rc = hy.refusedChip || { t: "…", c: "g" };
    const pf = (hy.preflightBlocked || []).length;
    const rows: [boolean, string][] = [
      [rc.c === "g", rc.t],
      [ac.c === "g", ac.t],
      [!pf, pf ? pf + " need details" : "cards have details"],
      [!dec, dec ? dec + " need a decision" : "no decisions waiting"],
      [!arch, arch ? arch + " could be archived" : "nothing to archive"],
    ];
    const bad = rows.filter((r) => !r[0]);
    return {
      tone: ac.c === "r" || rc.c === "r" ? "r" : bad.length ? "a" : "g",
      headline: bad.length ? bad.length + " to tidy" : "All tidy",
      sub: (bad.length ? bad : rows).slice(0, 2).map((r) => r[1]).join(" · "),
      chip: "relevance " + (hy.relevance.apply ? "applies" : "preview only"),
    };
  },
  events: (j, now) => {
    const ev: J[] = Array.isArray(j.events) ? j.events : [];
    if (!ev.length) return { tone: "d", headline: "Nothing yet", sub: "no events recorded", chip: "no data" };
    const hr = ev.filter((e) => now - e.at < 3600e3).length;
    const latest = ev.reduce((m, e) => Math.max(m, num(e.at) ?? 0), 0);
    const bad = ev.slice(0, 20).some((e) => e.cls === "bad" || e.cls === "error");
    // the events bucketed into the last 12 five-minute slots, oldest first
    const spark = Array.from({ length: 12 }, (_, i) => {
      const to = now - (11 - i) * 300e3;
      return ev.filter((e) => e.at <= to && e.at > to - 300e3).length;
    });
    return {
      tone: bad ? "a" : hr ? "g" : "d",
      headline: hr + " events this hour",
      sub: latest ? "latest " + new Date(latest).toISOString().slice(11, 19) + "Z" : "no timestamps",
      chip: pl(ev.length, "event") + " in the feed",
      spark: spark.some(Boolean) ? spark : undefined,
    };
  },
  models: (j) => {
    const sc = j.scorecard || {};
    const sp = sc.spend || {};
    const T: J[] = sp.tiers || [];
    if (!T.length && sp.total == null) throw new Error("no spend");
    const tot = T.reduce((a, t) => a + (t.usd || 0), 0);
    const w = sc.week && sc.week.rate && sc.week.today != null ? sc.week : null;
    const pctW = w ? Math.round(tot * w.rate.pctPerUsd * 100) / 100 : null;
    const bad = sp.total != null && Math.round(sp.total * 100) !== Math.round(tot * 100);
    const fam: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", other: "no model" };
    const top = T.filter((t) => (t.usd || 0) > 0).sort((x, y) => (y.usd || 0) - (x.usd || 0)).slice(0, 2);
    const esc = (j.models && num(j.models.escalations)) ?? 0;
    return {
      tone: bad ? "r" : esc > 5 ? "a" : "g",
      headline: w ? wkPct(pctW) + " of weekly limit" : usd(tot) + " Claude today",
      sub: top.length ? "today: " + top.map((t) => (fam[t.id] || t.id) + " $" + (t.usd || 0).toFixed(2)).join(" · ") : "no Claude spend yet today",
      chip: bad ? "differs from lane spend " + usd(sp.total) : pl(esc, "card") + " escalated today",
    };
  },
  halo: (j) => {
    const H = (j.status || {}).halo;
    const h = j.halo || {};
    const v = h.vitals || {};
    if (!H && !v.ok) throw new Error("no halo");
    const up = (H && H.up) || 0;
    const tot = (H && H.total) || 0;
    const failed = ((H && H.failed) || []).length;
    const c: Tone = tot && up === tot ? "g" : up ? "a" : "r";
    const cpu = v.load && v.cpus ? pctOf(v.load[0], v.cpus) : 0;
    const gpu = num(v.gpu_busy_percent) ?? 0;
    const mem = pctOf(v.mem_info_gtt_used || 0, v.mem_info_gtt_total || 0);
    const req = h.usage && h.usage.reqLastHour != null ? h.usage.reqLastHour : h.lane && h.lane.smallReqHour;
    return {
      tone: !v.ok || c === "r" ? "r" : c === "a" || req === 0 ? "a" : "g",
      headline: up + " of " + tot + " up",
      sub: up + " running of " + tot + " enabled" + (failed ? ", " + failed + " failed" : ""),
      chip: v.ok ? (req != null ? req + " requests last hour" : "health ok") : "health readings unavailable",
      meters: v.ok ? [{ label: "CPU", pct: cpu }, { label: "GPU", pct: gpu }, { label: "MEM", pct: mem }] : undefined,
    };
  },
  halocaps: (j) => {
    const hc = j.haloCaps;
    if (!hc || hc.err) return { tone: "d", headline: hc && hc.err ? "Unreadable" : "Reading the Halo", sub: hc && hc.err ? String(hc.err).slice(0, 60) : "no data", chip: "no data" };
    const models: J[] = hc.models || [];
    const infra: J[] = hc.infra || [];
    const nUp = models.filter((m) => m.state === "running").length;
    const nOd = models.filter((m) => m.state === "on demand").length;
    const fl = models.filter((m) => m.state === "failed").length;
    const badS = infra.filter((x) => x.on && x.status && x.status !== "ok" && x.statusKind !== "work").length;
    return {
      tone: hc.tile ? asTone(hc.tile.c) : fl ? "r" : badS ? "a" : "g",
      headline: nUp + " up" + (nOd ? " · " + nOd + " on demand" : ""),
      sub: hc.tile && hc.tile.t ? String(hc.tile.t) : models.length + " models registered",
      chip: infra.filter((x) => x.on).length + " Halo scripts on",
    };
  },
  modes: (j) => {
    const dm = j.draftingModes;
    const key = dm && dm.windows && dm.windows[dm.default] ? dm.default : "7d";
    const w = dm && dm.windows && dm.windows[key];
    if (!w || !w.verdicts) return { tone: "d", headline: "No outcome data yet", sub: "Waiting for the first landed cards", chip: "no data" };
    const fams = ["better", "correct", "cheaper", "faster"];
    const leads = fams.map((k) => (w.verdicts[k] || {}).lead);
    const nf = leads.filter((x) => x === "fragment").length;
    const nd = leads.filter((x) => x === "direct").length;
    const headline = nf && nf === nd ? "Methods are level" : nf || nd ? (nf > nd ? "Fragment method" : "Direct method") + " leads" : "No method ahead yet";
    return {
      tone: nf && nf === nd ? "a" : nf || nd ? "g" : "d",
      headline,
      sub: nf || nd ? "Fragment ahead on " + nf + " of 4 measures · Direct on " + nd : "Not enough landed cards to call a winner",
      chip: (w.cards ?? 0) + " cards · " + key,
    };
  },
  appkpis: (j) => {
    const Y = (j.sysKpis && j.sysKpis.summary) || null;
    const S = (j.appKpis && j.appKpis.summary) || null;
    if (!Y && !S) throw new Error("no kpis");
    const ps: number[] = ((S && S.launch) || []).map((x: J) => x.pct).filter((x: unknown) => num(x) != null);
    const lo = ps.length ? Math.min(...ps) : null;
    const hi = ps.length ? Math.max(...ps) : null;
    const sysC: Tone = Y && Y.live ? asTone(Y.tone, "d") : "d";
    const appC: Tone = !S ? "d" : S.alerts ? "r" : S.offTarget ? "a" : S.modelled ? "g" : "d";
    const trend = Y && Y.trend && Array.isArray(Y.trend.points) ? Y.trend.points.slice(-24).map((p: J) => num(p.v) ?? 0) : undefined;
    return {
      tone: [sysC, appC].includes("r") ? "r" : [sysC, appC].includes("a") ? "a" : sysC,
      headline: "System " + (Y && Y.live ? Y.onTarget + "/" + Y.live : "—") + " · Apps " + (lo == null ? "—" : lo === hi ? lo + "%" : lo + "-" + hi + "%"),
      sub: Y && Y.live ? [Y.improving ? Y.improving + " improving" : "", Y.stalled ? Y.stalled + " stalled" : "", Y.missing ? Y.missing + " missing" : ""].filter(Boolean).join(" · ") || "all on target" : "No KPI readings yet",
      chip: S ? S.modelled + " of " + pl(S.apps, "app") + " with KPIs" : "no app KPIs",
      spark: trend && trend.length > 1 ? trend : undefined,
    };
  },
};

export function noDataCard(id: CardId): CockpitCard {
  return { id, title: CARD_TITLES[id], tone: "d", headline: "no data", sub: "this part of the state is missing", chip: "no data" };
}

/** Pure: state JSON -> the 14 cards, in CARD_IDS order. Never throws. */
export function mapState(j: J, now = Date.now()): CockpitCard[] {
  return CARD_IDS.map((id) => {
    if (!j || typeof j !== "object") return noDataCard(id);
    try {
      const f = FACES[id](j, now);
      const card: CockpitCard = {
        id,
        title: CARD_TITLES[id],
        tone: f.tone,
        headline: String(f.headline || "no data").slice(0, 80),
        sub: String(f.sub ?? "").slice(0, 120),
        chip: String(f.chip ?? "").slice(0, 60),
      };
      if (f.spark && f.spark.length) card.spark = f.spark.slice(-24).map((x) => (Number.isFinite(x) ? x : 0));
      if (f.meters) card.meters = f.meters.map((m) => ({ label: m.label, pct: Math.max(0, Math.min(100, Math.round(m.pct) || 0)) }));
      return card;
    } catch {
      return noDataCard(id);
    }
  });
}

export const COCKPIT_STATE_URL = process.env.COCKPIT_STATE_URL || "http://127.0.0.1:5217/api/state";
const CACHE_MS = 3000;

export interface StateRead {
  at: number;
  ok: boolean;
  error?: string;
  /** The last good full state (kept while the cockpit is unreachable), or null before the first read. */
  j: J | null;
}

let stateCache: { at: number; read: StateRead } | null = null;
let stateInflight: Promise<StateRead> | null = null;
let lastGood: { at: number; j: J } | null = null;

/** The cockpit's full state (8 s timeout), cached 3 s in-process; one fetch at a time. Shared by get-cards and get-card-detail. */
export async function getState(): Promise<StateRead> {
  if (stateCache && Date.now() - stateCache.at < CACHE_MS) return stateCache.read;
  if (stateInflight) return stateInflight;
  stateInflight = (async () => {
    try {
      const res = await fetch(COCKPIT_STATE_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error("cockpit answered HTTP " + res.status);
      const j = await res.json();
      lastGood = { at: Date.now(), j };
      const read: StateRead = { at: lastGood.at, ok: true, j };
      stateCache = { at: Date.now(), read };
      return read;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // keep the last good state, marked stale, rather than blanking the region
      return { at: lastGood ? lastGood.at : Date.now(), ok: false, error: "cockpit unreachable: " + msg, j: lastGood ? lastGood.j : null };
    } finally {
      stateInflight = null;
    }
  })();
  return stateInflight;
}

let cardsCache: { j: J; result: CardsResult } | null = null;

/** The 14 compact cards from the shared state read; mapped once per state object. */
export async function getCards(): Promise<CardsResult> {
  const r = await getState();
  if (!r.j) return { at: r.at, ok: false, error: r.error, cards: CARD_IDS.map(noDataCard) };
  if (!cardsCache || cardsCache.j !== r.j) cardsCache = { j: r.j, result: { at: r.at, ok: true, cards: mapState(r.j) } };
  return r.ok ? cardsCache.result : { ...cardsCache.result, ok: false, error: r.error };
}

/** One card's face (tone, headline, sub, chip) from a state object; the dialog header repeats it. */
export function faceOf(j: J, id: CardId, now = Date.now()): CockpitCard {
  return mapState(j, now).find((c) => c.id === id) || noDataCard(id);
}
