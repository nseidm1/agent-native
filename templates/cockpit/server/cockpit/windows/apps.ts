/**
 * FA-19129: the Apps picker, ported from the legacy appsDlg (tools/lane/maint/ui/index.html, the APPS SCREEN script: appsPaint,
 * tilePaint, stagePrev/prevPaint, stageLine, cardLine). One tile per registered app: its name and description, the staging
 * preview's state in words (the client has no image route, so no picture), the staging line, its open-card chips, its last
 * release and folder line, and its requests with how each was filed. The tiles, the New app form and each app's Request form
 * are the window's part (app/components/cockpit/windows/AppsPart.tsx), drawn from `part`.
 * FA-19157: each tile shows its staging PICTURE (the region's /cards/app-thumb route, read through the client's image route)
 * and the autopilot / definition-of-done chip (studio-pilot.js tileChip over apps/<id>/env and apps/<id>/checklist); with
 * args.app the same window is that app's STUDIO (part.studio, ./studio.ts), opened natively from Open studio or #apps=<id>.
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailSection } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { APP_ID, get, getMany, thumbShaOf } from "../client.js";
import { activityOf, changesOf, identityOf, inboxOf, lifeTiles, requirementsOf, stagingOf, tileChip, type Identity, type LifeTile, type PilotChip, type Requirement, type StudioStaging } from "./studio.js";
import type { WindowBuilder } from "./registry.js";

type Req = { id: string; at?: string; kind?: string; title?: string; route?: string; status?: string; why?: string; reason?: string; fa?: string };
type BoardApp = { id: string; name?: string; description?: string; dirs?: string[]; counts?: Record<string, number>; lastLanded?: { fa?: string; at?: string } | null; requests?: Req[]; inRepo?: boolean; staged?: boolean; work?: boolean; platform?: string };
type DialogApp = BoardApp & { staging?: { exists?: boolean; sha?: string | null; built?: string | null; running?: boolean } | null; thumb?: { state?: string; url?: string | null; why?: string } | null };
export type BoardApps = { mode?: string; list?: BoardApp[] } | null;
export type AppDialog = { ok?: boolean; mode?: string; apps?: DialogApp[]; error?: string } | null;

/** One app's tile, as the part draws it. */
export interface AppTile {
  id: string;
  name: string;
  desc: string;
  /** the preview box's state (stagePrev): none | stopped | live | fail | rendering | wait */
  preview: string;
  previewTitle: string;
  previewSub: string;
  /** FA-19157: the staging picture, a path under the region's base (app-thumb/<app>/<sha12>.jpg), or null */
  thumb: string | null;
  /** FA-19157: the autopilot / definition-of-done chip (studio-pilot.js tileChip), or null when the app has no checklist */
  pilot: PilotChip | null;
  /** the Start button shows for a stopped staging copy */
  canStart: boolean;
  staging: string;
  stagingOn: boolean;
  chips: { t: string; tone?: Tone }[];
  last: string;
  requests: { id: string; kind: string; title: string; line: string; tone?: Tone; fa?: string }[];
}
/** FA-19157: one app's studio, as the part draws it. */
export interface StudioPart {
  app: string;
  name: string;
  chip: string;
  platform: string;
  identity: Identity;
  inbox: { need: number; proposals: number; text: string };
  tiles: LifeTile[];
  staging: StudioStaging;
  thumb: string | null;
  preview: string;
  requirements: { text: string; detail: string; note: string; items: Requirement[] };
  changes: { id: string; what: string; state: string; at: string; tone: Tone | "" }[];
  activity: { at: string; text: string }[];
  autopilot: { state: string; text: string };
  errors: string[];
}
export interface AppsPartData {
  studio?: StudioPart | null;
  intro: string;
  tiles: AppTile[];
  hint: string;
  requestHint: string;
  [k: string]: unknown;
}

