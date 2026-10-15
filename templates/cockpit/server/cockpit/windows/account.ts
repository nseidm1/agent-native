/**
 * FA-19125: Claude account, ported from the legacy acctDlg (tools/lane/maint/ui/page/account.js: paintChip and paint). Who the
 * Mac's claude command is signed in as, the Halo's login beside it, the plan usage windows (5 hours and the week, with their
 * reset times), whether the lane is held for the account (or resumed after one) and what a swap changes. The sign-in / swap /
 * Halo login FLOW is interactive and lives in the window's part (app/components/cockpit/windows/AccountPart.tsx), which reads
 * the flow from `part` and drives it with account.start / account.code / account.step.
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailItem, DetailSection, DetailStat } from "../../../shared/cockpit-detail.js";
import { DETAIL_MAX_CHARS } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

export type FlowLink = { url?: string; reauthUrl?: string; autoUrl?: string; autoReauthUrl?: string; mode?: string; why?: string };
export type FlowStep = { id: string; label: string; state: string; reason?: string };
export type Flow = {
  steps: FlowStep[];
  done?: boolean;
  kind?: string;
  result?: string;
  emailHint?: string | boolean;
  haloFor?: string;
  checkpointedAt?: number | null;
  signin?: FlowLink | null;
  halo?: FlowLink | null;
};
type Halo = { short?: string; text?: string; match?: boolean | null };
export type Account = {
  status?: { loggedIn?: boolean; email?: string; plan?: string } | null;
  budget?: { state?: string; outUntil?: number; windows?: Record<string, { util?: number; resetsAt?: number }> } | null;
  fresh?: { at?: number; stale?: boolean; pct?: number } | null;
  chip?: { tone?: string; label?: string; head?: string | null; words?: string; sub?: string; plan?: string; action?: string; halo?: Halo | null } | null;
  flow?: Flow | null;
  hold?: { kind?: string; why?: string; until?: number } | null;
  lifted?: { at?: number; resumed?: number; email?: string; why?: string } | null;
  interrupted?: unknown[];
};

/** What AccountPart reads: the flow and the few facts its buttons depend on (legacy paint's inputs). */
export type AccountPartData = {
  flow: Flow | null;
  loggedIn: boolean | null;
  email: string;
  haloMatch: boolean | null;
  holdKind: string | null;
};

const clip = (s: string) => (s.length > DETAIL_MAX_CHARS ? s.slice(0, DETAIL_MAX_CHARS - 1) + "…" : s);
const ms = (t: number | undefined) => (typeof t === "number" && t > 0 ? (t < 1e12 ? t * 1000 : t) : 0);
/** legacy hm(): the time today, or the weekday and time */
export function hm(t: number, now = Date.now()): string {
  const d = new Date(t);
  const s = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === new Date(now).toDateString() ? s : d.toLocaleDateString([], { weekday: "short" }) + " " + s;
}
/** legacy compact(): the busiest window, "33% wk" or "out until 22:00" */
export function compact(b: Account["budget"], now = Date.now()): string {
  if (!b || b.state === "unknown") return "";
  if (b.state === "out") return "out" + (b.outUntil ? " until " + hm(ms(b.outUntil), now) : "");
  const ws = Object.entries(b.windows || {}).sort((x, y) => (y[1].util || 0) - (x[1].util || 0));
  if (!ws.length) return "";
  return Math.round((ws[0][1].util || 0) * 100) + "% " + (ws[0][0] === "seven_day" ? "wk" : "5h");
}
const asOf = (f: Account["fresh"], now: number) => (f && f.at ? " as of " + hm(f.at, now) : "");
const TONE: Record<string, Tone> = { ok: "g", warn: "a", bad: "r", failed: "r", busy: "a", off: "a", unknown: "d" };
const WINDOW_LABEL: Record<string, string> = { five_hour: "5 hours", seven_day: "This week" };

/** The legacy dialog's "What this changes" paragraph, in three bounded lines. */
export const WHAT_IT_CHANGES = [
  "What this changes: the Claude login of the claude command on this Mac. Every agent run and work session the lane starts runs on it.",
  "Then the Halo signs in to the same account with its own login (a second Continue with Google, which comes back to the Halo through this Mac; nothing is copied between the machines); until it matches, the Halo's drafting runs on the Mac.",
  "What it does not change: the Claude app's own sign-in (master's chat session).",
];

/** legacy paint(): the who line */
export function whoLine(st: Account["status"]): string {
  if (st && st.loggedIn) return "Mac: signed in as " + (st.email || "unknown") + (st.plan ? " (" + st.plan[0].toUpperCase() + st.plan.slice(1) + ")" : "");
  return st && st.loggedIn === false ? "No Claude account is signed in on this Mac." : "Could not read the claude login on this Mac yet.";
}

