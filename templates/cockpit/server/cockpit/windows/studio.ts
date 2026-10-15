/**
 * FA-19157: an app's studio, rendered by agent-native from the cockpit client (it used to open the legacy page's studio at
 * #apps=<id> in a LegacyWindow). This file is the pure half: the legacy studio's face as data, ported from
 * tools/lane/maint/ui/studio-lifecycle.js (identity, tileData, needTile, deployStages, inboxCount) and studio-pilot.js
 * (tileChip, the Apps tile's autopilot / definition-of-done chip). The reads are the client's apps/<app>/env (start=0: a read
 * never starts staging), apps/<app>/lifecycle, apps/<app>/checklist and apps/<app>/studio, plus appdialog (the staging
 * picture) and questions (the inbox); apps.ts builds the window from them and AppsPart.tsx draws it.
 */
import type { Tone } from "../../../shared/cockpit.js";

type Any = Record<string, any> | null | undefined;
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The legacy ago(): just now, N min ago, N h ago, N d ago. */
export function ago(at: unknown, now = Date.now()): string {
  const t = Date.parse(String(at || ""));
  if (!t) return "";
  const s = Math.max(0, (now - t) / 1000);
  return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
}

/** The Apps tile's chip (studio-pilot.js tileChip): Building N of M (spinner) / Needs your decision / Green / Paused / Stopped / N of M verified. */
export interface PilotChip {
  text: string;
  tone: "run" | "a" | "g" | "r" | "";
  spin: boolean;
  open: boolean;
  title: string;
}
export function tileChip(ap: Any, p: Any): PilotChip | null {
  if (!p || !n0(p.total)) return null;
  const total = n0(p.total),
    ver = n0(p.verified),
    fail = n0(p.failing),
    st = (ap && ap.state) || "off",
    of = ver + " of " + total;
  const dec = ((ap && ap.decisionsOpen) || []).filter((d: any) => !d.answered);
  const title = [ap && ap.text, dec.length ? "Waiting on: " + (dec[0].text || dec[0].question || "a decision") : null, p.text || of + " requirements verified", p.detail].filter(Boolean).join(" · ");
  const C = (text: string, tone: PilotChip["tone"], o: Partial<PilotChip> = {}): PilotChip => ({ text, tone, spin: false, open: false, title, ...o });
  if (st === "running") return C("Building " + of, "run", { spin: true });
  if (st === "waiting") return C("Needs your decision", "a", { open: true });
  if (st === "green") return C("Green", "g");
  if (st === "paused") return C("Paused · " + of + " verified", "");
  if (st === "stopped") return C("Stopped · " + of + " verified", "");
  return C(of + " verified", fail ? "r" : ver >= total ? "g" : "");
}

/** The deploy job's five stages (studio-lifecycle.js deployStages). */
export function deployStages(pm: Any, monitorArmed = false) {
  const S: [string, string][] = [
    ["build", "Build"],
    ["checks", "Checks"],
    ["sign", "Phone signature"],
    ["deploy", "Deploy"],
    ["monitor", "Monitoring"],
  ];
  if (!pm) return { state: "idle", stages: S.map(([k, l]) => ({ k, l, st: "todo" })), failedAt: null as string | null, text: "Idle" };
  const ph = pm.phase || "";
  const at = ph === "filing" || ph === "cards" || ph === "cards-partial" ? 0 : ph === "candidate" ? 1 : ph === "awaiting-signature" ? 2 : ph === "published" ? 4 : ph === "checks-failed" ? 1 : ph === "failed" ? (pm.publish && pm.publish.sha ? 3 : 0) : ph === "cancelled" ? -1 : 0;
  const bad = pm.state === "failed",
    stopped = pm.state === "stopped";
  const stages = S.map(([k, l], i) => ({ k, l, st: stopped ? "todo" : i < at ? "done" : i === at ? (bad ? "bad" : ph === "published" ? (monitorArmed ? "done" : "now") : "now") : "todo" }));
  const cur = stages.find((s) => s.st === "now" || s.st === "bad");
  const text = stopped
    ? "Stopped"
    : bad
      ? "Failed at " + (cur ? cur.l : "a stage")
      : ph === "published"
        ? "Deployed"
        : ph === "awaiting-signature"
          ? "Waiting for your signature"
          : cur
            ? cur.l + "…"
            : "Running";
  return { state: stopped ? "stopped" : bad ? "failed" : ph === "published" ? "live" : "running", stages, failedAt: bad && cur ? cur.l : null, text };
}

