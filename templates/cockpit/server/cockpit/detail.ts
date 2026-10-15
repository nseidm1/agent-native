/**
 * A card's click window, built from the cockpit's state (state.ts assembles it
 * from the cockpit client's resources). The words
 * and sections follow the cockpit's own dialog renderers in
 * tools/lane/maint/ui/index.html and page/*.js (scoreView, dmCard/DM_ROWS,
 * jobs, forge, the work-state ledger, pipeline, production releases, KPIs,
 * board, models, halo, halo capabilities, board upkeep, activity), so a
 * dialog here says what the cockpit's said. Each builder reads defensively; a
 * missing part of the state becomes an "empty" line, never a throw. Every
 * table and list is capped at DETAIL_MAX_ROWS and every string at
 * DETAIL_MAX_CHARS.
 */
import { CARD_TITLES, type CardId, type Tone } from "../../shared/cockpit.js";
import {
  type CardDetail,
  DETAIL_MAX_CHARS,
  DETAIL_MAX_ROWS,
  type DetailAction,
  type DetailCell,
  type DetailFilter,
  type DetailItem,
  type DetailRow,
  type DetailSearch,
  type DetailSection,
  type DetailStat,
  type JobForm,
} from "../../shared/cockpit-detail.js";
import { faceOf } from "./cards.js";

type J = any;

export interface DetailOptions {
  now?: number;
  /** modes: the work class (all | hot | system | production) and the window (today | 7d | all). */
  cls?: string;
  window?: string;
  /** halo: the client resource halomodels, read by the caller (null when unreachable). */
  haloModels?: J[] | null;
  /** appkpis: the client resource appdata, read by the caller (null when unreachable). */
  appData?: J | null;
  /** score: the client resource estimate (the spend tally's baseline and the estimate details), or null. */
  costPanel?: J | null;
}

interface Body {
  lead?: string;
  sections: DetailSection[];
  filters?: DetailFilter[];
  search?: DetailSearch;
  actions?: DetailAction[];
  jobForm?: JobForm;
}

// ---------- helpers ----------
const str = (x: unknown): string => {
  const v = x == null ? "" : typeof x === "string" ? x : typeof x === "number" || typeof x === "boolean" ? String(x) : JSON.stringify(x);
  return v.length > DETAIL_MAX_CHARS ? v.slice(0, DETAIL_MAX_CHARS - 1) + "…" : v;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): J[] => (Array.isArray(v) ? v : []);
const usd = (x: unknown) => (num(x) == null ? "n/a" : "$" + (x as number).toFixed(2));
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
const pct = (x: unknown) => (num(x) == null ? "n/a" : Math.round(100 * (x as number)) + "%");
const wkPct = (p: number | null) =>
  p == null || !Number.isFinite(p) ? "n/a" : p >= 10 ? Math.round(p) + "%" : p >= 1 ? p.toFixed(1) + "%" : p.toFixed(2) + "%";
const minTxt = (m: unknown) => {
  const v = num(m);
  if (v == null) return "n/a";
  return v < 60 ? Math.round(v) + " min" : v < 1440 ? Math.floor(v / 60) + " h " + Math.round(v % 60) + " min" : (v / 1440).toFixed(1) + " d";
};
const toMs = (x: unknown): number | null => (num(x) != null ? (x as number) : typeof x === "string" && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null);
const hm = (x: unknown) => {
  const t = toMs(x);
  if (t == null) return "n/a";
  const d = new Date(t);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};
const ago = (x: unknown, now: number) => {
  const t = toMs(x);
  if (t == null) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 90 ? s + "s ago" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 172800 ? (s / 3600).toFixed(1) + " h ago" : Math.round(s / 86400) + " d ago";
};
const asTone = (c: unknown): Tone | undefined => (c === "g" || c === "a" || c === "r" || c === "d" ? c : c === "s" || c === "v" ? "g" : undefined);
const cell = (t: unknown, tone?: Tone, mono?: boolean): DetailCell => ({ t: str(t), ...(tone ? { tone } : {}), ...(mono ? { mono } : {}) });

function capRows(rows: DetailRow[]): { rows: DetailRow[]; more?: number } {
  return rows.length > DETAIL_MAX_ROWS ? { rows: rows.slice(0, DETAIL_MAX_ROWS), more: rows.length - DETAIL_MAX_ROWS } : { rows };
}
function table(title: string, columns: string[], rows: DetailRow[], o: Partial<DetailSection> = {}): DetailSection {
  return { title: str(title), kind: "table", columns, ...capRows(rows), empty: "none", ...o };
}
function list(title: string, items: DetailItem[], o: Partial<DetailSection> = {}): DetailSection {
  const capped = items.length > DETAIL_MAX_ROWS ? { items: items.slice(0, DETAIL_MAX_ROWS), more: items.length - DETAIL_MAX_ROWS } : { items };
  return { title: str(title), kind: "list", ...capped, empty: "none", ...o };
}
const stats = (title: string, s: DetailStat[], o: Partial<DetailSection> = {}): DetailSection => ({ title: str(title), kind: "stats", stats: s, ...o });
const text = (title: string, t: string, o: Partial<DetailSection> = {}): DetailSection => ({ title: str(title), kind: "text", text: str(t), ...o });

// ---------- score ----------
const wkOf = (sc: J) => (sc && sc.week && sc.week.rate && sc.week.today != null ? sc.week : null);
const wkUsd = (w: J, v: number | null) => (w && v != null ? Math.round(v * w.rate.pctPerUsd * 100) / 100 : null);
const n$ = (s: unknown) => (s == null ? null : parseFloat(String(s).replace(/[^0-9.-]/g, "")));

function kpiRow(r: J): DetailRow {
  const tone = asTone(r.tone);
  return {
    cells: [cell(r.title), cell(r.value ?? "n/a", tone), cell(r.target ?? "—"), cell(r.stateText || r.stateKey || "", tone)],
    tone,
    note: r.chronic || r.remedy ? str(r.chronic || r.remedy) : undefined,
  };
}

