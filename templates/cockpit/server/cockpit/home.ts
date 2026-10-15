/**
 * The full cockpit's top bar and home column (FA-19087), built from the cockpit
 * client's resources alone (client.ts): the status pill, account, push, master
 * and phone chips; the lane switches; the Budget; the office tiles; the three
 * faces; the drafting-mode face; and the key-number tiles with their charts.
 * Each piece is a port of the legacy renderer it replaces in
 * tools/lane/maint/ui/index.html (named beside it), so a tile here says what
 * the legacy tile said. Every piece is built on its own: an absent resource
 * gives that piece its "no data yet" words, never a throw.
 */
import type { CardId, Tone } from "../../shared/cockpit.js";
import type {
  BudgetView,
  FaceView,
  HeaderView,
  HomeView,
  KChart,
  KeyTile,
  KTone,
  LaneView,
  ModeView,
  OfficeTile,
  OfficeView,
  Opens,
} from "../../shared/cockpit-home.js";
import { getMany } from "./client.js";

type J = any;

/** The resources the home reads (all in the client's manifest; FA-19087 added home, budget, release, jevsavings, account, master and android). */
export const HOME_RESOURCES = [
  "status",
  "score",
  "modes",
  "home",
  "office",
  "features",
  "halosave",
  "balancer",
  "jevsavings",
  "budget",
  "account",
  "master",
  "android",
  "release",
] as const;

const card = (c: CardId): Opens => ({ card: c });
const legacy = (s: string): Opens => ({ legacy: s });
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, d = 1): string => (v == null || !Number.isFinite(Number(v)) ? "n/a" : Number(v).toFixed(d)); // the legacy num()
const usd = (x: unknown) => (isNum(x) ? "$" + x.toFixed(2) : "n/a");
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
const wkPct = (p: unknown) => (!isNum(p) ? "n/a" : p >= 10 ? Math.round(p) + "%" : p >= 1 ? p.toFixed(1) + "%" : p.toFixed(2) + "%");
const hm = (t: number) => {
  const d = new Date(t);
  return isNaN(+d) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
};
const md = (t: number | string) => {
  const d = new Date(t);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const nxMoney = (v: number) => (v >= 10 ? "$" + Math.round(v) : v >= 1 ? "$" + v.toFixed(1) : "$" + v.toFixed(2));
const hsD = (x: unknown) => {
  if (!isNum(x)) return "n/a";
  const v = Math.abs(x),
    t = v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2);
  return (x < 0 && +t ? "−$" : "$") + t;
};
const hsShare = (x: unknown) => (!isNum(x) ? "n/a" : x > 0 && x < 0.001 ? "<0.1%" : (100 * x).toFixed(x < 0.1 ? 1 : 0) + "%");
const balD = (v: unknown) => (!isNum(v) ? "n/a" : (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2));
const tone3 = (v: number, good: (v: number) => boolean, ok: (v: number) => boolean): KTone => (good(v) ? "g" : ok(v) ? "a" : "r");
const wkOf = (sc: J) => (sc && sc.week && sc.week.rate && sc.week.today != null ? sc.week : null);
const wkUsd = (w: J, v: unknown) => (w && isNum(v) ? Math.round(v * w.rate.pctPerUsd * 100) / 100 : null);
const day = (s: string) => Date.parse(s + "T12:00:00Z");

