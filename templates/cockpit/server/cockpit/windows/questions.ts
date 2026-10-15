/**
 * FA-19134: Questions for you, ported from the legacy qDlg (tools/lane/maint/ui/index.html, the QUESTIONS FOR YOU script:
 * renderSum, card, panelFor, doneView). The summary line, every open question with its options (the recommended one marked),
 * a free-text answer, Not now and Drop this; and the answered list (the newest 30 the client carries) with what was said, how
 * far it got, Undo while its window is open, Bring it back for a snoozed one and Overrule for a system answer. Every write is
 * the cockpit's questions.<verb> through cockpit-question.
 */
import type { DetailAction, DetailItem, DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import type { Tone } from "../../../shared/cockpit.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type Opt = { id?: string; label?: string; consequence?: string; recommended?: boolean; reason?: string };
type Answer = { kind?: string; text?: string; option?: number; reason?: string | null; at?: string; overrule?: boolean; system?: { rule?: string; why?: string } | null };
export type Question = {
  id: string;
  question?: string;
  headline?: string | null;
  why?: string | null;
  options?: Opt[];
  area?: string | null;
  priority?: string | null;
  source?: string | null;
  app?: string | null;
  card?: string | null;
  feature?: string | null;
  after?: string | null;
  freeText?: boolean;
  missing?: string | null;
  summary?: { feature?: string; wrong?: string; choices?: string; risk?: string } | null;
  evidence?: { report?: string; ask?: string; history?: { at?: string; state?: string; why?: string }[] } | null;
  shape?: { by?: string; why?: string } | null;
  askedBy?: string | null;
  askedAt?: string | null;
  state?: string;
  answer?: Answer | null;
  undoUntil?: string | null;
  snoozedUntil?: string | null;
  delivery?: { to?: string; at?: string } | null;
  actedAt?: string | null;
  closed?: { why?: string } | null;
  confirm?: string | null;
};
export type QuestionsData = { n?: number; blocking?: number; minutes?: number; items?: Question[]; recent?: Question[]; recentTotal?: number };
/** features.questions: the Lane button's counts, and the two the questions resource leaves out (pending, held). */
export type QuestionCounts = { published?: boolean; n?: number; blocking?: number; money?: number; minutes?: number; pending?: number; held?: number; tone?: string; label?: string | null };

const PRI_LABEL: Record<string, string> = { blocking: "Blocks a launch", money: "Money" };
const SOURCE: Record<string, string> = { feature: "A feature waiting on you", escalated: "Stuck after two tries", orphan: "Unfinished work", studio: "A studio decision", approval: "Needs your approval" };
const SNOOZE = [{ m: 60, l: "In 1 hour" }, { m: 240, l: "In 4 hours" }, { m: 1440, l: "Tomorrow" }];
const STEP: Record<string, [string, Tone]> = { answered: ["Answered", "a"], delivered: ["Delivered to the owner", "d"], acted: ["Acted on", "g"] };

const mins = (n: number) => Math.max(1, Math.round((n * 40) / 60));
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
/** The legacy ago(): just now, N min ago, N h ago, N days ago. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  const s = (now - Date.parse(iso || "")) / 1000;
  if (!isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 129600) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " days ago";
}
const clock = (iso: string | null | undefined) => {
  const d = new Date(iso || "");
  return isNaN(+d) ? "" : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** The legacy renderSum line. */
export function summaryLine(items: Question[], pend: number, held: number): string {
  const n = items.length,
    b = items.filter((x) => x.priority === "blocking").length,
    m = items.filter((x) => x.priority === "money").length;
  const on = (w: string) => (pend ? " · " + pend + " answer" + (pend === 1 ? "" : "s") + w : "");
  const s = n
    ? n + " open" + (b ? " · " + b + " blocking a launch" : "") + (m ? " · " + m + " about money" : "") + " · about " + mins(n) + " min" + on(" on the way")
    : "Nothing is waiting on you" + on(" on the way to the owners");
  return held ? s + " · " + held + " more being put into plain words" : s;
}

const act = (label: string, args: Record<string, unknown>, extra: Partial<DetailAction> = {}): DetailAction => ({ kind: "question", label, args, ...extra });

function openSections(q: Question, i: number, n: number, now: number): DetailSection[] {
  const opts = q.options || [];
  const items: DetailItem[] = [];
  if (q.headline) items.push({ text: q.headline });
  items.push({ strong: "Question", text: q.question || "" });
  if (q.why) items.push({ strong: "Why it matters now", text: q.why });
  if (q.shape && q.shape.by === "console" && q.shape.why)
    items.push({ strong: "Why this is yours", text: q.shape.why.replace(/^This is yours because /, "").replace(/^./, (c) => c.toUpperCase()) });
  if (q.missing) items.push({ text: "Hard to answer well yet: " + q.missing, tone: "a" });
  opts.forEach((o, k) => {
    const label = o.label || "Option " + (k + 1);
    items.push({
      strong: label + (o.recommended ? " (recommended)" : ""),
      text: [o.consequence || "", o.recommended && o.reason ? "Why we recommend it: " + o.reason : ""].filter(Boolean).join(" · "),
      tone: o.recommended ? "g" : undefined,
      actions: [act("Answer", { verb: "answer", id: q.id, option: k }, { confirm: "Answer “" + label + "”?" })],
    });
  });
  items.push({
    strong: opts.length ? "Something else" : "Your answer",
    text: opts.length ? "type your own answer instead of a choice" : "type your answer",
    actions: [act("Answer", { verb: "answer", id: q.id }, { input: { name: "text", label: opts.length ? "Type your own answer" : "Type your answer", required: true }, confirm: "Send this answer?" })],
  });
  if (q.after) items.push({ strong: "After you answer", text: q.after });
  items.push({ strong: "Not now", text: "Bring it back later. It returns to this list by itself.", actions: SNOOZE.map((s) => act(s.l, { verb: "snooze", id: q.id, minutes: s.m })) });
  items.push({
    strong: "Drop this",
    text: "Dropping abandons the work behind this question. It cannot be picked up again from here.",
    tone: "r",
    actions: [act("Drop this work", { verb: "drop", id: q.id }, { input: { name: "reason", label: "Why drop it? The owner gets your reason.", required: true }, confirm: "Drop this work? It cannot be picked up again from here.", danger: true })],
  });
  const sub = [PRI_LABEL[q.priority || ""], q.area || "Other", "Asked by " + (q.askedBy || "an agent") + " · " + ago(q.askedAt, now)].filter(Boolean).join(" · ");
  const out: DetailSection[] = [{ title: "Question " + (i + 1) + " of " + n, sub, kind: "list", items }];
  // Tell me more: the product-words summary first, then who asked, then the technical note
  const sm = q.summary || null,
    ev = q.evidence || null,
    more: DetailItem[] = [];
  if (sm)
    for (const [h, k] of [["What this is", "feature"], ["What is wrong", "wrong"], ["What each choice changes", "choices"], ["The risk", "risk"]] as const)
      if (sm[k]) more.push({ strong: h, text: sm[k]! });
  more.push({ strong: "Who asked", text: (q.askedBy || "An agent") + " · " + ago(q.askedAt, now) + (SOURCE[q.source || ""] ? " · " + SOURCE[q.source || ""] : "") });
  if (ev && ev.report) more.push({ strong: "In their words", text: ev.report });
  if (ev && ev.ask && ev.ask !== ev.report) more.push({ strong: "The original request", text: ev.ask });
  for (const h of ((ev && ev.history) || []).slice(-8)) more.push({ strong: "History", text: clock(h.at) + " · " + (h.state || "") + (h.why ? ": " + h.why : "") });
  const ids = [q.feature && "Feature " + q.feature, q.card && "Card " + q.card, q.app && "App " + q.app].filter(Boolean).join(" · ");
  if (ids) more.push({ text: ids });
  out.push({ title: "Tell me more", sub: "question " + (i + 1), kind: "list", items: more, collapsed: true });
  return out;
}

/** What the answered row says was said (the legacy doneView's fq-said line). */
export function saidOf(x: Question, now = Date.now()): string {
  const a = x.answer;
  if (x.state === "snoozed") return "Not now · comes back " + clock(x.snoozedUntil);
  if (x.state === "closed" && !a) return "Resolved elsewhere" + (x.closed && x.closed.why ? " · " + x.closed.why : "");
  if (a && a.system) return "By the system · Answered: “" + (a.text || "") + "” · " + ago(a.at, now);
  if (a)
    return (a.kind === "drop" ? "You dropped it: " : a.overrule ? "Your answer (overrules the system): " : "Your answer: ") + "“" + (a.kind === "drop" ? a.reason || a.text || "" : a.text || "") + "” · " + ago(a.at, now);
  return "";
}

function answeredRow(x: Question, now: number): DetailRow {
  const a = x.answer || null;
  const step = a ? STEP[x.state || ""] : null;
  const note = [
    (x.area || "Other") + (x.askedBy ? " · asked by " + x.askedBy : ""),
    x.confirm && a ? "What happens: " + x.confirm : "",
    x.delivery && x.delivery.to ? "Sent to " + x.delivery.to + (x.delivery.at ? " · " + ago(x.delivery.at, now) : "") + (x.actedAt ? " · acted on " + ago(x.actedAt, now) : "") : "",
    a && a.system ? "Why the system could answer: " + (a.system.why || a.system.rule || "") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const actions: DetailAction[] = [];
  if (x.state === "snoozed") actions.push(act("Bring it back now", { verb: "unsnooze", id: x.id }));
  if (a && x.state === "answered" && x.undoUntil && Date.parse(x.undoUntil) > now) actions.push(act("Undo this answer", { verb: "undo", id: x.id }, { confirm: "Undo this answer? The question comes back to you." }));
  if (a && a.system) {
    const others = (x.options || []).map((o) => o.label || "").filter((l, i) => l && i !== a.option);
    if (others.length)
      actions.push(act("Overrule", { verb: "overrule", id: x.id }, { input: { name: "option", label: "Your answer instead", options: others, required: true }, confirm: "Overrule the system's answer with yours? It is re-delivered to the owner." }));
  }
  return {
    cells: [x.question || "", saidOf(x, now), step ? { t: step[0], tone: step[1] } : x.state === "snoozed" ? "Snoozed" : x.state === "closed" ? "Closed" : ""],
    note,
    actions: actions.length ? actions : undefined,
  };
}

/** The pure half: the questions resource (+ features.questions' counts, the open issue count) -> the window. */
export function questionsWindow(v: QuestionsData | null, c: QuestionCounts | null, issuesOpen: number | null, at: number, ok: boolean, error?: string, now = Date.now()): WindowDetail {
  const items = (v && v.items) || [],
    recent = (v && v.recent) || [];
  const pend = c && typeof c.pending === "number" ? c.pending : recent.filter((x) => x.state === "answered" || x.state === "delivered").length;
  const held = (c && c.held) || 0;
  const n = items.length,
    blocking = items.filter((x) => x.priority === "blocking").length;
  const total = v && typeof v.recentTotal === "number" ? v.recentTotal : recent.length;
  const sections: DetailSection[] = [];
  if (!v) sections.push({ title: "Loading the questions…", kind: "text", text: "" });
  else if (!n)
    sections.push({
      title: "You are all caught up",
      kind: "text",
      text: "Nothing is waiting on you right now." + (pend ? " " + pend + " of your answers " + (pend === 1 ? "is" : "are") + " on the way to the owners: see Answered." : ""),
    });
  else items.forEach((q, i) => sections.push(...openSections(q, i, n, now)));
  sections.push({
    title: "Answered",
    sub: total > recent.length ? "the newest " + recent.length + " of " + total : total ? String(total) : "",
    kind: "table",
    columns: ["Question", "Answer", "Progress"],
    rows: recent.map((x) => answeredRow(x, now)),
    empty: "Nothing answered in the last 7 days.",
  });
  sections.push({
    title: "Not shown here yet",
    kind: "text",
    collapsed: true,
    text:
      "The line saying how the system answers questions that fit its shape (questions shape: mode, calibration, overrules in 24 h) is not on the cockpit client yet" +
      (total > recent.length ? ", and the answered list here is the newest " + recent.length + " of " + total : "") +
      ". Links in Tell me more open from the legacy page.",
  });
  return {
    id: "questions",
    title: "Questions for you",
    tone: blocking ? "r" : n ? "a" : "g",
    headline: !v ? "Loading…" : summaryLine(items, pend, held),
    sub: n ? "Answer one by one below: pick a choice or type your own; Not now brings it back later." : "",
    chips: [
      ...(n ? [{ t: pl(n, "question") + " open", tone: (blocking ? "r" : "a") as Tone }] : []),
      ...(issuesOpen ? [{ t: pl(issuesOpen, "issue") + " open", tone: "a" as Tone }] : []),
    ],
    at,
    ok,
    error,
    part: { issuesOpen: issuesOpen ?? 0 },
    sections,
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await getMany(["questions", "features", "issues"]);
    const f = r.data.features,
      iss = r.data.issues;
    const issuesOpen = iss && typeof iss.open === "number" ? iss.open : null;
    return questionsWindow(r.data.questions, (f && f.questions) || null, issuesOpen, r.at, r.ok, r.ok ? undefined : r.errors.join("; "));
  } catch (e) {
    return questionsWindow(null, null, null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