function score(j: J, p: J | null | undefined): Body {
  const sc = j.scorecard || {};
  const u = sc.units && sc.units.today;
  const v = sc.velocity;
  const w = wkOf(sc);
  const regs: J[] = arr((j.sysKpis || {}).groups).flatMap((g: J) => arr(g.rows));
  const R = Object.fromEntries(regs.map((r) => [r.id, r]));
  const tgtOf = (id: string) => (R[id] && R[id].target ? n$(R[id].target) : null);
  const uUsd = u ? u.usdPerUnit : sc.usdPerLanded;
  const fph = v ? num(v.finishedPerHour) : null;
  const fT = tgtOf("velocity.finishedPerHour");
  const cT = tgtOf("unit.usd");
  const mT = sc.clock && sc.clock.targets && sc.clock.targets.p50 ? sc.clock.targets.p50 / 60 : null;
  const sg = (n: number) => (n > 0 ? "+" : "") + n;
  const top: DetailStat[] = [
    u
      ? { label: "Units today", value: u.n + " units today", tone: u.n ? "g" : "r", sub: `${u.cards?.n ?? 0} cards + ${u.tasks?.n ?? 0} tasks` }
      : { label: "Units today", value: (sc.landed || 0) + " cards today", tone: sc.landed ? "a" : "r" },
    {
      label: "Velocity",
      value: (fph == null ? "n/a" : fph + " units an hour") + (fT != null ? " · target " + fT : ""),
      tone: fph == null ? "d" : fT == null || fph >= fT ? "g" : "a",
    },
    {
      label: "Time per unit",
      value: (u ? Math.round(u.p50Min) + " min a unit" : "n/a") + (mT != null ? " · target < " + Math.round(mT) + " min" : ""),
      tone: !u ? "d" : u.p50Min <= 12 ? "g" : u.p50Min <= 25 ? "a" : "r",
      sub: u ? "p90 " + Math.round(u.p90Min) + " min" : undefined,
    },
    {
      label: "Cost per unit",
      value: w && w.unitPer100 != null ? wkPct(w.unitPer100) + " of the week per 100 units" : usd(uUsd) + " a unit",
      tone: uUsd == null ? "d" : cT == null || uUsd <= cT ? "g" : "a",
      sub: usd(uUsd) + " a unit",
    },
    { label: "Net velocity", value: v ? "net " + sg(v.net) + " per 30 min" : "net n/a", tone: !v ? "d" : v.net >= 0 ? "g" : "a" },
  ];
  // spend vs the goal: the lane spend against the spend tally's frozen baseline, halved (the 50% target); the registry's Claude-per-day target otherwise
  const tal = p && p.spendTally;
  const base = tal && tal.baseline;
  const regGoal = tgtOf("spend.claudeUsdDay");
  const goalUsd = base && base.roster24hUsd ? base.roster24hUsd * (base.target || 0.5) : regGoal && regGoal > 0 ? regGoal : null;
  const spUsd = sc.spend ? num(sc.spend.total) : null;
  const gPct = w && goalUsd != null ? wkUsd(w, goalUsd) : null;
  const used = w ? num(w.today) : spUsd;
  const lim = w ? gPct : goalUsd;
  const goal: DetailStat = {
    label: "Spend vs the 50% goal",
    value: w ? wkPct(w.today) + " of the week today" : usd(spUsd) + " today",
    sub:
      (lim == null || used == null ? "no goal on record yet" : "goal ≤ " + (w ? wkPct(gPct) : usd(goalUsd)) + " a day · " + (used / lim).toFixed(1) + "× the goal") +
      " · " +
      (w && w.unitPer100 != null ? wkPct(w.unitPer100) + " per 100 units" : usd(uUsd) + " a unit"),
    tone: lim == null || used == null ? "d" : used <= lim ? "g" : used <= lim * 1.25 ? "a" : "r",
  };
  if (lim != null && !(lim > 0)) {
    goal.sub = "no goal on record yet";
    goal.tone = "d";
  }
  // the details, in plain words (scoreView's list)
  const P = (x: unknown) => pct(x);
  const details: DetailItem[] = [];
  if (p) {
    const a = p.accuracy || {};
    const bt = a.backtest6h || {};
    details.push({ text: a.quotes ? P(a.inUsd) + " of " + a.quotes + " quoted cards came in inside the cost range, " + P(a.inMin) + " inside the time range" : "No quoted card released yet" + (a.pending ? "; " + a.pending + " quoted cards still open" : "") + "." });
    details.push({ text: bt.test ? "6-hour back-test: " + P(bt.hitUsd) + " of cost and " + P(bt.hitMin) + " of time quotes inside the range (" + bt.test + " cards)" : "No card started in the last 6 hours to back-test." });
    if (p.proof) details.push({ text: "Card estimates " + (p.proof.proven ? "shown: " : "withheld until proven: ") + str(p.proof.why || p.proof.text) });
    if (p.fitN) details.push({ text: "The estimate model is fit on " + p.fitN + " released cards." });
    if (tal && tal.text) details.push({ strong: "Spend tally", text: str(tal.text) });
  }
  const mine = regs.filter((r) => r.open === "score" || r.open === "kVel" || /^spend\.claude/.test(String(r.id)));
  const live = mine.filter((r) => r.live);
  const off = mine.filter((r) => !r.live);
  const on = live.filter((r) => r.tone === "g").length;
  const sections: DetailSection[] = [
    stats("Today", top),
    stats("Spend", [goal, { label: "Lane spend today", value: usd(spUsd), sub: "every role, since local midnight" }]),
    table("Scorecard KPIs", ["KPI", "Now", "Target", "State"], live.map(kpiRow), { sub: "from the KPI registry · " + on + " of " + live.length + " on target" }),
  ];
  if (off.length) sections.push(table(pl(off.length, "KPI") + " not measured yet", ["KPI", "Now", "Target", "State"], off.map(kpiRow), { collapsed: true }));
  if (details.length) sections.push(list("Estimates and spend, in plain words", details, { collapsed: true }));
  // the KPI grid: every registry group, as the System KPIs dialog lists it
  for (const g of arr((j.sysKpis || {}).groups)) {
    const rows = arr(g.rows).filter((r: J) => r.live);
    if (!rows.length) continue;
    const ok = rows.filter((r: J) => r.tone === "g").length;
    sections.push(table(String(g.area || "KPIs"), ["KPI", "Now", "Target", "State"], rows.map(kpiRow), { sub: ok + " of " + rows.length + " on target", collapsed: true }));
  }
  return { sections };
}

// ---------- modes ----------
const DM_FAM: [string, string][] = [
  ["better", "Better"],
  ["correct", "Correct"],
  ["cheaper", "Cheaper"],
  ["faster", "Faster"],
];
const DM_WIN: Record<string, string> = { today: "Today", "7d": "7 days", all: "All" };
const DM_CLS: [string, string][] = [
  ["all", "All work"],
  ["hot", "Hot fixes"],
  ["system", "System cards"],
  ["production", "Production"],
];
const dmR = (x: J) =>
  x && x.n ? Math.round(100 * x.p) + "% (" + x.k + "/" + x.n + ") [" + Math.round(100 * x.lo) + "–" + Math.round(100 * x.hi) + "%]" : "n=0";
const dmMin = (m: number | null) => (m == null ? "n/a" : m < 10 ? m.toFixed(1) + " min" : m < 90 ? Math.round(m) + " min" : (m / 60).toFixed(1) + " h");
const dmMed = (x: J, f: (v: number) => string) =>
  x && x.n && x.p50 != null ? f(x.p50) + (x.lo != null ? " [" + f(x.lo) + "–" + f(x.hi) + "]" : "") + " · p90 " + f(x.p90) + " (n=" + x.n + ")" : "n=0";