// ---------- the top bar (renderHeader / summaries' brand pill, account.js paintChip, push.js chip, usageView, phone.js) ----------
function haloHeadTone(H: J): Tone {
  const up = (H && H.up) || 0,
    tot = (H && H.total) || 0;
  return tot && up === tot ? "g" : up ? "a" : "r";
}
export function headerOf(d: Record<string, J>, at: number): HeaderView {
  const st = d.status || {},
    dr = st.driver || {},
    la = st.lander || {};
  let status: HeaderView["status"];
  if (!d.status) status = { text: "Reading…", tone: "d" };
  else {
    const stopped = !!dr.paused,
      bad = !stopped && (!dr.up || !la.up),
      warn = stopped || dr.draining || dr.throttled || la.halt || haloHeadTone(st.halo) !== "g";
    status = {
      text: stopped ? (dr.maintenance ? "Maintenance" : "Stopped") : bad ? "Needs attention" : dr.draining ? "Updating" : dr.throttled ? "Paused (Mac busy)" : "All good",
      tone: bad ? "r" : warn ? "a" : "g",
    };
  }
  const a = d.account;
  let account: HeaderView["account"] = null;
  if (a && a.chip) {
    const c = a.chip,
      short = (e: string) => (!e ? "" : e.length > 24 ? e.split("@")[0].slice(0, 16) + "@…" : e);
    const label = c.head ? c.head : c.tone === "off" ? "Sign in" : c.tone === "busy" || c.tone === "failed" ? c.label : c.tone === "unknown" ? "Account" : short(c.label);
    const hf = c.halo && c.tone !== "busy" ? { text: String(c.halo.short || ""), match: c.halo.match === true ? true : c.halo.match === false ? false : null } : null;
    const title = (c.label && c.tone !== "off" ? "Mac: " + c.label + (c.plan || "") + " - " : "") + (c.sub || "") + (c.halo ? ". " + c.halo.text : "");
    account = { label: String(label || "Account"), tone: String(c.tone || ""), title, halo: hf };
  }
  const r = d.release;
  const push: HeaderView["push"] = r
    ? {
        ahead: isNum(r.ahead) ? r.ahead : 0,
        blocked: r.blocked ? String(r.blocked) : null,
        title: r.blocked ? "Push to remote: " + r.blocked : "Push to remote: " + (r.ahead || 0) + " commit" + (r.ahead === 1 ? "" : "s") + " from local master to " + (r.upstream || "origin"),
      }
    : null;
  const m = d.master;
  const master: HeaderView["master"] = m
    ? { replyAts: (Array.isArray(m.replies) ? m.replies : []).map((x: J) => (typeof x.at === "number" ? x.at : Date.parse(x.at)) || 0).filter((t: number) => t > 0) }
    : null;
  const an = d.android;
  let phone: HeaderView["phone"] = null;
  if (an && typeof an === "object") {
    const ready = Array.isArray(an.devices) ? an.devices.filter((x: J) => x.state === "device") : [];
    const state = typeof an.state === "string" && an.state ? an.state : !an.adb ? "noadb" : an.job ? "installing" : !an.devices || !an.devices.length ? "none" : an.devices.some((x: J) => x.state === "unauthorized") && !ready.length ? "unauthorized" : an.installed ? "installed" : an.last && an.last.ok === false ? "failed" : "ready";
    const W: Record<string, [string, string]> = {
      noadb: ["no adb", "adb is not on this Mac: install Android SDK Platform-Tools"],
      none: ["no device", "No phone: plug in a phone with USB debugging on"],
      unauthorized: ["allow USB", "The phone is attached but not authorized: accept the USB debugging prompt on the phone"],
      ready: ["ready", "Ready to install on " + (ready.length === 1 ? ready[0].model || ready[0].serial : ready.length + " devices: pick one")],
      installing: ["installing", "Installing on the phone"],
      installed: ["installed", "Installed on the phone"],
      failed: ["failed", "Install failed: " + ((an.last && an.last.reason) || "unknown") + (an.last && an.last.hint ? " - " + an.last.hint : "")],
    };
    const w0 = W[state] || W.none;
    phone = { word: w0[0], state, title: "Phone app: " + w0[1] };
  }
  let usage: HeaderView["usage"] = null;
  const w = a && a.budget && a.budget.windows;
  if (w && (w.five_hour || w.seven_day)) {
    const pct = (x: J) => (x && isNum(x.util) ? Math.round(100 * x.util) : null);
    const s = pct(w.five_hour),
      k = pct(w.seven_day);
    if (s != null || k != null) {
      const atR = (a.fresh && a.fresh.at) || (a.budget && a.budget.sampleAt) || 0,
        age = atR ? Math.max(0, Math.round((Date.now() - atR) / 60000)) : null;
      const ageT = age == null ? "age unknown" : age < 1 ? "just now" : age < 60 ? age + " min old" : Math.round(age / 60) + " h old";
      usage = { session: s, week: k, title: [s != null ? "Session (5 h): " + s + "%" : "", k != null ? "Weekly: " + k + "%" : "", "Reading " + ageT].filter(Boolean).join("\n") };
    }
  }
  return { status, at, account, push, master, phone, usage };
}

// ---------- the lane switches (locksTick) and the Budget (bPaint) ----------
export function laneOf(d: Record<string, J>): LaneView {
  const L = d.status && d.status.locks;
  if (!L || typeof L !== "object") return { unlocked: null, production: null, client: null };
  return { unlocked: L.masterIntervene === true, production: L.dispatcher !== false, client: L.haloClient !== false };
}
export function budgetOf(d: Record<string, J>): BudgetView | null {
  const b = d.budget;
  if (!b || typeof b !== "object" || (!("auto" in b) && !("pctPerDay" in b))) return null;
  const auto = !!b.auto,
    v = isNum(b.pctPerDay) ? b.pctPerDay : null;
  return { auto, pctPerDay: v, shown: auto && (b.capacity || v == null) ? "Auto" : v == null ? "…" : Math.round(v * 10) / 10 + "%", line: String(b.line || ""), capacity: !!b.capacity };
}