/** Which tile needs the console now, one at most (studio-lifecycle.js needTile). */
export function needTile(lc: Any, env: Any): string | null {
  const pm = env && env.promotion;
  if (pm && pm.phase === "awaiting-signature") return "deploy";
  if (pm && pm.state === "failed") return "deploy";
  if (lc && lc.live && lc.live.alerts) return "live";
  if (lc && lc.build && ((lc.build.progress && lc.build.progress.failing) || (lc.build.autopilot && lc.build.autopilot.state === "waiting"))) return "build";
  if (lc && lc.quality && lc.quality.qa && lc.quality.qa.green === false) return "quality";
  return null;
}

export interface LifeTile {
  k: string;
  label: string;
  v: string;
  s: string;
  tone: string;
  busy: boolean;
  need: boolean;
}
/** The lifecycle bar (studio-lifecycle.js tileData): BUILD, QUALITY, LAUNCH READY, DEPLOY, LIVE. */
export function lifeTiles(lc: Any, e: Any, now = Date.now()): LifeTile[] {
  const pm = e && e.promotion,
    d = deployStages(pm, false);
  const b = lc ? lc.build : null,
    q = lc ? lc.quality : null,
    l = lc ? lc.launch : null,
    lv = lc ? lc.live : null;
  const ap = b && b.autopilot && b.autopilot.state && b.autopilot.state !== "off" ? "Autopilot " + b.autopilot.state : null;
  const rdy = e && e.ready && e.ready.eta && e.ready.eta.minLow != null ? "~" + e.ready.eta.minLow + "–" + e.ready.eta.minHigh + " min" : null;
  const need = needTile(lc, e);
  const T: Omit<LifeTile, "need">[] = [
    { k: "build", label: "Build", v: b ? (b.progress && b.progress.total ? b.progress.verified + " of " + b.progress.total + " verified" : "No requirements yet") : "…", s: ap || (b && b.progress && b.progress.detail) || "", tone: b ? b.tone || "" : "", busy: !!(b && b.autopilot && b.autopilot.state === "running") },
    { k: "quality", label: "Quality", v: q ? q.text : "…", s: q && q.measure ? "Measured " + ago(q.measure.at, now) : q && q.qa && q.qa.at ? "Last run " + ago(q.qa.at, now) : "", tone: q ? q.tone || "" : "", busy: false },
    { k: "launch", label: "Launch ready", v: l ? l.pct + "%" : "…", s: l ? (l.red ? l.red + " item" + (l.red === 1 ? "" : "s") + " left" : "Every item green") : "", tone: l ? l.tone || "" : "", busy: false },
    { k: "deploy", label: "Deploy", v: d.text, s: d.state === "running" && rdy ? rdy : e && e.production && e.production.at ? "Last " + ago(e.production.at, now) : "", tone: d.state === "failed" ? "r" : d.state === "running" ? "s" : d.state === "live" ? "g" : "", busy: d.state === "running" },
    { k: "live", label: "Live", v: lv ? lv.text : "…", s: lv && lv.alerts ? lv.alerts + " alert" + (lv.alerts === 1 ? "" : "s") : lv && lv.production === "none" ? "Until production data flows" : "", tone: lv ? lv.tone || "" : "", busy: false },
  ];
  return T.map((t) => ({ ...t, need: need === t.k }));
}

