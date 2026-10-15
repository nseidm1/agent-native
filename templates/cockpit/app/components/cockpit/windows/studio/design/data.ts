/**
 * FA-19173 (Design and Verify): the data the Design and Verify tools share, read through the cockpit client exactly as the legacy
 * studio reads it (card-studio.js): the studio view (app '': rec.jobs, running, maxRunning, estimate, flow), the jobs in flight
 * (app live, 1 s while one runs), the designs (app designs: rdLoad), the API mocks gate (qa mocks: mkgLoad, studio-toasts.js
 * mocksGate), the actions' caps (studio actions: capsFor) and the safe markdown (md). The mocks and designs reads are small module
 * stores (one per app, like legacy's MKG and RDD) so the menus and the dialogs see one copy.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { errText, studioFileSrc, studioRead, useStudioRead } from "../api";

// ---------- New Design (card-studio.js ND_STEPS, ND_KINDS, ndJob, ndProgress)
export const ND_STEPS = ["Read the staging app", "Apply the design knowledge", "Research references", "Write the copy", "Draw the screens", "Critique against the rules", "Generate the imagery on the Halo"];
export type NdKind = "newdesign" | "enhancedesign";
export const ND_KINDS: Record<NdKind, { k: string; label: string; does: string }> = {
  newdesign: { k: "new-design", label: "New Design", does: "A new design of the whole app for review: a new style from the design knowledge, every main screen redrawn, imagery generated on the Halo" },
  enhancedesign: { k: "enhance-design", label: "Enhance Existing Design", does: "The same app made better: its design language kept, the design rules applied, imagery generated on the Halo" },
};
export const ACTIVE = (j: any) => Boolean(j) && ["queued", "working"].includes(j.status);

/** The studio view (GET app ''): every 8 s, 4 s while a job runs (legacy poll()). */
export function useView(app: string) {
  const [fast, setFast] = useState(false);
  const q = useStudioRead<any>(app, "app", "", { every: fast ? 4000 : 8000 });
  const running = Boolean(q.data && q.data.running);
  useEffect(() => setFast(running), [running]);
  return q;
}
/** The jobs in flight (GET app live), every second while one runs or a design dialog follows one (legacy livePoll). */
export function useLive(app: string, on: boolean) {
  return useStudioRead<any>(app, "app", "live", { every: on ? 1000 : 0, enabled: on });
}
/** Re-read the studio view and the live jobs now (after a write: legacy act() applied the answer's view). */
export function useViewRefresh(app: string) {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["action", "get-studio", { app, root: "app", path: "" }] });
    void qc.invalidateQueries({ queryKey: ["action", "get-studio", { app, root: "app", path: "live" }] });
  }, [qc, app]);
}
/** A write's answer carries the fresh studio view (legacy act() -> apply(j.view)): put it in place, then re-read the live jobs. */
export function usePutView(app: string) {
  const qc = useQueryClient();
  const refresh = useViewRefresh(app);
  return useCallback(
    (answer: any) => {
      if (answer && answer.view && typeof answer.view === "object") qc.setQueryData(["action", "get-studio", { app, root: "app", path: "" }], answer.view);
      else refresh();
      void qc.invalidateQueries({ queryKey: ["action", "get-studio", { app, root: "app", path: "live" }] });
    },
    [qc, app, refresh],
  );
}
/** The current proposal of a kind: the newest job of it not discarded, its live progress merged in (legacy ndJob). */
export function ndJob(v: any, live: any, kind: NdKind) {
  const js = ((v && v.rec && v.rec.jobs) || []).filter((j: any) => j.action === kind && !j.discarded);
  const j = js[js.length - 1];
  if (!j) return null;
  const l = live && Array.isArray(live.jobs) ? live.jobs.find((x: any) => x.id === j.id) : null;
  // the result is in the record, not the live poll: a live 'done' over an unfinished record stays a progress view until the record lands
  if (l && !ACTIVE(l) && ACTIVE(j)) return { ...j, progress: { pct: 100, step: ND_STEPS.length, label: "Loading the result" }, phase: null };
  return l ? { ...j, status: l.status, progress: l.progress, phase: l.phase || j.phase } : j;
}
export function ndProgress(j: any): { pct: number; step: number; label: string } {
  if (j.status === "done") return { pct: 100, step: ND_STEPS.length, label: "Ready for review" };
  const p = j.progress;
  if (p && p.step) return { pct: Number(p.pct) || 0, step: p.step, label: p.label };
  return { pct: j.status === "working" ? 3 : 0, step: 0, label: j.status === "working" ? "Starting" : "Queued" };
}
/** The studio's actions (GET studio actions): each action's model and caps (legacy capsFor with the gear on its defaults). */
export function useCaps(app: string, kind: string): { caps: { model: string; maxUsd: number; maxMin: number } | null; err: string | null } {
  const q = useStudioRead<any>(app, "studio", "actions", {});
  const a = q.data && Array.isArray(q.data.actions) ? q.data.actions.find((x: any) => x.k === kind) : null;
  return { caps: a ? { model: String(a.model || "sonnet"), maxUsd: Number(a.maxUsd) || 0, maxMin: Number(a.maxMin) || 0 } : null, err: q.error ? errText(q.error) : q.data && !a ? "no " + kind + " action" : null };
}
// ESTIMATES (card-studio.js estShort / estApp / estTitle / estChip): a studio change to an app is a change of its staging copy
export const estApp = (v: any) => (v && v.estimate && v.estimate.staging && v.estimate.staging.usd ? "staging" : "apply");
export const estShort = (q: any) => {
  const m = (x: number) => (x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x)));
  return "≈ $" + m(q.usd[0]) + "-" + m(q.usd[2]) + " · " + Math.round(q.min[0]) + "-" + Math.round(q.min[2]) + " min";
};
export const estTitle = (q: any, what: string) =>
  "Estimate for " + what + ": " + q.text + ((q.notes || []).length ? ". " + q.notes.join(". ") : "") + ((q.classes || []).length ? ". Classes: " + q.classes.map((c: any) => c.key).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).join(", ") : "") + ". Kept with the request when you commit; compared with the actual when it is released.";