// ---------- the office (renderOffice, the six-tile face) ----------
export function officeOf(d: Record<string, J>): OfficeView {
  const o = d.office && d.office.data,
    h0 = d.home || {},
    st = d.status || {},
    dr = st.driver || {};
  if (!o || o.err) return { head: o && o.err ? "office not available: " + o.err : "office loading…", tiles: null, note: "", aria: "Agent office", title: "" };
  const fx = h0.officeFacts || o.facts || null,
    W: J[] = Array.isArray(o.workers) ? o.workers : [];
  const qn = (o.queue && o.queue.n) || 0,
    h = o.halo || {},
    cm = o.commits || {},
    rf = fx && fx.refusals;
  const head = dr.maintenance ? "maintenance" : o.paused ? "lane stopped" : W.length ? "working" : "idle";
  const sh = h0.officeShape && typeof h0.officeShape === "object" && h0.officeShape.now ? h0.officeShape : null;
  const bk = sh && sh.now && sh.now.byKind && typeof sh.now.byKind === "object" ? sh.now.byKind : null;
  const nWork = bk ? (bk.door || 0) + (bk.subagent || 0) + (bk.engine || 0) + (bk.roster || 0) : W.length,
    nLand = bk ? bk.lander || 0 : cm.pending || 0;
  const limN = bk && sh.balance && sh.balance.running != null ? sh.balance.running : o.limit ?? "?";
  const tips = {
    queue: qn + " agent job(s) and card(s) not started yet (not the commit queue)",
    commits: (cm.pending || 0) + " submission(s) waiting for their proof" + (cm.proven ? ", " + cm.proven + " proven and waiting to merge" : ""),
    refusals: rf && rf.share != null ? rf.refused + " of " + (rf.committed + rf.refused) + " submissions refused in 24 h" + (Array.isArray(rf.top) && rf.top.length ? "; most: " + rf.top[0] + " (" + rf.top[1] + ")" : "") : "",
    halo: (h.up ?? 0) + " of " + (h.total ?? 0) + " model servers up; " + (h.busy ?? 0) + " of " + (h.slots ?? 0) + " slots busy" + (h.gen ? "; " + h.gen + " image/video job(s) generating" : ""),
  };
  const pct = (x: unknown) => (isNum(x) ? Math.round(x * 100) : null);
  const tiles: OfficeTile[] | null = fx
    ? [
        { id: "agents", icon: "👥", n: nWork, suffix: "/" + limN, label: "Working", title: bk ? nWork + " agent run(s) now (door, subagent, engine and roster rows), of an agent limit of " + limN : W.length + " agent run(s) now, of an agent limit of " + (o.limit ?? "?"), tone: nWork ? "g" : "d", live: nWork > 0 },
        { id: "queue", icon: "⏳", n: qn, suffix: "", label: "Waiting", title: tips.queue, tone: qn ? "a" : "d" },
        { id: "commits", icon: "📦", n: nLand, suffix: cm.proven ? " · " + cm.proven + " ok" : "", label: "Commits", title: (bk ? nLand + " landing set(s) in the who stream" : tips.commits) + ". Opens the queue.", tone: nLand ? "a" : "d", queue: true },
        { id: "landed", icon: "🚀", n: o.landedToday == null ? null : o.landedToday, suffix: "", label: "Landed today", title: (o.landedToday || 0) + " commit(s) landed today", tone: "g" },
        { id: "halo", icon: "🛰️", n: h.up ?? null, suffix: "/" + (h.total ?? "?"), label: "Halo up", title: tips.halo, tone: h.total && h.up < h.total ? "a" : "g", live: (h.busy || 0) > 0 },
        { id: "refusals", icon: "🛑", n: rf && rf.share != null ? pct(rf.share) : null, suffix: "%", label: "Refused", title: tips.refusals, tone: rf && rf.share > 0.3 ? "a" : "g" },
      ]
    : null;
  const title = sh ? [sh.flow && sh.flow.text, sh.balance && sh.balance.text, sh.now && sh.now.rows && sh.now.rows.length ? sh.now.rows.length + " working now" : ""].filter(Boolean).join(" · ") : "";
  const aria =
    "Agent office: " + pl(W.length, "agent") + " working of " + (o.limit ?? "?") + ", " + qn + " waiting to start, " + (cm.pending || 0) + " in the commit queue, " + (o.landedToday || 0) + " landed today" + (o.paused ? ", lane stopped" : "") + ". Open Who's working";
  return { head, tiles, note: tiles ? "" : "office facts loading…", aria, title };
}