/** legacy paint(): the held / resumed line (null: neither) */
export function holdLine(v: Account, now = Date.now()): { text: string; tone: Tone } | null {
  const lifted = !v.hold && v.lifted && now - (v.lifted.at || 0) < 30 * 60e3 ? v.lifted : null;
  const waits = (v.interrupted || []).length;
  if (v.hold) {
    const h = v.hold;
    const tail =
      h.kind === "out"
        ? "It resumes by itself when the budget resets" + (h.until ? " (" + hm(ms(h.until), now) + ")" : "") + ", or as soon as you sign in with another account (the cockpit checks it with one test request first)."
        : h.kind === "signed-out"
          ? "It resumes after a sign-in."
          : "It resumes when the swap finishes.";
    return { text: "The lane is paused (" + (h.why || h.kind) + "): no new work starts" + (waits ? "; " + waits + " interrupted job(s) wait to resume where they stopped" : "") + ". " + tail, tone: "r" };
  }
  if (lifted) return { text: "Resumed at " + hm(lifted.at || 0, now) + ": " + (lifted.resumed || 0) + " paused job(s) picked up where they stopped" + (lifted.email ? " on " + lifted.email : "") + " (" + lifted.why + ").", tone: "g" };
  return null;
}

/** The pure half: the account resource -> the window (exported for its spec). */
export function accountWindow(v: Account | null, at: number, ok: boolean, error?: string, now = Date.now()): WindowDetail {
  const c = (v && v.chip) || {};
  const tone: Tone = v ? TONE[c.tone || "unknown"] || "d" : "d";
  const halo = c.halo || null;
  const b = v && v.budget;
  const words = v ? ((c.words || "") + asOf(v.fresh, now)).trim() : "";
  const stale = !!(v && v.fresh && v.fresh.stale);
  const stats: DetailStat[] = [];
  for (const [k, w] of Object.entries((b && b.windows) || {}).sort((x, y) => (x[0] === "five_hour" ? -1 : y[0] === "five_hour" ? 1 : 0))) {
    const u = Math.round((w.util || 0) * 100);
    stats.push({ label: WINDOW_LABEL[k] || k.replace(/_/g, " "), value: u + "%", sub: w.resetsAt ? "resets " + hm(ms(w.resetsAt), now) : "", tone: u >= 90 ? "r" : u >= 70 ? "a" : "g" });
  }
  if (b && b.state === "out") stats.push({ label: "Budget", value: "out", sub: b.outUntil ? "until " + hm(ms(b.outUntil), now) : "", tone: "r" });
  const usageTone: Tone = b && b.state === "out" ? "r" : (b && b.state === "near") || stale ? "a" : "d";
  const sections: DetailSection[] = [];
  if (stats.length) sections.push({ title: "Plan usage", sub: v && v.fresh && v.fresh.at ? "as of " + hm(v.fresh.at, now) + (stale ? " · stale" : "") : "", kind: "stats", stats });
  // legacy acctBud: the budget words, amber when near or stale, red when out
  sections.push({ title: "Budget", kind: "list", items: [{ text: clip(words || "No plan usage reading yet."), tone: usageTone === "d" ? undefined : usageTone }] });
  const held = v ? holdLine(v, now) : null;
  if (held) sections.push({ title: v && v.hold ? "Lane paused" : "Lane resumed", kind: "list", items: [{ text: clip(held.text), tone: held.tone } as DetailItem] });
  sections.push({ title: "What this changes", kind: "list", items: WHAT_IT_CHANGES.map((text) => ({ text })) });
  const chips: { t: string; tone?: Tone }[] = [];
  const cb = v ? compact(b, now) : "";
  if (cb) chips.push({ t: cb + asOf(v && v.fresh, now), tone: usageTone === "d" ? undefined : usageTone });
  if (halo && halo.short && c.tone !== "busy") chips.push({ t: halo.short, tone: halo.match === true ? "g" : halo.match === false ? "a" : undefined });
  const part: AccountPartData = {
    flow: v && v.flow && Array.isArray(v.flow.steps) ? v.flow : null,
    loggedIn: v && v.status ? (v.status.loggedIn ?? null) : null,
    email: (v && v.status && v.status.email) || "",
    haloMatch: halo ? (halo.match ?? null) : null,
    holdKind: (v && v.hold && v.hold.kind) || null,
  };
  return {
    id: "account",
    title: "Claude account",
    tone,
    headline: v ? whoLine(v.status) : "Reading the Claude login…",
    sub: halo && halo.text ? clip(halo.text) : "",
    chips,
    at,
    ok,
    error,
    sections,
    part,
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<Account>("account", { fresh: true });
    return accountWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return accountWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