const DM_ROWS: [string, (m: J) => string][] = [
  ["Cards · landed", (m) => m.cards + " · " + m.landed],
  ["LANDED share", (m) => (m.landedShare ? dmR(m.landedShare) + (m.finishedByFixer ? " · " + m.finishedByFixer + " finished by a fixer" : "") : "n/a")],
  ["BETTER · first-pass green", (m) => dmR(m.better.firstPassAll || m.better.firstPass)],
  [
    "BETTER · review findings per card",
    (m) => {
      const x = m.better.findingsPerCard;
      return x && x.n ? x.mean.toFixed(1) + " (" + x.total + " on " + x.n + " cards)" : (x && x.why) || "n=0";
    },
  ],
  [
    "BETTER · scope creep (files beyond CHANGE)",
    (m) => {
      const x = m.better.scopeCreep;
      return dmR(x) + (x && x.n && x.extraFilesMean != null ? " · +" + x.extraFilesMean.toFixed(1) + " files" : "");
    },
  ],
  ["CORRECT · landed without rework", (m) => dmR(m.correct.noRework)],
  ["CHEAPER · $ per landed card (median)", (m) => dmMed(m.cheaper.usdPerLanded, (v) => "$" + v.toFixed(2))],
  [
    "CHEAPER · ALL spend ÷ landed",
    (m) =>
      m.cheaper.usdAll === undefined
        ? "n/a"
        : "$" + m.cheaper.usdAll.toFixed(2) + " total · " + (m.cheaper.usdAllPerLanded == null ? "none landed" : "$" + m.cheaper.usdAllPerLanded.toFixed(2) + " per landed"),
  ],
  [
    "FASTER · landed within 30 min",
    (m) =>
      m.faster.within
        ? dmR(m.faster.within) + " · median " + (m.faster.minutesAll.p50 == null ? "not reached" : dmMin(m.faster.minutesAll.p50))
        : "n/a",
  ],
  ["FASTER · start to landed (median)", (m) => dmMed(m.faster.minutes, dmMin)],
];
const DM_COLS: [string, string][] = [
  ["fragment", "🧩 Fragment"],
  ["directAll", "🎯 Direct + fixers"],
  ["direct", "🎯 Direct pods"],
  ["fixer", "🔧 Fixers"],
  ["mixed", "Mixed"],
  ["unattributed", "Unattributed"],
];

function modes(j: J, o: DetailOptions): Body {
  const base = j.draftingModes;
  const clsKey = DM_CLS.some(([k]) => k === o.cls) ? (o.cls as string) : "all";
  const b = base && base.byClass && base.byClass[clsKey];
  const dm = b && !b.error && b.windows ? b : base;
  const winKey = dm && dm.windows && o.window && dm.windows[o.window] ? o.window : dm && dm.windows && dm.windows[dm.default] ? dm.default : "7d";
  const w = dm && dm.windows && dm.windows[winKey];
  const filters: DetailFilter[] = [
    { key: "cls", label: "Work class", value: clsKey, server: true, options: DM_CLS.map(([value, label]) => ({ value, label })) },
    {
      key: "window",
      label: "Window",
      value: winKey,
      server: true,
      options: Object.keys(DM_WIN).map((value) => ({ value, label: DM_WIN[value] })),
    },
  ];
  const clsName = (DM_CLS.find(([k]) => k === clsKey) || DM_CLS[0])[1];
  if (!w || !w.modes || !w.verdicts) {
    return { filters, lead: "Drafting mode outcomes · " + clsName + " · no outcome data yet", sections: [text("Outcomes", "Waiting for the first landed cards.")] };
  }
  const unit = clsKey === "hot" ? "units" : clsKey === "system" ? "cards" : "cards + units";
  const lead =
    "Drafting mode outcomes · " + clsName + " · " + (DM_WIN[winKey] || winKey) + (w.from ? " since " + str(w.from).slice(0, 10) : "") + " · " + (w.cards ?? 0) + " " + unit;
  const V = w.versus && w.versus.fixer && w.versus.direct ? w.versus : null;
  const items: DetailItem[] = [];
  if (V && V.fixer.landed && V.direct.landed) {
    items.push({ strong: "Landed share", text: "vs fixer: " + str(V.fixer.landed.text) + " · vs direct pods: " + str(V.direct.landed.text) });
  }
  for (const [k, name] of DM_FAM) {
    const v = w.verdicts[k] || {};
    const full = V && V.fixer[k] && V.direct[k] ? "vs fixer: " + V.fixer[k].text + " · vs direct pods: " + V.direct[k].text : v.text || "no verdict";
    const lead = v.lead === "fragment" || v.lead === "direct";
    items.push({ strong: name + (v.metric ? " (" + v.metric + ")" : ""), text: str(full), tone: lead ? "g" : undefined });
  }
  if (V) items.push({ strong: "Card mix", text: "fragment vs fixer — " + str(V.fixer.mix) + "; vs direct pods — " + str(V.direct.mix) + "." });
  const cols = DM_COLS.filter(([k]) => w.modes[k]);
  const rows: DetailRow[] = DM_ROWS.map(([label, f]) => ({
    cells: [
      label,
      ...cols.map(([k]) => {
        try {
          return str(f(w.modes[k]));
        } catch {
          return "n/a";
        }
      }),
    ],
  }));
  const sections: DetailSection[] = [
    list("Verdict per family · fragment vs direct (direct pods + fixers)", items),
    table("Every way code gets written · n and 95% interval", ["KPI", ...cols.map(([, l]) => l)], rows),
  ];
  const lines = j.status && j.status.modeHealth && Array.isArray(j.status.modeHealth.lines) ? j.status.modeHealth.lines : [];
  sections.push(text("Forge mode check", lines.length ? lines.join(" | ") : "no mode underperforms its incumbent"));
  if (base && base.caveat) sections.push(text("Caveat", base.caveat + ". Each verdict compares 95% intervals; a small n says \"not enough cards yet\" instead of a percentage."));
  return { filters, lead, sections };
}

// ---------- jobs ----------
const JOB_TONE: Record<string, Tone> = { running: "g", waiting: "a", done: "g", ok: "g", failed: "r", stopped: "a", cancelled: "d" };

function jobs(j: J, now: number): Body {
  const jb = j.jobs;
  if (!jb) return { sections: [text("Agent jobs", "Job list unavailable.")] };
  const jobForm: JobForm = { kinds: arr(jb.kinds).map((k: J) => ({ id: str(k.id), label: str(k.label || k.id), does: str(k.does || "") })) };
  const live = arr(jb.live);
  const asks = arr(jb.asks);
  const liveRows: DetailRow[] = live.map((x: J) => {
    const stop: DetailAction | null =
      x.master || !/^[a-z][a-z0-9-]{1,40}$/.test(String(x.name || ""))
        ? null
        : {
            kind: "job-stop",
            label: "Stop",
            args: { name: x.name, ...(typeof x.id === "string" && /^rq-[a-z0-9-]+$/.test(x.id) ? { id: x.id } : {}) },
            confirm: "Stop this job? " + str(x.what),
            danger: true,
          };
    return {
      cells: [cell(x.who), cell(x.what), cell(x.status || x.state, JOB_TONE[x.state]), cell(x.startedAt ? ago(x.startedAt, now) : "—"), cell(usd(x.usd) + (x.maxUsd ? " of " + usd(x.maxUsd) : ""))],
      tone: JOB_TONE[x.state],
      note: x.master ? "a master session: stop it from master" : undefined,
      actions: stop ? [stop] : undefined,
    };
  });
  const askItems: DetailItem[] = asks.map((a: J) => ({
    text: str(a.line) + " · " + arr(a.jobs).map((x: J) => str(x.who) + ": " + str(x.status || x.state)).join(", "),
    tone: arr(a.jobs).some((x: J) => x.state === "running") ? "g" : undefined,
  }));
  const Q = jb.queues || {};
  const qRows: DetailRow[] = arr(Q.agents).map((a: J) => ({
    cells: [cell(a.name, undefined, true), String(a.queued ?? 0), a.wait != null ? "expected wait " + str(a.wait) : a.drainMin != null ? minTxt(a.drainMin) : "—", a.running ? "running" : "idle"],
    tone: a.backedUp ? "a" : undefined,
  }));
  const fin = arr(jb.finished);
  const finRows: DetailRow[] = fin.map((x: J) => ({
    cells: [cell(x.who), cell(x.outcome || x.status, JOB_TONE[x.outcome] || JOB_TONE[x.status]), usd(x.usd), x.wallMs != null ? minTxt(x.wallMs / 60000) : "—", hm(x.endedAt)],
    note: x.what && x.what !== x.who ? str(x.what) : undefined,
  }));
  return {
    jobForm,
    sections: [
      list("Jobs now, by your request", askItems, {
        sub: pl(asks.length, "request") + " in progress · " + pl(live.length, "job"),
        empty: "No requests in progress.",
      }),
      table("Live jobs", ["Who", "What", "State", "Started", "Spend"], liveRows, { empty: "No job is running." }),
      table("Queues", ["Agent", "Queued", "Wait", "Now"], qRows, {
        sub: str(Q.budget && Q.budget.line ? Q.budget.line : "") + (Q.stale ? " · numbers are old (the driver writes them each pass)" : ""),
      }),
      table("Finished jobs", ["Job", "Outcome", "Spend", "Took", "Ended"], finRows, {
        sub: (jb.todayN ?? fin.length) + " finished today · " + usd(jb.todayUsd),
        collapsed: true,
      }),
    ],
  };
}