/** The estimate chip's words: {text, title} or null (withheld: no figures, only why). */
export function estimateOf(v: any, k: string, what: string): { text: string; title: string } | null {
  const q = v && v.estimate && v.estimate[k];
  if (!q) return null;
  if (q.withheld) return { text: "estimate withheld", title: String(q.text || "") };
  if (!q.usd || !q.min) return null;
  return { text: estShort(q), title: estTitle(q, what) };
}

// ---------- a tiny per-app store (legacy's module-level MKG / RDD)
type Box<T> = { app: string | null; data: T | null; loading: boolean; err: string | null; at: number; sig: string; status: number };
function store<T>() {
  let b: Box<T> = { app: null, data: null, loading: false, err: null, at: 0, sig: "", status: 0 };
  const subs = new Set<() => void>();
  return {
    get: () => b,
    set(p: Partial<Box<T>>) {
      b = { ...b, ...p };
      for (const f of subs) f();
    },
    sub(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
const statusOf = (e: unknown) => {
  const m = /\b(404|403|409|400)\b/.exec(errText(e));
  return e && typeof e === "object" && "status" in (e as any) ? Number((e as any).status) || 0 : m ? Number(m[1]) : 0;
};

// ---------- THE QA GATE (legacy MKG / mkgLoad / qaGate, studio-toasts.js mocksGate)
export type Gate = { state: "generating" | "stale" | "needed"; pct: number | null; badge: string; why: string };
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
export function mocksGate(d: any, appName: string): Gate | null {
  const deps = ((d && d.deps) || []).filter((x: any) => x.mockable !== false);
  const off = deps.filter((x: any) => x.status !== "ready");
  if (!off.length) return null;
  const who = (appName || "The app") + " calls " + list(off.map((x: any) => x.vendor || x.id));
  const job = d.job && (d.job.kind || "generate") === "generate" ? d.job : null;
  if (job || off.some((x: any) => x.status === "generating")) {
    const pct =
      job && job.N
        ? Math.round((100 * (job.n || 0)) / job.N)
        : (() => {
            const p = off.map((x: any) => x.progress && x.progress.pct).filter((n: any) => n != null);
            return p.length ? Math.round(p.reduce((a: number, b: number) => a + b, 0) / p.length) : null;
          })();
    return { state: "generating", pct, badge: "Mocks generating" + (job && job.N ? " · " + (job.n || 0) + " of " + job.N : pct != null ? " · " + pct + "%" : ""), why: who + ": their mocks are being generated; QA can run once they are ready" };
  }
  if (off.every((x: any) => x.status === "stale")) return { state: "stale", pct: null, badge: "Mocks out of date", why: who + ": their mocks are out of date, update them first so QA can pass or fail them" };
  return { state: "needed", pct: null, badge: "Mocks needed", why: who + ": generate their mocks first so QA can pass or fail them" };
}
const MKG = store<any>();
let mkgTimer: ReturnType<typeof setTimeout> | null = null;
/** GET qa mocks once per studio (force: the QA dialog opened, or a generation is followed); a 404 means no mock engine: never gated. */
export function mkgLoad(app: string, force = false) {
  const b = MKG.get();
  if (b.app !== app) {
    if (mkgTimer) clearTimeout(mkgTimer);
    MKG.set({ app, data: null, loading: false, at: 0, err: null });
  }
  const c = MKG.get();
  if (c.loading || (!force && c.at)) return;
  MKG.set({ loading: true });
  studioRead<any>(app, "qa", "mocks")
    .then((d) => MKG.get().app === app && MKG.set({ data: d, err: null }))
    .catch((e) => MKG.get().app === app && statusOf(e) === 404 && MKG.set({ data: null }))
    .finally(() => {
      if (MKG.get().app !== app) return;
      MKG.set({ loading: false, at: Date.now() });
    });
}
/** The mocks view's fresh read keeps the gate in step (legacy mkLoad -> MKG). */
export const mkgPut = (app: string, data: any) => MKG.set({ app, data, at: Date.now() });
export function useMocksGate(app: string, appName: string, follow: boolean): { gate: Gate | null; data: any } {
  const b = useSyncExternalStore(MKG.sub, MKG.get, MKG.get);
  useEffect(() => {
    mkgLoad(app);
  }, [app]);
  const data = b.app === app ? b.data : null;
  const gate = data ? mocksGate(data, appName) : null;
  // a generation runs: follow it every 3 s (9 s hidden) while the studio is open and the mocks view is not already polling
  useEffect(() => {
    if (!gate || gate.state !== "generating" || !follow) return;
    const t = setTimeout(() => mkgLoad(app, true), typeof document !== "undefined" && document.hidden ? 9000 : 3000);
    mkgTimer = t;
    return () => clearTimeout(t);
  }, [app, gate && gate.state, follow, b.at]); // eslint-disable-line react-hooks/exhaustive-deps
  return { gate, data };
}

// ---------- REVIEW EXISTING DESIGNS' data (legacy RDD / rdSig / rdLoad)
const RDD = store<any>();
export const rdSig = (v: any) =>
  ((v && v.rec && v.rec.staged) || []).length + "|" + ((v && v.rec && v.rec.designCurrent) || "") + "|" + ((v && v.rec && v.rec.jobs) || []).filter((j: any) => j.status === "done" && /design$/.test(j.action)).length;
export function rdLoad(app: string, sig: string, force = false) {
  const b = RDD.get();
  if (b.app !== app) RDD.set({ app, data: null, err: null, sig: "" });
  const c = RDD.get();
  if (!force && c.sig === sig && (c.data || c.loading || c.err)) return;
  RDD.set({ sig, loading: true });
  studioRead<any>(app, "app", "designs")
    .then((d) => RDD.get().app === app && RDD.set({ data: d, err: null }))
    .catch((e) => RDD.get().app === app && RDD.set({ err: errText(e) }))
    .finally(() => RDD.get().app === app && RDD.set({ loading: false }));
}
export function useDesigns(app: string, sig: string | null) {
  const b = useSyncExternalStore(RDD.sub, RDD.get, RDD.get);
  useEffect(() => {
    if (sig != null) rdLoad(app, sig);
  }, [app, sig]);
  return b.app === app ? b : { ...b, data: null, err: null, loading: true };
}

// ---------- SAFE MARKDOWN (card-studio.js md): everything is escaped first; only the tags built here exist; links are http(s) only
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export function md(src: unknown): string {
  const L = String(src || "").replace(/\r/g, "").split("\n");
  let out = "",
    i = 0;
  const inl = (s0: string) => {
    const codes: string[] = [];
    let s = esc(s0).replace(/`([^`]+)`/g, (_m, c) => {
      codes.push(c);
      return "\u0001" + (codes.length - 1) + "\u0001";
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>");
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (_m, p, u) => p + '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + "</a>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
    return s.replace(/\u0001(\d+)\u0001/g, (_m, n) => "<code>" + codes[Number(n)] + "</code>");
  };
  const isBlock = (l: string) => /^```|^#{1,6}\s|^\s*>|^\s*([-*+]|\d+[.)])\s+|^\s*\|.*\|\s*$/.test(l);
  while (i < L.length) {
    const l = L[i];
    let m: RegExpExecArray | null;
    if (/^```/.test(l)) {
      const b: string[] = [];
      i++;
      while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]);
      i++;
      out += "<pre><code>" + esc(b.join("\n")) + "</code></pre>";
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const n = Math.min(6, m[1].length + 3);
      out += "<h" + n + ">" + inl(m[2].replace(/#+\s*$/, "")) + "</h" + n + ">";
      i++;
      continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(l)) {
      out += "<hr>";
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(L[i + 1] || "")) {
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inl(c.trim()));
      let t = '<div class="tw"><table><thead><tr>' + cells(l).map((c) => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) t += "<tr>" + cells(L[i++]).map((c) => "<td>" + c + "</td>").join("") + "</tr>";
      out += t + "</tbody></table></div>";
      continue;
    }
    if (/^\s*>/.test(l)) {
      const b: string[] = [];
      while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, ""));
      out += "<blockquote>" + md(b.join("\n")) + "</blockquote>";
      continue;
    }
    if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(l))) {
      const ol = /\d/.test(m[1]);
      const items: string[] = [];
      while (i < L.length && (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (/^\s*([-*+]|\d+[.)])\s+/.test(L[i])) items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += " " + L[i].trim();
        i++;
      }
      out += (ol ? "<ol>" : "<ul>") + items.map((x) => "<li>" + inl(x) + "</li>").join("") + (ol ? "</ol>" : "</ul>");
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const p = [l];
    i++;
    while (i < L.length && L[i].trim() && !isBlock(L[i])) p.push(L[i++]);
    out += "<p>" + inl(p.join(" ")) + "</p>";
  }
  return out;
}

/** A QA picture the cockpit names by its own path (qa/<app>/runs/... or qa/<app>/verify/...): the same file through the studio's files. */
export function qaFile(app: string, u: string): string {
  const m = new RegExp("^/[a-z]+/studio/qa/" + app + "/(.+)$").exec(String(u || ""));
  return m ? studioFileSrc(app, "qa", m[1]) : String(u || "");
}

/** An error next to its control that clears itself after 8 s or on a tap (legacy flashErr). */
export function useFlash(): [string, (msg: string) => void, () => void] {
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 8000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg, () => setMsg("")];
}