// ---------- the three faces (renderFaces) ----------
const FACE_LAB: Record<FaceView["id"], [string, Opens, string]> = {
  overview: ["Overview", legacy("overview"), "Overview: mode, goal, next card and readiness; open the Overview"],
  doorLanding: ["Door → landing", legacy("overview"), "Door to landing: the share of door-run cards that landed in 24 h, and the runs and dollars per landing"],
  speed: ["Speed", card("score"), "Speed: components past their p90 target, and the slowest; open the scorecard"],
};
export function facesOf(d: Record<string, J>): FaceView[] {
  const F = (d.home && d.home.faces) || {};
  return (Object.keys(FACE_LAB) as FaceView["id"][]).map((id) => {
    const f = F[id],
      [label, opens, aria] = FACE_LAB[id];
    return { id, label, headline: f ? String(f.headline ?? "-") : "-", detail: f ? String(f.detail ?? "") : "no data yet", flag: !!(f && f.flag), aria, opens };
  });
}

// ---------- the drafting-mode face (modeFace) ----------
export function modeOf(d: Record<string, J>): ModeView | null {
  const mdx = d.modes && d.modes.scoreModes;
  if (!mdx || !mdx.all || !mdx.all.fragment || !mdx.all.direct) return null;
  const E: Record<string, string> = { fragment: "🧩", direct: "🎯" };
  const n = (x: J) => (x && x.fragment && x.direct ? (x.fragment.pods || 0) + (x.direct.pods || 0) : 0);
  const t = mdx.today && n(mdx.today) ? mdx.today : mdx.all,
    when = t === mdx.all ? "all recorded pods" : "today";
  const label = "Drafting mode outcomes";
  if (!n(t)) return { label, head: "No mode chosen yet", detail: "No pods recorded yet.", opens: card("modes") };
  const m = t.direct.share >= t.fragment.share ? "direct" : "fragment",
    o = m === "direct" ? "fragment" : "direct",
    a = mdx.all[m],
    b = mdx.all[o];
  const lands = (x: J) => (x && x.cards ? Math.round((100 * x.landed) / x.cards) + "%" : "n/a");
  const cap = m.charAt(0).toUpperCase() + m.slice(1);
  return { label, head: E[m] + " " + cap + " · " + Math.round(100 * t[m].share) + "%", detail: cap + " took " + t[m].pods + " of " + n(t) + " pods " + when + "; it lands " + lands(a) + " of its cards, " + o + " " + lands(b) + ".", opens: card("modes") };
}

// ---------- the key numbers ----------
function savedPct(h0: J, part: "jev" | "halo") {
  const sa = (h0 && h0.savedAll) || {},
    tp = sa[part + "Today"],
    td = tp && tp.headline ? tp : null,
    a = td || sa[part];
  return a && a.headline ? { txt: String(a.headline), vs: a.vs ? String(a.vs) : "", today: !!td, why: td ? td.why : null } : null;
}
const yMoney = (mx: number): [string, string, string] => [nxMoney(mx), nxMoney(mx / 2), "$0"];

/** renderVelTile + renderKeyNumbers part 2: units per hour, the goal, net per 30 min */
function velTile(sc: J, h0: J, st: J): KeyTile {
  const v = sc && sc.velocity,
    cq = st && Array.isArray(st.queue) ? st.queue.length : null;
  const u = h0.throughput,
    ug = u && u.goal,
    gl = ug ? ug.perHour : null,
    vb = h0.velocityBar || null,
    bar = vb ? vb.bar : gl;
  const l12: number[] = u && Array.isArray(u.hourly) ? u.hourly.map((x: J) => x.units || 0) : Array.isArray(h0.last12) ? h0.last12 : [];
  const c12: number[] = u && Array.isArray(u.hourly) ? u.hourly.map((x: J) => x.commits || 0) : [];
  const top = Math.max(1, bar || 0, ...l12, ...c12);
  const lr = h0.landedRate,
    hv = lr ? lr.perHour : u ? u.perHour : sc && sc.perHour;
  const lines: KeyTile["lines"] = [];
  lines.push({
    text: vb
      ? "target " + num(vb.bar, 0) + "/h at " + num(vb.couldRun, 0) + (vb.couldRun === 1 ? " could-run agent" : " could-run agents") + " · " + (vb.boundText || "bind not recorded")
      : u
        ? "last 60 min " + u.lastHour + " · goal " + (gl ? num(gl, 0) : "n/a") + " · " + num(u.commits && u.commits.perHour, 0) + " commits/h"
        : "last 60 min " + ((sc && sc.lastHour) ?? 0),
  });
  let icon = "",
    net = "",
    tone: KTone = "d",
    nets: number[] = [],
    netMax = 1;
  if (v && Array.isArray(v.windows)) {
    const sg = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
    const nm = isNum(v.netMinutes) ? Math.round(v.netMinutes) : null,
      nt = nm != null ? nm : v.net;
    tone = nt > 0 ? "g" : nt < 0 ? (nm == null && v.windows[1] && v.windows[1].net < 0 ? "r" : "a") : "d";
    icon = nt > 0 ? "🚀▲" : nt < 0 ? "🐢▼" : "⏸️";
    net = nm != null ? "net " + sg(nm) + " min · 30 min" : "net " + sg(v.net) + " · 30 min";
    lines.push({ text: "queue now: " + v.queueTasks + " requests" + (cq != null ? " + " + cq + " cards" : "") });
    nets = [...v.windows].reverse().map((w: J) => w.net || 0);
    netMax = Math.max(1, ...nets.map((x) => Math.abs(x)));
  } else {
    net = "…";
    lines.push({ text: "counting the last two hours" });
  }
  const title = lr
    ? "landed sets in the last 60 min (the lander's landings on master, not roster-request units) · " + lr.today + " today" + (lr.byKind ? "\nby kind: " + lr.byKind.hot + " hot, " + lr.byKind.system + " system, " + lr.byKind.production + " production" : "") + (lr.byWho ? "\nby who: " + lr.byWho.door + " door run, " + lr.byWho.master + " master, " + lr.byWho.roster + " roster" : "")
    : "Units landed per hour · last 60 min";
  return {
    id: "kVel",
    label: "Velocity",
    value: num(hv),
    tone,
    lines,
    title,
    wide: true,
    icon,
    net,
    chart: { kind: "velocity", values: l12, top, goal: bar || null, net: nets, netMax },
    opens: card("score"),
  };
}