const COLN: Record<string, string> = { pending: "pending", todo: "to do", "in-progress": "in progress", reopened: "reopened", recommendations: "suggestions", released: "released" };
const FILING_T: Record<string, string> = {
  "waiting to file": "Waiting to start filing your card…",
  "waiting for another filing run": "Waiting while another card is filed (cards are filed one at a time)…",
  filing: "Filing your card…",
};
const whenS = (iso: string | null | undefined) => {
  const d = new Date(iso || "");
  return isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

/** The region path of an app's staging picture (thumb.url names <sha12>.jpg), or null. */
export const thumbOf = (a: DialogApp): string | null => {
  const sha = a.thumb ? thumbShaOf(a.thumb.url) : null;
  return sha && APP_ID.test(a.id) ? "app-thumb/" + a.id + "/" + sha + ".jpg" : null;
};
/** The legacy stagePrev and its overlay words (apps.js prevPaint): the picture shows under a live preview, dimmed under stopped / failed. */
export function previewOf(a: DialogApp, dErr: boolean): { state: string; title: string; sub: string } {
  const s = a.staging,
    t = a.thumb || {},
    pic = !!thumbOf(a);
  if (!s) return dErr ? { state: "err", title: "Staging status unavailable", sub: "" } : { state: "wait", title: "", sub: "" };
  if (!s.exists && !s.sha) return { state: "none", title: "No staging copy yet", sub: "The staging copy is cut when the studio first opens it." };
  if (!s.running) return { state: "stopped", title: "Staging not running", sub: "Start it to see the " + (a.name || a.id) + " staging homepage here." };
  if (t.state === "ready") return { state: "live", title: "", sub: "" };
  if (t.state === "failed") return { state: "fail", title: "The preview did not render", sub: t.why || "the picture was not taken" };
  return { state: "rendering", title: pic ? "" : "Rendering the preview…", sub: "" };
}

/** The legacy stageLine. */
export function stagingLine(a: DialogApp, dErr: string): string {
  const st = a.staging;
  if (!st) return dErr ? "Staging status: " + dErr : "";
  return !st.exists && !st.sha ? "No staging copy yet" : st.running ? "Staging running" + (st.built ? " · built " + whenS(st.built) : "") : "Staging stopped";
}

/** The legacy cardLine: the open-card chips, and the release and folder line. */
export function cardLine(a: BoardApp): { chips: { t: string; tone?: Tone }[]; last: string } {
  const counts = a.counts || {};
  const chips: { t: string; tone?: Tone }[] = Object.entries(COLN)
    .filter(([k]) => k !== "released" && counts[k])
    .map(([k, l]) => ({ t: counts[k] + " " + l, tone: k === "in-progress" ? "g" : k === "reopened" ? "a" : undefined }));
  if (!chips.length) chips.push({ t: "no open cards", tone: "d" });
  const last =
    (a.lastLanded ? "Last release " + a.lastLanded.fa + ", " + whenS(a.lastLanded.at) : "No release through the lane yet") +
    " · folder " +
    (a.dirs || []).join(", ") +
    (a.inRepo ? "" : " in its staging copy, on master after Promote");
  return { chips, last };
}

/** The legacy appView's request line (route and filing status). */
export function requestLine(r: Req): { line: string; tone?: Tone } {
  const st =
    r.route === "filing"
      ? r.status === "filed"
        ? "Filed as " + (r.fa || "") + " in Backlog"
        : r.status === "not filed"
          ? "Not filed: " + (r.why || "")
          : FILING_T[r.status || ""] || "Filing your card…"
      : r.route === "backlog"
        ? "In the production backlog"
        : r.route === "repo"
          ? "Created in the repo"
          : "Starter page prepared";
  const tone: Tone | undefined = r.status === "not filed" ? "r" : r.status === "filed" ? "g" : r.route === "filing" ? "a" : undefined;
  return { line: whenS(r.at) + " · " + st, tone };
}

/** The pure half: board.apps (cards, requests) + appdialog (staging, thumb) -> the window. */
export type Pilots = Record<string, { ap: any; p: any } | undefined>;
export function appsWindow(A: BoardApps, D: AppDialog, at: number, ok: boolean, error?: string, pilots: Pilots = {}, studio: StudioPart | null = null): WindowDetail {
  const dErr = D && D.ok === false ? D.error || "not answering" : !D ? "not answering" : "";
  const byD = new Map((D && D.apps ? D.apps : []).map((a) => [a.id, a]));
  const base: DialogApp[] = A && A.list ? A.list : D && D.apps ? D.apps : [];
  const all: DialogApp[] = base.map((a) => {
    const d = byD.get(a.id);
    return d ? { ...d, ...a, staging: d.staging, thumb: d.thumb } : a;
  });
  const tiles: AppTile[] = all.map((a) => {
    const p = previewOf(a, !!dErr);
    const c = cardLine(a);
    return {
      id: a.id,
      name: a.name || a.id,
      desc: a.description || (a.dirs || []).join(", "),
      preview: p.state,
      previewTitle: p.title,
      previewSub: p.sub,
      thumb: p.state === "none" || p.state === "wait" || p.state === "err" ? null : thumbOf(a),
      pilot: pilots[a.id] ? tileChip(pilots[a.id]!.ap, pilots[a.id]!.p) : null,
      canStart: p.state === "stopped",
      staging: stagingLine(a, dErr),
      stagingOn: !!(a.staging && a.staging.running),
      chips: c.chips,
      last: c.last,
      requests: (a.requests || []).map((r) => {
        const l = requestLine(r);
        return { id: r.id, kind: r.kind || "", title: r.title || "", line: l.line, tone: l.tone, fa: r.fa };
      }),
    };
  });
  const notFiled = tiles.reduce((s, t) => s + t.requests.filter((r) => r.tone === "r").length, 0);
  const sections: DetailSection[] = [];
  const part: AppsPartData = {
    studio,
    intro:
      "Pick an app to open its studio. What you ask for there builds the app's staging copy, pictured on each card; only Promote to production turns staging changes into cards. A card belongs to an app when the change it describes is inside that app's folder; every other card is system work.",
    tiles,
    hint: "Creates the app and its staging copy; the first staging build starts from your description and attachments.",
    requestHint:
      "Your request is filed into Backlog as a card: it gets its exact change before any draft, and is drafted during this app's production run (Promote to production).",
  };
  if (studio)
    return {
      id: "apps",
      title: studio.name,
      tone: studio.inbox.need ? "a" : studio.errors.length ? "a" : "g",
      headline: "app studio",
      sub: "",
      chips: [{ t: studio.chip, tone: "g" }],
      at,
      ok,
      error,
      part: part as unknown as Record<string, unknown>,
      sections,
    };
  return {
    id: "apps",
    title: "Apps",
    tone: !A && !D ? "d" : notFiled ? "a" : "g",
    headline: A || D ? pl(tiles.length, "app") + (notFiled ? " · " + pl(notFiled, "request") + " not filed" : "") : "Reading the apps…",
    sub: "",
    chips: [{ t: "Studio changes build in staging · Promote to production files production cards", tone: "g" }],
    at,
    ok,
    error,
    part: part as unknown as Record<string, unknown>,
    sections,
  };
}

/** FA-19157: one app's studio from its client reads (the pure half is ./studio.ts). */
export function studioPart(app: DialogApp, env: any, lc: any, cl: any, sv: any, qs: any, errors: string[], now = Date.now()): StudioPart {
  const p = previewOf({ ...app, staging: app.staging || (env && env.staging) || null }, false);
  const ap = (env && env.autopilot) || {};
  return {
    app: app.id,
    name: app.name || app.id,
    chip: (app.platform && app.platform !== "web" ? app.platform[0].toUpperCase() + app.platform.slice(1) + " app" : "App") + " · " + (app.dirs || []).join(", "),
    platform: app.platform || "web",
    identity: identityOf(env, now),
    inbox: inboxOf(lc, env, qs, app.id),
    tiles: lifeTiles(lc, env, now),
    staging: stagingOf(env),
    thumb: thumbOf(app),
    preview: p.state,
    requirements: requirementsOf(cl),
    changes: changesOf(sv),
    activity: activityOf(sv),
    autopilot: { state: String(ap.state || "off"), text: String(ap.text || "") },
    errors,
  };
}

const build: WindowBuilder = async (args) => {
  try {
    const r = await getMany(["board", "appdialog"]);
    const b = r.data.board;
    const A: BoardApps = b && b.apps ? b.apps : null;
    const D: AppDialog = r.data.appdialog;
    const ids = [...new Set([...((A && A.list) || []), ...((D && D.apps) || [])].map((a) => a.id).filter((id) => APP_ID.test(id)))];
    const want = typeof args.app === "string" && ids.includes(args.app) ? args.app : null;
    const names = ids.flatMap((id) => ["apps/" + id + "/env", "apps/" + id + "/checklist"]);
    const x = await getMany(names);
    if (want) {
      // the open studio's own reads are always fresh (a live read is otherwise reused up to 30 s): staging moves under it as it is viewed
      const own = ["apps/" + want + "/env", "apps/" + want + "/checklist", "apps/" + want + "/lifecycle", "apps/" + want + "/studio", "questions"];
      const rs = await Promise.allSettled(own.map((n) => get(n, { fresh: n !== "questions" })));
      rs.forEach((r, i) => {
        if (r.status === "fulfilled") {
          x.data[own[i]] = r.value.data;
          if (!r.value.ok && r.value.error) x.errors.push(r.value.error);
        } else x.errors.push(own[i] + ": " + (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      });
    }
    const pilots: Pilots = {};
    for (const id of ids) {
      const env = x.data["apps/" + id + "/env"],
        cl = x.data["apps/" + id + "/checklist"];
      if (cl) pilots[id] = { ap: env && env.autopilot, p: cl.progress };
    }
    let studio: StudioPart | null = null;
    if (want) {
      const a = { ...(((D && D.apps) || []).find((y) => y.id === want) || { id: want }), ...(((A && A.list) || []).find((y) => y.id === want) || {}) } as DialogApp;
      const d = ((D && D.apps) || []).find((y) => y.id === want);
      if (d) Object.assign(a, { staging: d.staging, thumb: d.thumb });
      studio = studioPart(a, x.data["apps/" + want + "/env"], x.data["apps/" + want + "/lifecycle"], x.data["apps/" + want + "/checklist"], x.data["apps/" + want + "/studio"], x.data.questions, x.errors.filter((e) => e.includes(want) || e.startsWith("questions")));
    }
    const errs = [...r.errors, ...(want ? [] : [])];
    return appsWindow(A, D, r.at, r.ok, r.ok ? undefined : errs.join("; "), pilots, studio);
  } catch (e) {
    return appsWindow(null, null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