// ---------- forge ----------
function forge(j: J, now: number): Body {
  const F = (j.status || {}).forgeAutonomy;
  if (!F) return { sections: [text("Forge", "Not measured yet: the forge writes run/forge-autonomy.json each pass.")] };
  const T = F.today || {};
  const lead =
    "Fixed by itself: " + pct(T.rate) + " today · " + (F.fixing ?? 0) + " being fixed. " + (T.auto ?? 0) + " of " + (T.detected ?? 0) +
    " issues found since midnight were cleared on evidence with no person, " + (T.person ?? 0) + " needed you" +
    (T.ttrP50Min != null ? " · typically " + Math.round(T.ttrP50Min) + " min from found to cleared" : "") + (F.toneWhy ? " · " + F.toneWhy : "");
  const rows: DetailRow[] = arr(F.rows).map((r: J) => {
    const open = arr(r.open);
    const past = open.filter((x: J) => x.past).length;
    const tone: Tone | undefined = r.late || past ? "a" : open.length ? undefined : "g";
    return {
      cells: [
        cell(r.words || r.id),
        cell(r.every || ""),
        cell(r.lastRun ? "last run " + ago(r.lastRun, now) + (r.late ? ": late" : "") : "never run", r.late ? "r" : undefined),
        cell((r.resolvedToday ?? 0) + " resolved today" + (r.autoToday ? " (" + r.autoToday + " by itself)" : "")),
        cell(open.length ? open.length + " open" + (past ? ", " + past + " past target" : "") : "none open", past ? "a" : undefined),
        cell(r.ttrMin != null ? minTxt(r.ttrMin) : "—"),
      ],
      tone,
      note: str(
        [r.what, ...open.slice(0, 5).map((x: J) => "• " + x.title + (x.doing ? " · " + x.doing : "") + " · " + minTxt(x.ageMin) + (x.past ? ", past its target" : ""))]
          .filter(Boolean)
          .join("\n"),
      ),
    };
  });
  const trendRows: DetailRow[] = arr(F.trend).map((d: J) => ({
    cells: [cell(d.day, undefined, true), String(d.detected ?? 0), String(d.auto ?? 0), String(d.person ?? 0), cell(pct(d.rate), num(d.rate) == null ? "d" : d.rate >= 0.8 ? "g" : "a"), d.ttrP50Min != null ? Math.round(d.ttrP50Min) + " min" : "—"],
  }));
  const findings: DetailItem[] = arr(F.findings).map((f: J) => ({ text: str(typeof f === "string" ? f : f.text || f.title || f), tone: /NOT BEING FIXED/.test(String(f)) ? "r" : undefined }));
  return {
    lead,
    sections: [
      table("Responsibilities", ["What it watches", "Runs", "Last run", "Today", "Open", "Target"], rows),
      table("7-day trend", ["Day", "Found", "By itself", "Needed you", "Rate", "Typical time"], trendRows, { numeric: [1, 2, 3, 5] }),
      list("Not being fixed", findings, { sub: (F.notBeingFixed ?? findings.length) + " findings", collapsed: true }),
    ],
  };
}

// ---------- orphans ----------
function orphans(j: J): Body {
  const o = j.orphans;
  if (!o || !o.running) return { sections: [text("Work state", "Ledger not running yet: waiting for run/orphans.json.")] };
  const ws = o.ws || {};
  const agents = arr(o.agents).map(String).slice(0, 120);
  const inv = o.invariant;
  const lead =
    (ws.inProgress ? ws.inProgress.files : o.inFlight || 0) + " in progress · " + (ws.orphaned ? ws.orphaned.n : o.orphans || 0) + " orphaned" +
    (inv ? " · invariant " + (inv.ok ? "holds" : "BROKEN") + ": open " + inv.open + " = in flight " + inv.inFlight + " + in remedy " + inv.inRemedy : "") +
    (o.ageS != null ? " · read " + minTxt(o.ageS / 60) + " ago" : "");
  const itemRow = (it: J): DetailRow => {
    const id = String(it.id || "");
    const okId = /^[\w.:-]{1,80}$/.test(id);
    const acts: DetailAction[] = okId && it.state === "ORPHAN"
      ? [
          { kind: "orphan", label: "Land", args: { id, action: "land" }, confirm: "Land " + (it.owner || "this") + "'s work? Its tests run first (minutes)." },
          {
            kind: "orphan",
            label: "Discard (archive)",
            args: { id, action: "discard" },
            input: { name: "reason", label: "Reason to discard " + (it.owner || "this") + "'s work", required: true },
            danger: true,
          },
          { kind: "orphan", label: "Hand to", args: { id, action: "hand" }, input: { name: "agent", label: "Agent", options: agents, required: true } },
        ]
      : [];
    return {
      cells: [cell(it.owner || "unknown"), cell(it.state === "ORPHAN" ? "orphan" : String(it.state || "").toLowerCase().replace(/_/g, " "), it.state === "ORPHAN" ? "a" : undefined), cell(it.card || "—", undefined, true), minTxt(it.ageMin), cell(it.stepName ? "step " + it.step + " · " + it.stepName : "—")],
      tone: it.state === "ORPHAN" ? "a" : undefined,
      note: str([arr(it.paths).slice(0, 3).join(", "), it.stepNote].filter(Boolean).join(" — ")) || undefined,
      actions: acts.length ? acts : undefined,
    };
  };
  const items = arr(o.items);
  const orph = items.filter((x: J) => x.state === "ORPHAN");
  const other = items.filter((x: J) => x.state !== "ORPHAN");
  const by = ws.orphaned && ws.orphaned.byStep ? Object.entries(ws.orphaned.byStep).filter(([, n]) => n).map(([k, n]) => n + " " + k).join(" · ") : "";
  const stuck = arr(ws.stuck && ws.stuck.items);
  const gen = arr(ws.generated && ws.generated.byRule);
  const ver = o.verifications || {};
  return {
    lead,
    sections: [
      text(
        "In progress",
        (ws.inProgress ? ws.inProgress.files : 0) + " files" + (ws.inProgress && ws.inProgress.handedOff ? " · " + ws.inProgress.handedOff + " handed off to a live owner" : "") +
          (ws.inProgress && !ws.inProgress.published ? " · per-agent split not published yet" : ""),
      ),
      table("Orphaned", ["Owner", "State", "Card", "Age", "Step"], orph.map(itemRow), {
        sub: (ws.orphaned ? ws.orphaned.n : orph.length) + (by ? " · " + by : "") + (ws.orphaned && ws.orphaned.oldestMin ? " · oldest " + minTxt(ws.orphaned.oldestMin) : ""),
        empty: "Nothing orphaned.",
      }),
      list("Stuck", stuck.map((x: J) => ({ text: str(x.title || x.text || x.id || x), tone: "r" as Tone })), { empty: ws.stuck && ws.stuck.published === false ? "not published yet" : "Nothing stuck." }),
      table("Verified", ["Verification", "Card", "Owner", "Verifier"], arr(ver.items).map((v: J) => ({ cells: [cell(v.title), cell(v.card, undefined, true), cell(v.owner), cell(v.verifier)] })), {
        sub: ver.counts ? Object.entries(ver.counts).map(([k, n]) => n + " " + k).join(" · ") : undefined,
        collapsed: true,
      }),
      list("Generated", gen.map((x: J) => ({ text: str(x.rule ? x.rule + ": " + (x.n ?? "") : x) })), { empty: ws.generated && ws.generated.published === false ? "not published yet" : "None generated." }),
      table("Handed off and other open work", ["Owner", "State", "Card", "Age", "Step"], other.map(itemRow), { collapsed: true }),
    ],
  };
}