/** renderKeyNumbers part 1: commits landed today, one bar per clock hour */
function landedTile(sc: J, h0: J): KeyTile {
  const ct = h0.commitsToday,
    bh: number[] = (ct ? ct.byHour : sc && sc.byHour) || [],
    bmax = Math.max(1, ...bh);
  const n = ct ? ct.n : sc && sc.landed,
    lastH = ct ? ct.lastHour : sc && sc.lastHour;
  const releasedLine = ((sc && sc.lastHour) ?? 0) + " landed in the last 60 min · peak hour " + Math.max(0, ...((sc && sc.byHour) || []));
  return {
    id: "kLanded",
    label: "Landed today",
    value: n == null ? "-" : String(n),
    tone: lastH ? "g" : n ? "a" : "r",
    lines: [{ text: (ct ? ((sc && sc.landed) || 0) + " cards released · " : "") + releasedLine }],
    title: (ct ? ct.n + " commits on master since local midnight · " + ct.lastHour + " in the last 60 min · bars: commits per clock hour · " : "") + "released cards counted from the board",
    chart: { kind: "bars", values: bh, max: bmax, yLabels: [String(bmax), String(Math.round(bmax / 2)), "0"], xLabels: bh.length >= 4 ? [0, 0.5, 1].map((f) => String(Math.round(f * (bh.length - 1))).padStart(2, "0") + ":00") : [] },
    art: "landed",
    opens: card("score"),
  };
}

/** jevReplay + jevCard + renderJevTile */
function jevTile(js: J, h0: J): KeyTile {
  const t = js && js.today,
    v = t && t.jev,
    g = t && t.jevgrep;
  const sp = savedPct(h0, "jev");
  const F = h0.saveForecast;
  const label = sp && sp.today ? "JEV + JevGrep + reset · vs off · today" : "JEV + JevGrep · saved vs without it · all history";
  const days: J[] = (js && Array.isArray(js.days) ? js.days : []).slice(-7);
  const live = days.map((x) => (isNum(x.usdSaved) ? x.usdSaved : 0));
  // the replay bars: the save forecast's jev $ per day (fcBars), else none
  const by = new Map<string, number>(((F && F.days) || []).map((x: J) => [x.day, x.jev && x.jev.usd]));
  const dk = (s: string) => (/^\d{4}-\d\d-\d\d$/.test(s) ? s : new Date(s).toISOString().slice(0, 10));
  const other = days.map((x) => {
    const r = by.get(dk(x.day));
    return isNum(r) ? r : 0;
  });
  const mx = Math.max(1e-9, ...live, ...other);
  let val: string, tone: KTone, head: string;
  const d2 = (x: unknown) => "$" + Number(x || 0).toFixed(2);
  if (!v || !g) {
    val = "Savings data not available yet";
    head = val;
    tone = "d";
  } else {
    const measured = (t.usdSaved || 0) > 0 || g.usdSaved != null || (v.verdicts || 0) > 0;
    val = measured ? d2(t.usdSaved) : "no measured saving yet";
    head = measured ? "JEV + JevGrep saved " + d2(t.usdSaved) + " today" : "No measured saving yet today";
    tone = measured ? (t.usdSaved > 0 ? "g" : "a") : "a";
  }
  const lines: KeyTile["lines"] = [];
  if (sp && sp.vs) lines.push({ text: sp.vs });
  else if (v) lines.push({ text: val === "no measured saving yet" ? "no $ saved yet today" : val + " saved today" });
  const r = h0.resetShadow;
  if (r && r.coverage != null) {
    const p = (x: number) => {
      const y = 100 * (x || 0);
      return (y >= 100 ? "100" : y >= 99 ? (Math.floor(y * 100) / 100).toFixed(2) : y.toFixed(1)) + "%";
    };
    lines.push({
      text: "retention " + p(r.coverage) + " · target 100%",
      tone: r.coverage >= 1 ? "g" : "a",
      title: "Master reset (shadow): " + p(r.coverage) + " of the facts master's window held and later used are kept by the resume packet, over " + r.safe + " of " + r.breaks + " safe breaks",
    });
  }
  return {
    id: "kJev",
    label,
    value: sp ? sp.txt : val,
    valueTone: sp || /^\$/.test(val) ? undefined : "n",
    tone,
    lines,
    title: head + (sp && sp.why ? "\n" + sp.why : "") + (days.length ? "\nbars: $ saved per day, last 7 days: " + days.map((x) => md(day(dk(x.day))) + " " + (isNum(x.usdSaved) ? "$" + x.usdSaved.toFixed(2) : "n/a")).join(" · ") : ""),
    chart: { kind: "pairs", live, other, max: mx, yLabels: yMoney(mx), xLabels: days.length > 1 ? [md(day(dk(days[0].day))), md(day(dk(days[days.length - 1].day)))] : [] },
    art: "jev",
    opens: legacy("jev"),
  };
}