/** The identity line under the app name (studio-lifecycle.js identity): staging sha + age, production sha + age (a link). */
export interface Identity {
  staging: { short: string; ago: string } | null;
  stagingText: string;
  production: { short: string; url: string | null; ago: string } | null;
  productionText: string;
  /** the line's text as the legacy page reads it (its screen-reader words included) */
  text: string;
}
export function identityOf(e: Any, now = Date.now()): Identity {
  const st = e && e.staging,
    pr = e && e.production;
  const staging = st && st.sha ? { short: String(st.short || String(st.sha).slice(0, 7)), ago: st.built ? ago(st.built, now) : "" } : null;
  const production = pr && pr.sha ? { short: String(pr.short || String(pr.sha).slice(0, 7)), url: typeof pr.url === "string" && /^https?:\/\//.test(pr.url) ? pr.url : null, ago: pr.at ? ago(pr.at, now) : "" } : null;
  const stagingText = staging ? "Staging " + staging.short + (staging.ago ? " · " + staging.ago : "") : e ? "No staging build yet" : "Staging…";
  const productionText = production ? "Production " + production.short + (production.url ? " (opens the production site)" : "") + (production.ago ? " · " + production.ago : "") : "Not in production yet";
  return { staging, stagingText, production, productionText, text: stagingText + " " + productionText };
}

/** The inbox badge (studio-lifecycle.js inboxCount): what needs the console, and the proposals waiting. */
export function inboxOf(lc: Any, e: Any, questions: Any, app: string) {
  const sig = e && e.promotion && e.promotion.phase === "awaiting-signature" ? 1 : 0;
  const mine = ((questions && questions.items) || []).filter((q: any) => q && q.app === app);
  const qs = mine.length;
  const need = (lc && lc.inbox ? n0(lc.inbox.needsYou) : 0) + sig + qs;
  const proposals = lc && lc.inbox ? n0(lc.inbox.proposals) : 0;
  // FA-19175: the inbox drawer's Questions for you (studio-lifecycle.js inboxTop): this app's console questions, and how many more wait across the work
  const list = mine.slice(0, 40).map((q: any) => ({ id: String(q.id || ""), question: String(q.question || ""), priority: String(q.priority || "normal") }));
  const more = Math.max(0, n0(questions && questions.n) - qs);
  return { need, proposals, text: need ? need + (need === 1 ? " needs you" : " need you") : "Inbox", qs: list, more };
}

/** One requirement of the definition of done, as the Build detail lists it. */
export interface Requirement {
  id: string;
  text: string;
  status: string;
  tone: Tone | "";
  why: string;
}
const REQ_TONE: Record<string, Tone | ""> = { verified: "g", failing: "r", blocked: "a", pending: "", unwritten: "", context: "d" };
export function requirementsOf(cl: Any): { text: string; detail: string; note: string; items: Requirement[] } {
  const p = (cl && cl.progress) || {};
  const items: Requirement[] = ((cl && cl.items) || []).slice(0, 200).map((x: any) => {
    const status = String(x.status || (x.verified ? "verified" : "pending"));
    return { id: String(x.id || ""), text: String(x.text || ""), status, tone: REQ_TONE[status] ?? "", why: String(x.why || "") };
  });
  return { text: String(p.text || (n0(p.total) ? n0(p.verified) + " of " + n0(p.total) + " requirements verified" : "No requirements yet")), detail: String(p.detail || ""), note: String(p.note || ""), items };
}

/** The staging line and the picture, from appdialog (the same words the Apps tile uses). */
export interface StudioStaging {
  running: boolean;
  exists: boolean;
  url: string | null;
  subject: string;
  ahead: number;
  building: boolean;
  error: string | null;
}
export function stagingOf(e: Any): StudioStaging {
  const st = (e && e.staging) || {};
  return {
    running: !!st.running,
    exists: !!(st.exists || st.sha),
    url: typeof st.url === "string" && /^https?:\/\//.test(st.url) ? st.url : null,
    subject: String(st.subject || ""),
    ahead: Array.isArray(st.ahead) ? st.ahead.length : 0,
    building: !!st.building,
    error: st.error ? String(st.error).slice(0, 300) : null,
  };
}

/** The studio's recent staging changes and activity (the studio view's staging.changes and rec.activity), newest first. */
export function changesOf(sv: Any): { id: string; what: string; state: string; at: string; tone: Tone | "" }[] {
  const ch = (sv && sv.staging && Array.isArray(sv.staging.changes) ? sv.staging.changes : []) as any[];
  return ch.slice(0, 12).map((c) => {
    const raw = String(c.state || c.status || "");
    return {
      id: String(c.id || ""),
      what: String(c.title || c.text || c.what || c.ask || "").slice(0, 300),
      state: String(c.label || raw),
      at: String(c.endedAt || c.at || c.startedAt || ""),
      tone: c.undone ? "d" : /fail|error|refus/.test(raw) ? "r" : /live|done|ok|built|applied/.test(raw) ? "g" : /queue|build|run/.test(raw) ? "a" : "",
    };
  });
}
export function activityOf(sv: Any): { at: string; text: string }[] {
  const a = (sv && sv.rec && Array.isArray(sv.rec.activity) ? sv.rec.activity : []) as any[];
  return a
    .slice(-15)
    .reverse()
    .map((x) => ({ at: String(x.at || ""), text: String(x.text || x.what || x.msg || "").slice(0, 400) }));
}
