/**
 * FA-19173: studio-env.js's rules, pure: why each of the env row's buttons is off (its title), the plan's quote, the ETA. The EnvRow
 * draws them; the Launch menu reads the same answers (the legacy envWhy read the row's own buttons).
 */
import { type EnvState, runActive } from "./data";

export const NA = "Production readiness is not available yet";
export const n = (k: number, one: string, many?: string) => k + " " + (k === 1 ? one : many || one + "s");
export const short = (sha: unknown) => (sha ? String(sha).slice(0, 8) : "");
export const okUrl = (u: unknown) => (/^https?:\/\//.test(String(u || "")) ? String(u) : null);
export const clock = (at: unknown) => {
  const d = new Date(String(at || ""));
  return isNaN(+d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
const hrs = (m: number) => (m >= 120 ? " (" + Math.round(m / 6) / 10 + " h)" : "");
export const etaText = (e: any) => (e && e.minLow != null ? "~" + e.minLow + "–" + e.minHigh + " min" + hrs(e.minHigh) : null);
export const usd2 = (v: unknown) => "$" + (Number(v) || 0).toFixed(2);
export const quoteLine = (p: any) => {
  const q = (p && p.quote) || {},
    et = etaText(p && p.eta) || (q.min ? "~" + Math.round(q.min) + " min of work" : "time not measured yet");
  return n((p && p.files) || 0, "change") + " → " + n(((p && p.cards) || []).length, "card") + ", " + et + (q.usd != null ? ", ~$" + q.usd : "");
};
export const envAgo = (t: unknown) => {
  const s = Math.max(0, (Date.now() - Date.parse(String(t || ""))) / 1000);
  return !isFinite(s) ? "" : s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
};

export type EnvModel = {
  answered: boolean;
  why: string;
  live: boolean;
  view: { on: boolean; title: string };
  ready: { off: boolean; title: string; label: string };
  promote: { off: boolean; title: string; label: string };
};
/** The row's state, as studio-env.js draw() computes it (E.absent: the env read answered 404; E.err: it failed otherwise). */
export function envModel(
  st: EnvState | undefined,
  o: { absent: boolean; err: string | null; rd: any; rdAbsent: boolean; rdErr: string | null; rp: any; rpBusy: boolean; starting: boolean; promoting: boolean; appName: string },
): EnvModel {
  const sg = (st && st.staging) || null,
    pm = (st && st.promotion) || null,
    rd = o.rd;
  // the staging server's own address: its loopback one on this Mac, else the one the network reaches (only in the title: the button opens the cockpit's proxy)
  const lo = typeof location !== "undefined" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  const stUrl = sg && okUrl(lo ? sg.local || sg.url : sg.url);
  const live = Boolean(pm && ["running", "publishing"].includes(pm.state));
  const why = o.absent
    ? "Staging is not set up yet: the environments service does not answer for " + o.appName
    : o.err
      ? "The environments service did not answer: " + o.err
      : !sg
        ? "No staging build yet"
        : sg.error
          ? "The staging build failed: " + sg.error
          : sg.building
            ? "Staging is building"
            : !stUrl
              ? "Staging has no address yet"
              : "";
  const rp = o.rp,
    rpCards = rp && rp.cards ? rp.cards.length : 0;
  const active = runActive(rd);
  const mkWhy =
    why ||
    (o.rdAbsent
      ? NA
      : o.rdErr && !rd
        ? "Production readiness did not answer: " + o.rdErr
        : active
          ? "A production-ready run is active: " + (rd.why || rd.remaining + " cards remain") + (rd.stagingMovedBy ? "; staging changed since, Make Production Ready again once it ends" : "")
          : !rp
            ? "Comparing staging with production…"
            : !rpCards
              ? rp.why || "Staging is the same as production: nothing to make ready"
              : "");
  const prWhy = live
    ? ""
    : why ||
      (o.rdAbsent
        ? NA
        : !rd
          ? o.rdErr
            ? "Production readiness did not answer: " + o.rdErr
            : "Reading production readiness…"
          : rd.promotable
            ? ""
            : rd.state === "cards"
              ? n(rd.remaining, "card") + " still landing"
              : rd.state === "planning"
                ? "The production-ready run is still planning its cards"
                : rd.state == null
                  ? "Nothing to promote: Make Production Ready first"
                  : rd.state === "ready" && rd.stagingMovedBy
                    ? "Staging changed since: " + n(rd.stagingMovedBy, "staging change") + " since the run; Make Production Ready again"
                    : rd.why || "Not production ready (" + rd.state + ")");
  return {
    answered: Boolean(st) || o.absent || Boolean(o.err),
    why,
    live,
    view: { on: Boolean(stUrl && sg && !sg.error), title: stUrl ? "Open the staging build of " + o.appName + (sg && sg.sha ? " at " + short(sg.sha) : "") + " (through the cockpit; served from " + stUrl + ")" : why },
    ready: {
      off: Boolean(mkWhy || o.starting),
      title: mkWhy || "Card the staging changes 10-every-10 and run them through the production lane: " + quoteLine(rp),
      label: rd && rd.state === "ready" && rd.stagingMovedBy ? "Make Production Ready again" : "Make Production Ready",
    },
    promote: {
      off: Boolean(prWhy || o.promoting),
      title: live ? "Show the promotion in progress" : prWhy || "Production ready at " + short(rd && rd.readyMasterSha) + ": build the release candidate, check it, then publish on your fingerprint",
      label: live ? "Promotion in progress" : "Promote to production",
    },
  };
}