/** hsCard + fcHalo + renderHaloTile */
function haloTile(hs: J, h0: J): KeyTile {
  const sp = savedPct(h0, "halo");
  const label = sp && sp.today ? "Halo · saved vs off · today" : "Halo · saved vs without it · all history";
  const ok = !!(hs && hs.live && hs.shadow);
  let val = "no data yet",
    tone: KTone = "d",
    a = "",
    head = "Halo savings data not available yet";
  let bars: { day: string; live: number; shadow: number }[] = [];
  if (ok) {
    const P = hs.power && typeof hs.power === "object" ? hs.power : null,
      pw = P && P.measured && P.today && P.today.box ? P.today.box.usd : null,
      net = hs.net && hs.net.today != null ? hs.net.today : null;
    const calls = hs.live.callsToday ?? 0;
    val = hsD(net != null ? net : hs.live.today);
    a = "Claude " + hsD(hs.live.today) + " avoided" + (pw != null ? " − power " + hsD(pw) : P ? " · power not measured yet" : " · power not counted") + " · " + calls + " local call" + (calls === 1 ? "" : "s") + " today";
    head = net != null ? hsD(net) + " saved today on the Halo (Claude " + hsD(hs.live.today) + " avoided − power " + hsD(pw) + ")" : hs.headline || hsD(hs.live.today) + " saved today on the Halo";
    tone = (net != null ? net : hs.live.today) > 0 ? "g" : "a";
    bars = (hs.bars || []).map((b: J) => ({ day: b.day, live: b.live || 0, shadow: b.shadow || 0 }));
    const F = h0.saveForecast;
    if (F && F.total) {
      const by = new Map<string, number>((F.days || []).map((x: J) => [x.day, x.halo && x.halo.usd]));
      bars = bars.map((b) => (by.has(b.day) ? { ...b, shadow: by.get(b.day) || 0 } : b));
    }
  }
  const mx = Math.max(1e-9, ...bars.map((b) => Math.max(b.live, b.shadow)));
  const line = sp && sp.vs ? sp.vs : !ok ? "no data yet" : sp ? val + " net of power today" : a.split(" · ")[0];
  return {
    id: "kHalo",
    label,
    value: sp ? sp.txt : val,
    valueTone: sp || /\$/.test(val) ? undefined : "n",
    tone,
    lines: [{ text: line }],
    title: head + (bars.length ? "\nbars, last 7 days (UTC): live solid, shadow hatched (would save if live, never added): " + bars.map((b) => b.day.slice(5) + " " + hsD(b.live) + " / " + hsD(b.shadow)).join(" · ") : ""),
    chart: { kind: "pairs", live: bars.map((b) => b.live), other: bars.map((b) => b.shadow), max: mx, yLabels: yMoney(mx), xLabels: bars.length > 1 ? [md(day(bars[0].day)), md(day(bars[bars.length - 1].day))] : [] },
    art: "halo",
    opens: legacy("halosave"),
  };
}