// ---------- pipeline ----------
function pipeline(j: J): Body {
  const P = j.pipeline;
  if (!P || !P.lanes) return { sections: [text("Work pipeline", "No pipeline lanes in the state.")] };
  const S = P.lanes.system || {};
  const s = S.steps || {};
  const Pr = P.lanes.production || {};
  const awaiting = arr(P.awaitingRelease);
  const alerts = arr(P.releaseAlert);
  const stranded = arr(P.stranded && P.stranded.cards);
  const cardRows: DetailRow[] = arr(P.apps)
    .flatMap((a: J) => arr(a.cards).map((c: J) => ({ ...c, app: a.name || a.id })))
    .map((c: J) => ({ cells: [cell(c.fa || c.id, undefined, true), cell(c.title), cell(c.stage || c.step || c.col || ""), cell(c.app || "system")] }));
  return {
    lead: "Every card in the lane queue, plus any card worked on in the last 3 hours. Queued → Writing → In review → Pre-release check → Releasing → Released.",
    actions: [
      { kind: "release", label: "Release landed cards now", args: {}, confirm: "Release every landed card now (green at its sha, a done line, move to Released)?" },
      S.autoRelease === false
        ? { kind: "release", label: "Turn auto-release on", args: { auto: true }, confirm: "Turn auto-release on? The driver releases landed system cards itself." }
        : { kind: "release", label: "Turn auto-release off", args: { auto: false }, confirm: "Turn auto-release off? Landed cards then wait for the Release button.", danger: true },
    ],
    sections: [
      stats(String(P.lanes.headline || P.label || "Lanes"), [
        { label: "System · writing", value: String(s.writing || 0) },
        { label: "In review", value: String(s.review || 0) },
        { label: "Shipping", value: String(s.ship || 0) },
        { label: "Stuck", value: String(s.blocked || 0), tone: s.blocked ? "a" : undefined },
        { label: "Queued", value: String(s.queued || 0) },
        { label: "Auto-release", value: S.autoRelease === false ? "off" : "on", sub: str(S.autoReleaseScope || "system cards only"), tone: S.autoRelease === false ? "a" : "g" },
      ]),
      table("Cards in the pipeline", ["Card", "Title", "Stage", "Lane"], cardRows, { empty: "No cards here right now." }),
      table("Production runs", ["Run", "State"], arr(Pr.runs).map((r: J) => ({ cells: [cell(r.app || r.id || r.name), cell(r.state || r.label || "")] })), { empty: str(Pr.hint || "No production runs.") }),
      table("Landed, awaiting release", ["Card", "Waiting"], [
        ...alerts.map((a: J) => ({ cells: [cell(a.fa, undefined, true), cell(minTxt(a.ageMin), "a")], tone: "a" as Tone })),
        ...awaiting.filter((a: J) => !alerts.some((x: J) => x.fa === a.fa)).map((a: J) => ({ cells: [cell(a.fa || a, undefined, true), cell(a.ageMin != null ? minTxt(a.ageMin) : "—")] })),
      ], { empty: "Nothing waiting for release." }),
      ...(stranded.length ? [list("Stranded", stranded.map((c: J) => ({ text: str(c.fa ? c.fa + " " + (c.why || "") : c), tone: "a" as Tone })))] : []),
      ...(P.outOfScope ? [text("Not shown", P.outOfScope + " recent cards not in the work list or a production-ready run")] : []),
    ],
  };
}

// ---------- production ----------
function production(j: J): Body {
  const rs = arr(j.prodReleases);
  const STATE_TONE: Record<string, Tone> = { error: "r", fingerprint: "a", ready: "a", making: "g", promoting: "g", published: "g" };
  return {
    lead: "One row per app: the version production runs, how far staging is ahead, and the next step. System cards release by themselves (auto-release, on the Work pipeline).",
    sections: [
      table(
        "Apps",
        ["App", "State", "Production", "Staging", "Next step"],
        rs.map((r: J) => ({
          cells: [
            cell(r.name || r.app),
            cell(r.label || r.state, STATE_TONE[r.state]),
            cell(r.prod && r.prod.short ? r.prod.short + (r.prod.at ? " · " + str(r.prod.at).slice(0, 10) : "") : "never published", undefined, true),
            r.ahead ? r.ahead + " ahead of production" : "Staging matches production",
            cell(r.action && r.action.label ? r.action.label : "—"),
          ],
          tone: STATE_TONE[r.state],
          note: r.detail ? str(r.detail) : undefined,
        })),
        { empty: "No app release state yet." },
      ),
    ],
  };
}

// ---------- appkpis ----------
const KPI_TONE = (k: J): Tone | undefined => (k.breach ? "r" : k.good === true ? "g" : k.good === false ? "a" : undefined);

