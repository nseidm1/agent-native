/**
 * FA-19130: the Overview window, ported from the legacy page's Overview section (tools/lane/maint/ui/index.html:
 * renderOverview, renderIdle, paintRg's Hot line, the section's header chips from headers().overview, and the
 * "How each kind of card is worked" boxes). Read from the client resources status, jobs and home. The Production
 * box's strictness stepper and rule switches are the window's Part (OverviewPart.tsx), fed by `strict`, the gate map.
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailItem, DetailSection, DetailStat } from "../../../shared/cockpit-detail.js";
import type { StrictMap } from "../../../shared/cockpit-strict.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type J = any;
/** The Overview's document: a WindowDetail plus the gate map its Part reads. */
export type OverviewDetail = WindowDetail & { strict: StrictMap | null };

// ---------- the legacy helpers (core.js dur, index.html hm / mName / haloHead, plain-language.js MODE) ----------
export function dur(ms: unknown): string {
  if (ms == null || !Number.isFinite(Number(ms))) return "";
  const s = Math.floor(Math.max(0, Number(ms)) / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m" + String(s % 60).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h" + String(m % 60).padStart(2, "0") + "m";
  return Math.floor(h / 24) + "d" + (h % 24) + "h";
}
const hm = (t: unknown) => (t ? new Date(t as string | number).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
export function mName(id: unknown): string {
  if (!id) return "—";
  const s = String(id);
  const m = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(s);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1) + " " + m[2] + "." + m[3];
  const q = /qwen(\d(?:\.\d)?)-(\d+(?:\.\d+)?b)/i.exec(s);
  if (q) return "Qwen" + q[1] + " " + q[2].toUpperCase();
  if (/qwen3-coder-30b/i.test(s)) return "Qwen3-Coder 30B-A3B";
  if (/bonsai/i.test(s)) return "Bonsai-2 27B (ternary)";
  const f = /^(.+?)-(?:UD-)?(?:I?Q\d\w*|BF16|F16|F32)(?:-\d+-of-\d+)?(?:\.gguf)?$/i.exec(s);
  if (f) return f[1];
  return s;
}
function haloHead(H: J): { t: string; c: Tone } {
  const f = ((H && H.failed) || []).length,
    up = (H && H.up) || 0,
    tot = (H && H.total) || 0;
  return { t: up + " running of " + tot + " enabled" + (f ? ", " + f + " failed" : ""), c: tot && up === tot ? "g" : up ? "a" : "r" };
}
const MODE: Record<string, string> = { direct: "single pass", fragment: "step by step" };
/** The legacy pill colours: g / a / r keep their tone; t2 (secondary text), d and s read plain here. */
const tn = (c: string): Tone | undefined => (c === "g" || c === "a" || c === "r" ? c : undefined);

// ---------- the static rule text (the legacy markup, word for word) ----------
const HOT: string[] = [
  "Worked as soon as it is asked, many agents in parallel.",
  "The owning agent edits directly and lands through commit-ready.",
  "A run cut off mid-step is resumed automatically until it lands, or goes to another agent after two tries.",
  "Proven red/green: an acceptance test written from your request fails before the change and passes after it, checked at commit.",
];
const SYS: string[] = [
  "Every 30 minutes the land-card script reads the hot fixes on master.",
  "Only the critical set (supply/critical-set.mjs): the commit gate and landing, hooks and guards, the driver core, the board server, money, account and login and the swap. A landed change there is re-proved by its own tests; a red re-proof becomes a card. Everything else just lands.",
  "Hot's red/green, plus the driver's judge and reviewers: cheapest capable writer first, one reviewer on low-risk cards and two on risky ones.",
  "Each card changes only the files it names, checked before release.",
];
export const OVERVIEW_TEXT = {
  hot: { title: "Hot system fixes", sub: "1st of 3, least strict: lands in minutes", purpose: "the primary way we iterate. Almost all system work is a hot fix: fast, many at once, and every one proven by its own red/green test before it lands." },
  sys: {
    title: "System cards",
    sub: "2nd of 3, includes everything of Hot: only the critical set, after landing: re-proved, and carded only when the re-proof is red",
    purpose: "periodically escalating the critical systems to keep the system's integrity. Nothing is filed here up front: a landed hot fix that touches the critical set is re-proved, and becomes a card only if that re-proof goes red.",
  },
  prod: {
    title: "Production cards",
    sub: "3rd of 3, strictness 7 of 7, includes everything of System cards: apps only, during an app's Make Production Ready run; no system file takes it",
    purpose: "only Studio apps being promoted to the production environment. No system work ever takes this path.",
    first: "Drawn before system cards when both wait; never edited or landed directly.",
    last: "Slower and costlier per card, by design: nothing reaches users unproven.",
  },
};

/** The land-card note on the System cards box (renderOverview's THREE LANES line). */
export function landCardNote(jobs: J): string {
  const lc = jobs && (jobs.schedules || []).find((x: J) => x && x.name === "land-card");
  return !lc
    ? "starting: the land-card job is not registered yet"
    : !lc.enabled
      ? "starting: the land-card job is registered but switched off"
      : lc.lastEnd
        ? "land-card last ran " + hm(lc.lastEnd) + (lc.lastStatus && lc.lastStatus !== "ok" ? " (" + lc.lastStatus + ")" : "")
        : "land-card on, first run " + (lc.next ? hm(lc.next) : "soon");
}

/** The pure half: the status, jobs and home resources -> the Overview window. */
export function overviewWindow(d: Record<string, J>, at: number, ok: boolean, error?: string, now = Date.now()): OverviewDetail {
  const s: J = d.status || {},
    dr: J = s.driver || {},
    L: J = s.lander || {},
    lc: J = s.landCheck || {},
    H: J = s.halo || {},
    sw: J = s.switches || {},
    fr: J = (s.frontier && s.frontier.effective) || {},
    cap: J = s.capacity || {},
    q: string[] = Array.isArray(s.queue) ? s.queue : [];
  const running = Array.isArray(lc.running) ? lc.running : [],
    waiting = Array.isArray(lc.queue) ? lc.queue : [];
  const stopped = dr.paused ? (dr.maintenance ? "in Maintenance" : "stopped by you") : "stopped";
  const hh = haloHead(H);

  // the section's header chips (headers().overview, repeated by secChips)
  const raw: { t: string; tone: Tone | undefined }[] = [
    { t: dr.paused ? (dr.maintenance ? "Maintenance" : "Stopped") : "Production", tone: dr.paused ? "a" : undefined },
    { t: dr.up ? (dr.draining ? "updating" : dr.throttled ? "paused (Mac busy)" : "running") : stopped, tone: dr.up ? (dr.draining || dr.throttled ? "a" : "g") : dr.paused ? "a" : "r" },
    {
      t: L.state === "landing" ? "releasing " + ((L.batch && L.batch.cards) || []).join(" ") : L.up ? "releases idle" : dr.paused ? (dr.maintenance ? "releases off in Maintenance" : "releases stopped by you") : "releases stopped",
      tone: !L.up ? (dr.paused ? "a" : "r") : L.state === "landing" ? "g" : undefined,
    },
    { t: "pre-release check " + (lc.on ? "on" : "off"), tone: lc.on ? undefined : "a" },
    { t: "Halo " + hh.t, tone: tn(hh.c) },
    { t: q.length + " in the work list", tone: undefined },
  ];
  const chips: { t: string; tone?: Tone }[] = raw.map((c) => (c.tone ? { t: c.t, tone: c.tone } : { t: c.t }));
  const tone: Tone = !dr.up || !L.up ? "r" : dr.draining || dr.throttled || L.halt ? "a" : "g";

  const lead =
    "Up to " +
    (cap.cardsAtOnce ?? dr.max ?? "?") +
    " cards can be worked on at once." +
    (dr.draining ? " The maintenance driver is updating and will resume shortly." : "") +
    (dr.throttled ? " New work is paused because the Mac is busy." : "") +
    (L.halt ? " Releases are stopped by the halt switch." : "");

  const sections: DetailSection[] = [];
  // renderIdle: only the why, each reason with its cards
  const idle: J = cap.idle || { slots: 0, reasons: [] };
  if (idle.slots) {
    const items: DetailItem[] = (Array.isArray(idle.reasons) ? idle.reasons : []).map((r: J) => {
      const cards: string[] = Array.isArray(r.cards) ? r.cards : [];
      return { text: String(r.text || "") + (cards.length > 1 ? " (" + cards.slice(0, 12).join(" ") + (cards.length > 12 ? " …" : "") + ")" : ""), tone: "a" as Tone };
    });
    sections.push({ title: "Cards not starting, because", kind: "list", items, empty: "no reason given" });
  }

  // the pills (renderOverview), in the legacy order
  const pill = (label: string, value: string, c: string): DetailStat => ({ label, value, ...(tn(c) ? { tone: tn(c) } : {}) });
  const ldTone = !L.up ? (dr.paused ? "a" : "r") : L.halt ? "a" : L.state === "landing" ? "g" : "t2";
  const mo = Object.entries(sw.modeOverrides || {});
  sections.push({
    title: "The lane now",
    kind: "stats",
    stats: [
      pill(
        "Maintenance driver",
        dr.up ? (dr.draining ? "updating" : dr.throttled ? "paused (Mac busy)" : "running") + " · for " + dur(dr.uptimeMs) + " · up to " + (dr.max ?? "?") + " cards at once" : stopped,
        dr.up ? (dr.draining || dr.throttled ? "a" : "g") : dr.paused ? "a" : "r",
      ),
      pill("Releases", !L.up ? stopped : L.state === "landing" ? "releasing " + ((L.batch && L.batch.cards) || []).join(" ") + " · " + dur(now - Number(L.batch && L.batch.at)) : "idle", ldTone),
      pill("Pre-release check", (lc.on ? "on" : "off") + " · " + (running.length ? "checking " + running.join(" ") : "nothing being checked") + " · " + waiting.length + " waiting", lc.on ? "g" : "a"),
      pill("Halo (local AI server)", hh.t + " · " + (H.haloDrafters ?? 0) + " writers" + (H.vitalsOk ? "" : " · health readings unavailable"), hh.c === "g" && !H.vitalsOk ? "a" : hh.c),
      pill("Writers on Halo", sw.haloDrafters ? "on" : "off", sw.haloDrafters ? "g" : "a"),
      pill("Settings profile", sw.profile == null ? "default" : String(sw.profile), sw.profile == null ? "d" : "t2"),
      pill("Board cleanup", sw.relevanceApply ? "applies changes" : "preview only", sw.relevanceApply ? "g" : "d"),
      pill("Cards with a set writing style", mo.length ? mo.map(([k, v]) => k + " " + (MODE[String(v)] || v)).join(", ") : "none", "d"),
      pill("Expert model", mName(fr.opus), ""),
      pill("Standard model", mName(fr.sonnet), ""),
      pill("Fast model", mName(fr.haiku), ""),
      pill("In the queue", q.length + " in the work list (being worked included)", ""),
    ],
  });

  // How each kind of card is worked: Hot (with today's red/green line), System cards (with the land-card note), Production
  const h: J = d.home && d.home.hotRedGreen;
  const T = OVERVIEW_TEXT;
  const hotItems: DetailItem[] = [{ strong: "What it is for", text: T.hot.purpose }, ...HOT.map((text) => ({ text }))];
  if (h && Number.isFinite(Number(h.share))) hotItems.push({ text: "Today: " + Math.round(Number(h.share) * 100) + "% of " + h.of + " hot commits proven red/green.", tone: "g" });
  sections.push({ title: T.hot.title, sub: T.hot.sub, kind: "list", items: hotItems });
  sections.push({ title: T.sys.title, sub: T.sys.sub + " · " + landCardNote(d.jobs), kind: "list", items: [{ strong: "What it is for", text: T.sys.purpose }, ...SYS.map((text) => ({ text }))] });
  sections.push({ title: T.prod.title, sub: T.prod.sub, kind: "list", items: [{ strong: "What it is for", text: T.prod.purpose }, { text: T.prod.first }, { text: T.prod.last }] });

  const strict: StrictMap | null = s.strict && typeof s.strict === "object" ? (s.strict as StrictMap) : null;
  if (!strict) sections.push({ title: "Production strictness", kind: "text", text: "The strictness switches are not in the status reading yet." });
  return { id: "overview", title: "Overview", tone, headline: "", sub: "", chips, at, ok, error, lead, sections, strict };
}

const build: WindowBuilder = async () => {
  try {
    const r = await getMany(["status", "jobs", "home"]);
    return overviewWindow(r.data, r.at, r.ok, r.errors.length ? r.errors.join("; ") : undefined);
  } catch (e) {
    return overviewWindow({}, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