/** renderBalancerTile */
function balancerTile(bal: J, h0: J): KeyTile {
  const c = bal || { ok: false, txt: "no data yet", bars: [], why: "the cockpit has no balancer yet" };
  const bs: J[] = c.bars || [],
    mx = Math.max(1e-9, ...bs.map((b) => Math.max(0, b.usd || 0)));
  const sa = (h0 && h0.savedAll) || {},
    a = sa.balancerToday && sa.balancerToday.headline ? sa.balancerToday : sa.balancer;
  const label = a && a === sa.balancerToday ? "Balancer · saved vs off · today" : "Balancer · saved vs without it · all history";
  const good = a ? a.share > 0 : c.ok && c.share > 0;
  const lines: KeyTile["lines"] = [
    { text: a ? String(a.vs || "") : c.ok ? balD(c.savedUsd) + " saved of " + balD((c.savedUsd || 0) + (c.spendUsd || 0)) + " Claude spend" + (c.today ? " today" : " on " + String(c.day || "").slice(5)) : String(c.why || "") },
  ];
  if (c.ok) lines.push({ text: (c.today ? "today " : String(c.day || "").slice(5) + " ") + c.txt + " · " + c.units + " routed units · " + c.misses + " missed " + balD(c.missUsd) });
  return {
    id: "kBalancer",
    label,
    value: a ? String(a.headline) : String(c.txt || "no data yet"),
    valueTone: good ? undefined : "n",
    tone: good ? "g" : "a",
    lines,
    title: (a ? "Balancer: " + a.headline + ", " + a.vs + "\n" : "") + (c.ok ? "latest day: " + c.txt + " of Claude spend saved (" + c.why + ")\nbars, last 7 days (UTC): " + bs.map((b) => String(b.day).slice(5) + " " + balD(b.usd)).join(" · ") : String(c.why || "")),
    chart: { kind: "bars", values: bs.map((b) => Math.max(0, b.usd || 0)), max: mx, yLabels: yMoney(mx), xLabels: bs.length > 1 ? [md(day(bs[0].day)), md(day(bs[bs.length - 1].day))] : [] },
    art: "balancer",
    opens: legacy("balancer"),
  };
}

/** paintRg: the worktree-health and features-proven key cards */
function keyCardTiles(h0: J): KeyTile[] {
  const kc = (h0 && h0.keyCards) || {};
  return [
    ["kWt", "Worktrees · health", kc.wt, "Worktrees: health and cleanliness - live, pooled, idle and kept dirty against the cap of 20; open the scorecard"],
    ["kRg", "Features proven · target 100%", kc.rg, "Features proven: the share of all features proven red/green, target 100%; open the scorecard"],
  ].map(([id, label, f, title]) => ({
    id: id as KeyTile["id"],
    label: label as string,
    value: f ? String(f.headline) : "-",
    tone: (f && f.flag ? "a" : "n") as KTone,
    lines: [{ text: f ? String(f.detail || "") : "no data yet" }],
    title: title as string,
    chart: null,
    opens: card("score"),
  }));
}

/** renderKeyNumbers part 4: cost per commit */
function costTile(sc: J, h0: J): KeyTile {
  const cm = (h0.officeFacts || {}).commits || null,
    wC = wkOf(sc),
    cUsd = cm && cm.usd != null ? cm.usd : null,
    cT = cm && cm.targetUsd != null ? cm.targetUsd : null;
  const cmax = Math.max(1, (cUsd || 0) * 1.5, (cT || 0) * 1.5);
  const tc: KTone = cUsd == null || cT == null ? "n" : tone3(cUsd, (v) => v <= cT, (v) => v <= cT * 1.5);
  return {
    id: "kUsd",
    label: "Cost per commit",
    value: cUsd == null ? "n/a" : wC ? wkPct(wkUsd(wC, cUsd)) : usd(cUsd),
    valueTone: tc,
    tone: tc,
    lines: [
      {
        text: cm
          ? (wC && cUsd != null ? usd(cUsd) + " a commit · " : "") + cm.today + " commit" + (cm.today === 1 ? "" : "s") + " · " + (wC ? wkPct(wkUsd(wC, cm.usdToday)) + " of the week" : usd(cm.usdToday)) + " spent today"
          : "measuring",
      },
    ],
    title: "Cost per commit: lane spend since local midnight / commits on master since local midnight" + (cm && cm.today ? " = " + usd(cm.usdToday) + " / " + cm.today + " = " + usd(cUsd) : "") + (cT != null ? "\nKPI commit.usd target " + usd(cT) + " (dashed)" : ""),
    chart: { kind: "strip", max: cmax, goal: cT, mark: cUsd, band: null, ticks: [] },
    opens: card("score"),
  };
}