function appkpis(j: J, o: DetailOptions): Body {
  const rows = arr(j.appKpis && j.appKpis.rows);
  const sections: DetailSection[] = [];
  const S = j.appKpis && j.appKpis.summary;
  const Y = j.sysKpis && j.sysKpis.summary;
  sections.push(
    stats("Summary", [
      { label: "System KPIs", value: Y && Y.live ? Y.onTarget + " of " + Y.live + " on target" : "no readings yet", tone: asTone(Y && Y.tone) },
      { label: "Improving · stalled · missing", value: Y ? (Y.improving ?? 0) + " · " + (Y.stalled ?? 0) + " · " + (Y.missing ?? 0) : "n/a" },
      { label: "Apps with KPIs", value: S ? S.modelled + " of " + pl(S.apps, "app") : "no app KPIs" },
      { label: "App alerts", value: S ? String(S.alerts ?? 0) : "n/a", tone: S && S.alerts ? "r" : undefined },
    ]),
  );
  for (const a of rows) {
    const L = a.launch || {};
    const kp = arr(a.kpis).filter((k: J) => k.value != null || k.target != null);
    const items: DetailItem[] = [
      { strong: "Launch readiness", text: (L.pct ?? 0) + "% · " + (L.done ?? 0) + " of " + (L.total ?? 0) + " items done, " + (L.open ?? 0) + " not yet proven", tone: (L.pct ?? 0) >= 80 ? "g" : (L.pct ?? 0) >= 40 ? "a" : "r" },
      ...arr(L.red).map((r: J) => ({ text: "✗ " + str(r.label) + ": " + str(r.why), tone: "r" as Tone })),
      ...arr(a.alerts).map((x: J) => ({ text: str(x.text || x.title || x), tone: "r" as Tone })),
    ];
    if (!a.model) items.push({ text: "Shows " + arr(a.kpis).map((k: J) => k.label).join(", ") + " once the studio writes its KPI model (kpis.json)." });
    if (a.prod && a.prod.collected === false) items.push({ text: "Production " + str(a.prod.why || "not collected yet") });
    sections.push(list(String(a.name || a.app), items, { sub: a.model ? "KPI model" : "No KPI model yet" }));
    if (kp.length) {
      sections.push(
        table(String(a.name || a.app) + " · KPIs", ["KPI", "Now", "Target", "Status"], kp.map((k: J) => ({ cells: [cell(k.label), cell(k.value ?? "n/a", KPI_TONE(k)), cell(k.target ?? "—"), cell(k.status || "")], tone: KPI_TONE(k) }))),
      );
    }
  }
  for (const g of arr(j.sysKpis && j.sysKpis.groups)) {
    const live = arr(g.rows).filter((r: J) => r.live);
    if (!live.length) continue;
    sections.push(table("System · " + str(g.area), ["KPI", "Now", "Target", "State"], live.map(kpiRow), { sub: live.filter((r: J) => r.tone === "g").length + " of " + live.length + " on target", collapsed: true }));
  }
  const actions: DetailAction[] = [];
  const ad = o.appData;
  if (ad && ad.funnel) {
    sections.push(text("Production data", str(ad.text || ad.funnel.text || "")));
    if (ad.funnel.on === false) {
      actions.push({
        kind: "funnel-on",
        label: "Turn on public collection",
        args: {},
        confirm: "Turn on public collection? Production apps' events then reach the collector through the Tailscale Funnel (" + str(ad.funnel.endpoint || "") + ").",
      });
    }
  } else if (o.appData === null) {
    sections.push(text("Production data", "The production data panel did not answer."));
  }
  return { lead: "How each app we build is doing: its headline KPIs against target, how ready it is to launch, and its open alerts; then the system KPIs.", sections, actions };
}

// ---------- board ----------
const COL_NAME: Record<string, string> = {
  pending: "Backlog",
  recommendations: "Recommendations",
  todo: "To do",
  reopened: "Reopened",
  "in-progress": "In progress",
  "release-ready": "Release ready",
  released: "Released",
};
const PR_TONE: Record<string, Tone> = { critical: "r", high: "a" };

function board(j: J): Body {
  const B = j.board;
  if (!B) return { sections: [text("Board", "No board in the state.")] };
  if (B.err) return { sections: [text("Board", "Can't reach the board: " + str(B.err))] };
  const cols: J[] = arr(B.columns).length ? arr(B.columns) : Object.keys(COL_NAME).map((id) => ({ id, name: COL_NAME[id] }));
  const cards = arr(B.cards);
  const sections: DetailSection[] = [];
  const counts = B.counts || {};
  for (const c of cols) {
    const inCol = cards.filter((x: J) => x.col === c.id);
    if (!inCol.length && !counts[c.id]) continue;
    const rows: DetailRow[] = inCol.map((x: J) => {
      const fa = String(x.fa || "");
      const okFa = /^FA-\d{1,6}$/.test(fa);
      const acts: DetailAction[] = [];
      if (okFa) {
        if (x.col === "in-progress" && !x.paused) acts.push({ kind: "board-card", label: "Pause", args: { fa, action: "pause" }, confirm: "Pause " + fa + "? It moves to Reopened until resumed." });
        if (x.paused) acts.push({ kind: "board-card", label: "Resume", args: { fa, action: "resume" }, confirm: "Resume " + fa + "? It goes to To do, where the dispatcher draws it." });
        if (x.col === "recommendations") {
          acts.push({ kind: "board-card", label: "Backlog", args: { fa, action: "backlog" }, confirm: "Move " + fa + " to Backlog?" });
          acts.push({ kind: "board-card", label: "Promote", args: { fa, action: "promote" }, confirm: "Promote " + fa + " to To do?" });
        }
        // MI-157: every card and sub-card with an FA id carries Archive, after its other actions
        if (x.col !== "archived") acts.push({ kind: "board-card", label: "Archive", args: { fa, action: "archive" }, confirm: "Archive " + fa + "? It moves to Archived; nothing is deleted." });
      }
      const parent = x.parent ? cards.find((c: J) => c.id === x.parent || c.fa === x.parent) : null;
      const chips = [
        x.pr && x.pr !== "normal" ? x.pr + " priority" : "",
        x.est ? x.est + " min" : "",
        x.paused ? "paused" : "",
        x.blocked ? "blocked" : "",
        x.kids ? pl(x.kids, "sub-card") : "",
        x.parent ? "sub-card of " + (parent && parent.fa ? parent.fa : "a larger card") : "",
        x.app || "system",
      ].filter(Boolean);
      return {
        cells: [cell(fa, undefined, true), cell(x.title), cell(chips.join(" · "), PR_TONE[x.pr])],
        tone: x.paused || x.blocked ? "a" : PR_TONE[x.pr],
        actions: acts.length ? acts : undefined,
        find: fa + " " + str(x.title),
      };
    });
    const n = counts[c.id] ?? inCol.length;
    sections.push(
      table(String(c.name || COL_NAME[c.id] || c.id), ["Card", "Title", "Details"], rows, {
        sub: n + " card" + (n === 1 ? "" : "s") + (n > inCol.length ? " · " + inCol.length + " shown" : ""),
        collapsed: c.id === "released",
        empty: "No cards.",
      }),
    );
  }
  return {
    lead: "Updated " + (B.at ? ago(B.at, Date.now()) : "n/a") + ". Pause, resume, promote, backlog and archive go to the board itself.",
    search: { label: "Search cards", placeholder: "Card id or title, e.g. FA-18951" },
    sections,
  };
}

// ---------- models ----------
const LVL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", "haiku-4.5": "Haiku 4.5", other: "no model", unknown: "Not recorded" };
const lvl = (id: unknown) => LVL[String(id)] || str(id);

