/**
 * FA-19129: the Apps picker, ported from the legacy appsDlg (tools/lane/maint/ui/index.html, the APPS SCREEN script: appsPaint,
 * tilePaint, stagePrev/prevPaint, stageLine, cardLine). One tile per registered app: its name and description, the staging
 * preview's state in words (the client has no image route, so no picture), the staging line, its open-card chips, its last
 * release and folder line, and its requests with how each was filed. The tiles, the New app form and each app's Request form
 * are the window's part (app/components/cockpit/windows/AppsPart.tsx), drawn from `part`; the studio itself opens on the
 * legacy page (#apps=<id>) until it is ported.
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailSection } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
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
  /** the Start button shows for a stopped staging copy */
  canStart: boolean;
  staging: string;
  stagingOn: boolean;
  chips: { t: string; tone?: Tone }[];
  last: string;
  requests: { id: string; kind: string; title: string; line: string; tone?: Tone; fa?: string }[];
}
export interface AppsPartData {
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

/** The legacy stagePrev, in words: the picture itself is not on the client. */
export function previewOf(a: DialogApp, dErr: boolean): { state: string; title: string; sub: string } {
  const s = a.staging,
    t = a.thumb || {};
  if (!s) return dErr ? { state: "err", title: "Staging status unavailable", sub: "" } : { state: "wait", title: "", sub: "" };
  if (!s.exists && !s.sha) return { state: "none", title: "No staging copy yet", sub: "The staging copy is cut when the studio first opens it." };
  if (!s.running) return { state: "stopped", title: "Staging not running", sub: "Start it to see the " + (a.name || a.id) + " staging homepage here." };
  if (t.state === "ready") return { state: "live", title: "Staging preview ready", sub: "The picture opens in the studio; it is not shown here yet." };
  if (t.state === "failed") return { state: "fail", title: "The preview did not render", sub: t.why || "the picture was not taken" };
  return { state: "rendering", title: "Rendering the preview…", sub: "" };
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
export function appsWindow(A: BoardApps, D: AppDialog, at: number, ok: boolean, error?: string): WindowDetail {
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
  const sections: DetailSection[] = [
    {
      title: "Not shown here yet",
      kind: "text",
      collapsed: true,
      text:
        "The staging preview pictures (the cockpit client has no image route, so each tile says the picture's state in words), the studio autopilot and checklist chip on each tile (the studio's env and QA endpoints are not on the client), and the studio itself, which opens on the legacy page.",
    },
  ];
  const part: AppsPartData = {
    intro:
      "Pick an app to open its studio. What you ask for there builds the app's staging copy, pictured on each card; only Promote to production turns staging changes into cards. A card belongs to an app when the change it describes is inside that app's folder; every other card is system work.",
    tiles,
    hint: "Creates the app and its staging copy; the first staging build starts from your description and attachments.",
    requestHint:
      "Your request is filed into Backlog as a card: it gets its exact change before any draft, and is drafted during this app's production run (Promote to production).",
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

const build: WindowBuilder = async () => {
  try {
    const r = await getMany(["board", "appdialog"]);
    const b = r.data.board;
    return appsWindow(b && b.apps ? b.apps : null, r.data.appdialog, r.at, r.ok, r.ok ? undefined : r.errors.join("; "));
  } catch (e) {
    return appsWindow(null, null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
