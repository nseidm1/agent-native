/**
 * FA-19135: the forge alert toasts, ported from the legacy page's fleetTick + svcToasts + paceToasts
 * (tools/lane/maint/ui/index.html): every alert is a toast with its remedy's true state - fleet blockers
 * (parked ones calm), lane contradictions (recurring, paged or verify-master), service health and lane-check
 * alerts (a remedy held in maintenance is the Office card's line, not a toast), and the Budget pace flags (a
 * fault) and notes (dismissible until their words change). Built from the client's status and budget resources.
 */
import { getMany } from "./client.js";

export interface AlertToast {
  /** stable identity: a dismissal holds until the words change */
  key: string;
  words: string;
  bad: boolean;
  kind: "svc" | "pace";
  /** a pace note the viewer may dismiss for good (until its why changes) */
  note?: { id: string; why: string };
}
export interface AlertsView {
  at: number;
  ok: boolean;
  error?: string;
  toasts: AlertToast[];
}

type J = any;
const FRESH_MS = 10 * 60e3;
const fresh = (x: J, now: number) => !!x && now - Date.parse(String(x.at)) <= FRESH_MS;
export const wholeWords = (t: unknown, n = 400) => {
  const s = String(t == null ? "" : t);
  if (s.length <= n) return s;
  const c = s.slice(0, n + 1),
    i = c.lastIndexOf(" ");
  return (i > 0 ? c.slice(0, i) : c.slice(0, n)).replace(/[\s,;:.\-]+$/, "") + "…";
};
const remKey = (x: J) => String((x && (x.key || x.sig)) || "");
function remLine(x: J, rem: Record<string, J>) {
  const r = rem[remKey(x)];
  if (!r) return "→ remedy not verified yet";
  return (r.handled && x.status && !/^→/.test(x.status) ? x.status + " " : "") + r.line;
}
const isHeld = (x: J) => !!x && (x.state === "held" || (!!x.remedy && x.remedy.state === "held"));
const heldFa = (x: J) => {
  const m = /\bFA-\d+\b/.exec(String(x.fa || x.card || x.status || (x.remedy && x.remedy.fa) || ""));
  return m ? m[0] : "";
};

/** The pure half (exported for its spec): the status and budget resources -> the toasts, in the legacy order. */
export function alertToasts(st: J, budget: J, now = Date.now()): AlertToast[] {
  st = st || {};
  const rem: Record<string, J> = st.alertRemedies || {};
  const f = st.fleetBlockers,
    fl = fresh(f, now),
    aAll: J[] = (fl && f.active) || [],
    pk: J[] = (fl && f.parked) || [];
  const k = st.contradictions,
    cs: J[] = ((fresh(k, now) && k.found) || []).filter((x: J) => x.recurring || x.act === "page" || x.act === "verify-master");
  const lc = st.laneChecks,
    lcAll: J[] = fresh(lc, now) ? Object.values(lc.checks || {}).flatMap((c: J) => (c && c.active) || []) : [];
  const sh = st.serviceHealth,
    svAll: J[] = ((fresh(sh, now) && sh.active) || []).concat(lcAll);
  const held = st.driver && st.driver.maintenance ? svAll.filter(isHeld) : [];
  const isH = (x: J) => held.some((h) => h.sig === x.sig);
  const list: J[] = svAll
    .filter((x) => !(isH(x) && heldFa(x)) && (!isH(x) || x.tier !== "toast"))
    .map((x) => ({ ...x, bad: x.tier !== "toast" }))
    .concat(
      aAll.map((b) => ({ sig: "fleet " + b.sig, key: b.sig, icon: "⛔", why: "Fleet blocker: " + b.sig + " — " + ((b.agents || []).length ? b.agents.join(", ") : "no agent hit yet"), status: b.remedy || "re-checking", bad: b.tier !== "toast" })),
      pk.map((b) => ({ sig: "parked " + b.sig, icon: "⏸", why: "Parked fleet blocker: " + b.sig + " · " + (b.remedy || "parked"), status: b.remedy || "parked", line: "", bad: false })),
      cs.map((x) => ({ sig: "contra " + (x.key || x.why), key: x.key, icon: "⚠", why: "Lane contradiction: " + (x.recurring ? "RECURRING " : "") + wholeWords(x.why, 140), status: x.status, bad: true })),
    );
  const out: AlertToast[] = list.map((x) => ({
    key: "svc:" + x.sig,
    kind: "svc",
    bad: x.bad !== false,
    words: (x.icon || "⚠") + " " + String(x.why || "").slice(0, 140) + (x.line != null ? x.line : " " + remLine(x, rem)),
  }));
  const b = budget || {};
  for (const fl2 of (b.flags as J[]) || []) out.push({ key: "pace:" + fl2.id, kind: "pace", bad: true, words: "⚠ Budget pace: " + String(fl2.id).replace(/-/g, " ") + (fl2.why ? " — " + fl2.why : "") });
  for (const n of (b.notes as J[]) || [])
    out.push({ key: "pace:" + n.id, kind: "pace", bad: false, note: { id: String(n.id), why: String(n.why || "") }, words: "Budget pace: " + String(n.id).replace(/-/g, " ") + (n.why ? " — " + n.why : "") });
  return out;
}

export async function getAlerts(): Promise<AlertsView> {
  const r = await getMany(["status", "budget"]);
  return { at: r.at, ok: r.ok, error: r.errors[0], toasts: alertToasts(r.data.status, r.data.budget) };
}