function models(j: J): Body {
  const m = j.models || {};
  const sc = j.scorecard || {};
  const sp = sc.spend || {};
  const tiers = arr(sp.tiers);
  const tot = tiers.reduce((a: number, t: J) => a + (num(t.usd) ?? 0), 0);
  const w = wkOf(sc);
  return {
    sections: [
      stats("Claude spend today", [
        { label: "Total", value: usd(tot), sub: w ? wkPct(wkUsd(w, tot)) + " of the weekly limit" : undefined },
        ...tiers.map((t: J) => ({ label: lvl(t.id), value: usd(t.usd), sub: t.level ? str(t.level) : undefined })),
        { label: "Escalated", value: pl(num(m.escalations) ?? 0, "card"), sub: (m.escalationEvents ?? m.escalations ?? 0) + " moves", tone: (num(m.escalations) ?? 0) > 5 ? "a" : undefined },
      ]),
      table(
        "Model use and cost today",
        ["Model", "As writer", "As reviewer", "As trainee", "Writing cost", "Review cost", "Trainee cost"],
        arr(m.use).map((x: J) => ({ cells: [lvl(x.id), String(x.drafter ?? 0), String(x.auditor ?? 0), String(x.shadow ?? 0), usd(x.usdDrafter), usd(x.usdAuditor), usd(x.usdShadow)] })),
        { numeric: [1, 2, 3, 4, 5, 6], sub: m.unattributedUsd ? usd(m.unattributedUsd) + " today came from earlier work that did not record which model it used." : undefined },
      ),
      table(
        "Trainee reviewer accuracy",
        ["Trainee", "Reviews", "Agreed", "Stricter", "Missed", "On plans", "On changes"],
        arr(m.calibration).map((x: J) => ({
          cells: [x.id === "haiku" ? "Haiku (earlier version)" : lvl(x.id), String(x.n ?? 0), Math.round((100 * (x.agree || 0)) / (x.n || 1)) + "%", String(x.over ?? 0), String(x.miss ?? 0), (x.PLAN ? x.PLAN.agree + "/" + x.PLAN.n : "—"), (x.READY ? x.READY.agree + "/" + x.READY.n : "—")],
        })),
        { numeric: [1, 2, 3, 4] },
      ),
      table(
        "Writer results by model level",
        ["Writer", "Attempts", "Passed", "Stuck", "Other", "Single pass", "Step by step"],
        arr(m.waterfall).map((x: J) => {
          const st = x.statuses || {};
          const kp = st["kit-pass"] || 0;
          const bl = st.blocked || 0;
          return { cells: [lvl(x.id), String(x.n ?? 0), String(kp), String(bl), String((x.n || 0) - kp - bl), String(x.direct || 0), String(x.fragment || 0)] };
        }),
        { numeric: [1, 2, 3, 4, 5, 6], sub: pl(num(m.escalations) ?? 0, "card") + " moved up to a stronger model today" },
      ),
      table(
        "Local model trial on the Halo",
        ["Card", "Model", "Result", "Size of the change", "When"],
        arr(m.midtier && m.midtier.rows)
          .slice()
          .reverse()
          .map((x: J) => ({
            cells: [cell(x.fa, undefined, true), cell(x.model), cell(x.result === "pass" ? "passed" : "failed", x.result === "pass" ? "g" : "r"), cell(String(x.stat || "").replace(/insertions?\(\+\)/, "lines added").replace(/deletions?\(-\)/, "removed")), hm(x.at)],
          })),
        { sub: m.midtier && m.midtier.running ? "running now" : "not running" },
      ),
    ],
  };
}

// ---------- halo ----------
const STATE_TONE: Record<string, Tone> = { running: "g", "on demand": "d", stopped: "d", failed: "r", starting: "a", loading: "a" };

function halo(j: J, o: DetailOptions, now: number): Body {
  const H = (j.status || {}).halo || {};
  const h = j.halo || {};
  const v = h.vitals || {};
  const GB = (b: unknown) => (num(b) == null ? "n/a" : Math.round((b as number) / 1073741824) + " GB");
  const vit: DetailStat[] = v.ok
    ? [
        { label: "Processor", value: v.load && v.cpus ? Math.round((100 * v.load[0]) / v.cpus) + "%" : "n/a", sub: (v.cpus ?? "?") + " cores" },
        { label: "Memory used", value: v.MemTotal ? GB(v.MemTotal - v.MemAvailable) : "n/a", sub: v.MemTotal ? GB(v.MemAvailable) + " available of " + GB(v.MemTotal) : undefined },
        { label: "GPU busy", value: (num(v.gpu_busy_percent) ?? 0) + "%" },
        { label: "Model memory", value: GB(v.mem_info_gtt_used), sub: "of " + GB(v.mem_info_gtt_total) },
        { label: "Power", value: num(v.powerW) != null ? v.powerW.toFixed(0) + " W" : "n/a" },
        { label: "Up", value: v.uptimeS ? minTxt(v.uptimeS / 60) : "n/a" },
      ]
    : [{ label: "Health", value: "readings unavailable", tone: "r", sub: str(v.err || "") }];
  const servers = arr(h.servers);
  const byId = new Map(servers.map((s: J) => [s.id, s]));
  const reg = o.haloModels;
  const modelRows: DetailRow[] = (Array.isArray(reg) ? reg : servers).map((r: J) => {
    const s: J = byId.get(r.id) || {};
    const st = String(r.state || (s.up ? "running" : "stopped"));
    const id = String(r.id || "");
    const okId = /^[\w.-]+$/.test(id) && Array.isArray(reg);
    const enabled = r.enabled !== false;
    return {
      cells: [
        cell(r.name || s.name || id),
        cell(r.kind || "llm"),
        cell(st, STATE_TONE[st]),
        cell(
          st === "running" || s.loaded
            ? (r.gpuGB ?? r.rssGB ?? s.loadedGB ?? "?") + " GB memory" + (r.sizeGB != null ? " · " + r.sizeGB + " GB disk" : "")
            : "not loaded" + (r.sizeGB != null ? " · " + r.sizeGB + " GB disk" : ""),
        ),
        cell(s.slotsTotal ? (s.busy ?? 0) + "/" + s.slotsTotal + " slots busy · " + (s.reqHour ?? 0) + " req/h" : "Idle today"),
      ],
      tone: STATE_TONE[st],
      note: arr(r.uses).length ? "Runs: " + arr(r.uses).map(str).join(", ") : r.why ? str(r.why) : undefined,
      actions: okId
        ? [
            enabled
              ? { kind: "halo-model", label: "Turn off", args: { id, enabled: false }, confirm: "Turn off " + str(r.name || id) + "? Its jobs fall back to their next choice.", danger: true }
              : { kind: "halo-model", label: "Turn on", args: { id, enabled: true }, confirm: "Turn on " + str(r.name || id) + "?" },
          ]
        : undefined,
    };
  });
  const jobsRows: DetailRow[] = arr(h.modelJobs).map((m: J) => ({
    cells: [cell(m.model), cell(m.where || ""), cell(arr(m.jobs).map((x: J) => x.name).join(", ") || "nothing runs on it yet")],
    note: str(arr(m.jobs).map((x: J) => "• " + x.name + (x.what ? ": " + x.what : "")).join("\n")) || undefined,
  }));
  const mb = h.memBudget;
  return {
    lead:
      (H.up ?? 0) + " of " + (H.total ?? 0) + " up" + (arr(H.failed).length ? ", " + arr(H.failed).length + " failed" : "") + " · " + str(H.label || "") +
      (h.usage && h.usage.reqLastHour != null ? " · " + h.usage.reqLastHour + " requests last hour" : "") + (v.at ? " · read " + ago(v.at, now) : ""),
    sections: [
      stats("Vitals", vit),
      table("Models: memory, state, live load, on and off", ["Model", "Kind", "State", "Memory", "Load"], modelRows, {
        sub: mb ? mb.gb + " GB free · " + str(mb.sub || "") : undefined,
        empty: reg === null ? "The model list (the cockpit's halomodels) did not answer." : "No models.",
      }),
      table("What runs on each model", ["Model", "Where", "Jobs"], jobsRows, { collapsed: true }),
    ],
  };
}