/** renderKeyNumbers part 6: time per commit */
function timeTile(h0: J): KeyTile {
  const cm = (h0.officeFacts || {}).commits || null,
    tks: number[] = (cm && cm.ticks) || [],
    mmax = Math.max(30, ((cm && cm.p90Min) || 0) * 1.15),
    mT = cm && cm.targetMin != null ? cm.targetMin : null;
  const tm: KTone = !cm || cm.p50Min == null || mT == null ? "n" : tone3(cm.p50Min, (v) => v <= mT, (v) => v <= mT * 1.5);
  const rc = cm && cm.recent && cm.recent.n >= 3 ? cm.recent : null,
    fm = (v: unknown) => (!isNum(v) ? "-" : v < 10 ? num(v, 1) : num(v, 0));
  return {
    id: "kMin",
    label: "Time per commit",
    value: rc ? fm(rc.p50Min) + " min" : cm && cm.p50Min != null ? num(cm.p50Min, 0) + " min" : "n/a",
    valueTone: tm,
    tone: tm,
    lines: [{ text: rc ? "last " + rc.hours + " h · " + rc.n + " landed · 24 h p50 " + fm(cm.p50Min) + ", p90 " + fm(cm.p90Min) : cm && cm.n ? "p90 " + num(cm.p90Min, 0) + " min · " + cm.n + " landed in 24 h" : "measuring" }],
    title: "Time per commit: from submitting to commit-ready to the commit on master, for the requests committed in the last 24 h" + (cm && cm.n ? " · p10 " + num(cm.p10Min, 0) + " · p50 " + num(cm.p50Min, 0) + " · p90 " + num(cm.p90Min, 0) + " min over " + cm.n : "") + (mT != null ? "\nKPI commit.timeP50 target " + num(mT, 0) + " min (dashed)" : ""),
    chart: { kind: "strip", max: mmax, goal: mT, mark: cm && cm.p50Min != null ? cm.p50Min : null, band: cm && cm.p10Min != null && cm.p90Min != null ? [cm.p10Min, cm.p90Min] : null, ticks: tks },
    wide: true,
    opens: card("score"),
  };
}

export function tilesOf(d: Record<string, J>): KeyTile[] {
  const sc = d.score || {},
    h0 = d.home || {};
  const each: (() => KeyTile)[] = [
    () => velTile(sc, h0, d.status),
    () => jevTile(d.jevsavings, h0),
    () => landedTile(sc, h0),
    () => haloTile(d.halosave, h0),
    () => balancerTile(d.balancer && d.balancer.data, h0),
    () => keyCardTiles(h0)[0],
    () => keyCardTiles(h0)[1],
    () => costTile(sc, h0),
    () => timeTile(h0),
  ];
  const ids: KeyTile["id"][] = ["kVel", "kJev", "kLanded", "kHalo", "kBalancer", "kWt", "kRg", "kUsd", "kMin"];
  return each.map((f, i) => {
    try {
      return f();
    } catch (e) {
      return { id: ids[i], label: ids[i], value: "-", tone: "d" as KTone, lines: [{ text: "no data yet" }], title: String(e instanceof Error ? e.message : e), chart: null, opens: card("score") };
    }
  });
}

/** The whole home from resource data keyed by name. Pure, so a test can feed it fixtures. */
export function buildHome(d: Record<string, J>, at = Date.now(), ok = true, error?: string): HomeView {
  const safe = <T>(f: () => T, fb: T): T => {
    try {
      return f();
    } catch {
      return fb;
    }
  };
  return {
    at,
    ok,
    error,
    header: safe(() => headerOf(d, at), { status: { text: "Reading…", tone: "d" as Tone }, at, account: null, push: null, master: null, phone: null, usage: null }),
    lane: safe(() => laneOf(d), { unlocked: null, production: null, client: null }),
    budget: safe(() => budgetOf(d), null),
    office: safe(() => officeOf(d), { head: "office loading…", tiles: null, note: "", aria: "Agent office", title: "" }),
    faces: safe(() => facesOf(d), []),
    mode: safe(() => modeOf(d), null),
    tiles: safe(() => tilesOf(d), []),
    foot: "Updates live from the cockpit client · view only on a remote device, except where the cockpit allows it",
  };
}

let lastGood: HomeView | null = null;
/** The home from the client; the last good copy is kept while the cockpit is away. */
export async function getHome(): Promise<HomeView> {
  try {
    const r = await getMany([...HOME_RESOURCES]);
    const anyData = Object.values(r.data).some((v) => v != null);
    if (!anyData && lastGood) return { ...lastGood, ok: false, error: r.errors[0] || "cockpit unreachable" };
    const h = buildHome(r.data, r.at, r.ok, r.ok ? undefined : "cockpit: " + r.errors[0]);
    if (anyData) lastGood = h;
    return h;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lastGood) return { ...lastGood, ok: false, error: "cockpit unreachable: " + msg };
    return buildHome({}, Date.now(), false, "cockpit unreachable: " + msg);
  }
}