// ---------- halocaps ----------
function halocaps(j: J, now: number): Body {
  const hc = j.haloCaps;
  if (!hc || hc.err) return { sections: [text("Halo capabilities", hc && hc.err ? "Unreadable: " + str(hc.err) : "Reading the Halo.")] };
  const infra = arr(hc.infra);
  return {
    lead: str(hc.head || "") + " · every Halo script costs $0 Claude",
    sections: [
      list("The Halo machine itself · CPU side, no AI model", arr(hc.machine).map((m: J) => ({ strong: str(m.name), text: str(m.what || m.state), tone: m.state === "live" ? ("g" as Tone) : undefined }))),
      table(
        "Models",
        ["Model", "Kind", "State", "Serves"],
        arr(hc.models).map((m: J) => ({ cells: [cell(m.name || m.id), cell(m.kind), cell(m.state, STATE_TONE[m.state]), cell(arr(m.serves).join(", ") + (m.more ? " +" + m.more + " more" : ""))], tone: STATE_TONE[m.state] })),
      ),
      table(
        "Halo scripts · $0 Claude: deterministic scripts and Halo model agents",
        ["Script", "Kind", "Cadence", "Last run", "Status"],
        infra.map((x: J) => {
          const bad = x.on && x.status && x.status !== "ok" && x.statusKind !== "work";
          return {
            cells: [cell(x.title || x.name), cell(x.kind), cell(x.cadence), cell(x.lastText || (x.last ? ago(x.last, now) : "never")), cell(x.on ? x.status || "—" : "off", bad ? "a" : x.status === "ok" ? "g" : "d")],
            tone: bad ? "a" : undefined,
          };
        }),
        { sub: infra.filter((x: J) => x.on).length + " on of " + infra.length },
      ),
    ],
  };
}

// ---------- hygiene ----------
function hygiene(j: J, now: number): Body {
  const hy = j.hygiene;
  if (!hy) return { sections: [text("Board upkeep", "No upkeep data in the state.")] };
  const rel = hy.relevance || {};
  return {
    sections: [
      stats(
        "Board relevance check",
        arr(rel.sections).map((s: J) => ({ label: str(s.name), value: String(s.n ?? 0), tone: s.n ? ("a" as Tone) : undefined })),
        { sub: str(rel.last || "") + " · " + (rel.apply ? "applies its verdicts" : "preview only, nothing is changed") },
      ),
      table(
        "Ready but refused by the driver",
        ["Card", "Ready by", "Waiting", "Why"],
        arr(hy.readyRefused).map((x: J) => ({ cells: [cell(x.fa, undefined, true), cell(x.by), minTxt(x.waitMin), cell(x.why, "r")], note: x.cls ? str(x.cls) : undefined })),
        { sub: hy.refusedChip ? str(hy.refusedChip.t) : undefined },
      ),
      table(
        "Landed on master, awaiting release",
        ["Card", "Title", "Board column", "Landing commit"],
        arr(hy.awaitingRelease).map((x: J) => ({ cells: [cell(x.fa, undefined, true), cell(x.title), cell(COL_NAME[x.col] || x.col), cell(String(x.sha || "").slice(0, 10), undefined, true)], note: x.why ? str(x.why) : undefined })),
        { sub: hy.awaitingChip ? str(hy.awaitingChip.t) : undefined },
      ),
      table(
        "Board moves the lane was not allowed to make today",
        ["Move", "Times", "Latest"],
        arr(hy.columnRefusals).map((x: J) => ({ cells: [cell(x.move || x.what || (x.from ? x.from + " → " + x.to : "")), String(x.n ?? x.times ?? 1), cell(x.latest ? hm(x.latest) + (x.fa ? " · " + x.fa : "") : x.at ? ago(x.at, now) : "")] })),
      ),
      table(
        "Cards needing details · changed since review",
        ["Card", "Kind", "Why"],
        [
          ...arr(hy.preflightBlocked).map((x: J) => ({ cells: [cell(x.fa || x.id, undefined, true), "needs details", cell(x.why || x.reason || "")] })),
          ...arr(hy.staleReviews).map((x: J) => ({ cells: [cell(x.fa || x.id, undefined, true), "changed since review", cell(x.why || "")] })),
        ],
      ),
    ],
  };
}

// ---------- events ----------
const EVK: Record<string, { icon: string; label: string }> = {
  good: { icon: "✅", label: "Good" },
  problem: { icon: "⛔", label: "Problems" },
  attention: { icon: "⚠️", label: "Needs a look" },
  work: { icon: "🔧", label: "Work" },
  system: { icon: "⚙️", label: "System" },
};

function events(j: J): Body {
  const ev = arr(j.events).slice().sort((a: J, b: J) => (num(b.at) ?? 0) - (num(a.at) ?? 0));
  const kindOf = (e: J) => {
    const k = e.w && e.w.kind;
    if (EVK[k]) return k;
    return e.cls === "bad" || e.cls === "error" ? "problem" : e.cls === "warn" ? "attention" : e.cls === "good" ? "good" : "system";
  };
  const counts: Record<string, number> = {};
  for (const e of ev) counts[kindOf(e)] = (counts[kindOf(e)] || 0) + 1;
  const rows: DetailRow[] = ev.map((e: J) => {
    const k = kindOf(e);
    const tone: Tone | undefined = k === "problem" ? "r" : k === "attention" ? "a" : k === "good" ? "g" : undefined;
    return {
      cells: [cell(hm(e.at), undefined, true), cell(((e.w && e.w.icon) || EVK[k].icon) + " " + ((e.w && e.w.text) || e.text || ""), tone)],
      tag: k,
      tone,
      note: e.w && e.w.text && e.text && e.w.text !== e.text ? str(e.text) : undefined,
    };
  });
  return {
    filters: [
      {
        key: "kind",
        label: "Show",
        value: "all",
        server: false,
        options: [{ value: "all", label: "All", count: ev.length }, ...Object.entries(EVK).map(([value, x]) => ({ value, label: x.icon + " " + x.label, count: counts[value] || 0 }))],
      },
    ],
    sections: [table("Activity", ["Time", "What happened"], rows, { sub: pl(ev.length, "event") + " in the feed, newest first", empty: "No events recorded." })],
  };
}

const BUILDERS: Record<CardId, (j: J, o: DetailOptions, now: number) => Body> = {
  score: (j, o) => score(j, o.costPanel),
  pipeline: (j) => pipeline(j),
  production: (j) => production(j),
  board: (j) => board(j),
  jobs: (j, _o, now) => jobs(j, now),
  forge: (j, _o, now) => forge(j, now),
  orphans: (j) => orphans(j),
  hygiene: (j, _o, now) => hygiene(j, now),
  events: (j) => events(j),
  models: (j) => models(j),
  halo: (j, o, now) => halo(j, o, now),
  halocaps: (j, _o, now) => halocaps(j, now),
  modes: (j, o) => modes(j, o),
  appkpis: (j, o) => appkpis(j, o),
};

/** Pure: one card's detail from a state object. Never throws: a broken builder gives an error section. */
export function buildDetail(id: CardId, j: J, o: DetailOptions = {}): CardDetail {
  const now = o.now ?? Date.now();
  const face = faceOf(j, id, now);
  const head = {
    id,
    title: CARD_TITLES[id],
    tone: face.tone,
    headline: face.headline,
    sub: face.sub,
    chips: face.chip ? [{ t: face.chip, tone: face.tone }] : [],
    at: now,
  };
  if (!j || typeof j !== "object") return { ...head, ok: false, error: "no cockpit state", sections: [] };
  try {
    const b = BUILDERS[id](j, o, now);
    return { ...head, ok: true, ...b, lead: b.lead ? str(b.lead) : undefined };
  } catch (e) {
    return { ...head, ok: false, error: "this part of the state could not be read: " + str(e instanceof Error ? e.message : e), sections: [] };
  }
}
