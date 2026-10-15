/**
 * FA-19173: the action menus' reads, shared by the menus, the rows the tile details hold (PilotRow, EnvRow) and the dialogs. Each is the
 * legacy studio's own read through the cockpit client (get-studio), polled at the legacy pace: the lifecycle (studio-lifecycle.js, 10 s,
 * 4 s while a lens runs), the environments (studio-env.js, 12 s, 3 s while a deploy, a run or a build moves), the requirements, the
 * autopilot and the checkpoints (studio-pilot.js, 20 s, 5 s while Build it runs), the studio view's flow (card-studio.js: the lead
 * actions, the jobs in flight). One React Query key per read, so the menus and the rows share one poll.
 */
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { type Root, type WriteRoot, studioWrite, useStudio } from "../api";

/** One read, polled at `every` (a number, or a function of the last answer); `scope` re-keys it (a plan read again when staging moves). */
export function useRead<T = any>(app: string, root: Root, path: string, o: { every?: number | ((d: T | undefined) => number); enabled?: boolean; scope?: string; stale?: number } = {}) {
  return useActionQuery<T>(
    "get-studio" as any,
    { app, root, path } as any,
    {
      enabled: o.enabled !== false,
      refetchInterval: typeof o.every === "function" ? (q: any) => (o.every as (d: T | undefined) => number)(q.state.data as T | undefined) : o.every || false,
      retry: 1,
      ...(o.scope ? { queryKeyScope: [o.scope] } : {}),
      ...(o.stale ? { staleTime: o.stale } : {}),
    } as any,
  );
}

/** A write through the client (cockpit-studio-post), then every read of this app's studio is read again. */
export function useWriter() {
  const st = useStudio();
  const qc = useQueryClient();
  return useCallback(
    async <T = any>(root: WriteRoot, path: string, body: Record<string, unknown> = {}): Promise<T> => {
      const r = await studioWrite<T>(st.app, root, path, body);
      void qc.invalidateQueries({ queryKey: ["action", "get-studio", { app: st.app }] });
      return r;
    },
    [st.app, qc],
  );
}
/** Read this app's studio reads again (after a write elsewhere, or a dialog that opens on fresh data). */
export function useReread() {
  const st = useStudio();
  const qc = useQueryClient();
  return useCallback((root?: Root, path?: string) => void qc.invalidateQueries({ queryKey: ["action", "get-studio", { app: st.app, ...(root ? { root } : {}), ...(path !== undefined ? { path } : {}) }] }), [st.app, qc]);
}

// ---------- the reads
export type Lens = { id: string; label: string; short: string; does: string; caps: { maxUsd: number; maxMin: number; model: string }; state: string; waiting: number; baseline: number | null; lastAt: string | null; step: string | null; since: string | null; error: string | null };
export type Lifecycle = {
  build: { progress: any; autopilot: any; text: string; tone: string };
  quality: any;
  launch: any;
  live: any;
  lenses: Lens[];
  inbox: { questions: number; decisions: { lens: string; label: string; run: string; id: string; title: string; question: string; options: string[] }[]; proposals: number; needsYou: number };
};
const lensHot = (lc?: Lifecycle) => Boolean(lc && lc.lenses.some((l) => l.state === "measuring" || l.state === "running"));
export function useLifecycle() {
  const st = useStudio();
  return useRead<Lifecycle>(st.app, "app", "lifecycle", { every: (d) => (lensHot(d) ? 4000 : 10000) });
}

export type EnvState = {
  staging: { exists: boolean; url: string | null; local: string | null; sha: string | null; short: string | null; built: string | null; building: boolean; error: string | null; running: boolean } | null;
  production: { url: string | null; sha: string | null; short: string | null; at: string | null; canRollback: boolean; rollbackTo: string | null } | null;
  promotion: any;
  ready: any;
};
const OPEN = ["planning", "cards"];
export const runActive = (rd: any) => Boolean(rd && OPEN.includes(rd.state));
export function useEnv() {
  const st = useStudio();
  return useRead<EnvState>(st.app, "env", "", {
    every: (d) => {
      const pm = d && d.promotion, running = pm && ["running", "publishing"].includes(pm.state);
      return running || runActive(d && d.ready) || (d && d.staging && d.staging.building) ? 3000 : 12000;
    },
  });
}
/**
 * The Make Production Ready run rides on the env read as .ready; an older server answers without it, so its own read (404 = "not
 * available yet"). Then what it would card now (ready/plan), read again only when staging, the run's state or its drift moves.
 */
export function useReadiness(env: EnvState | undefined, envErr: unknown) {
  const st = useStudio();
  const own = Boolean(env && !(env.ready && env.ready.ok !== false));
  const rq = useRead<any>(st.app, "env", "ready", { enabled: own, every: 12000 });
  const rdAbsent = own && rq.isError && /404|no such|not found/i.test(String((rq.error as any)?.message || ""));
  const rd = env && env.ready && env.ready.ok !== false ? env.ready : own ? rq.data || null : null;
  const rdErr = own && rq.isError && !rdAbsent ? String((rq.error as any)?.message || "") : null;
  const sg = env && env.staging;
  const key = sg && sg.sha ? sg.sha + "|" + (rd && rd.state) + "|" + (rd && rd.stagingMovedBy) : "";
  const planOn = Boolean(env && !envErr && !rdAbsent && key && !runActive(rd));
  const pq = useRead<any>(st.app, "env", "ready/plan", { enabled: planOn, scope: key, stale: 600_000 });
  // a refused plan says why ({why}); a 404 = no plan
  let rp: any = null;
  if (pq.data) rp = pq.data;
  else if (pq.isError) {
    const m = String((pq.error as any)?.message || "");
    rp = /404/.test(m) ? null : { ok: false, cards: [], why: m.replace(/^Action [\w-]+ failed:\s*/, "") };
  }
  return { rd, rdAbsent, rdErr, rp, rpBusy: planOn && pq.isFetching };
}

export function usePilotData() {
  const st = useStudio();
  const cl = useRead<any>(st.app, "qa", "checklist", { every: 20000 });
  const ap = useRead<any>(st.app, "env", "autopilot", { every: (d) => (d && d.state === "running" ? 5000 : 20000) });
  const cps = useRead<any>(st.app, "env", "checkpoints", { every: 20000 });
  return {
    cl: cl.data || null,
    clErr: cl.isError ? String((cl.error as any)?.message || "").replace(/^Action [\w-]+ failed:\s*/, "") : null,
    clLoading: cl.isLoading,
    // the legacy row: a route that does not answer = not available yet (null); not read yet = undefined
    ap: ap.isError ? null : ap.data === undefined ? undefined : ap.data,
    cps: cps.isError ? null : cps.data === undefined ? undefined : cps.data,
  };
}

/** The studio view's flow (card-studio.js renderActions): the lead actions, the jobs in flight, the running count. */
export function useFlow() {
  const st = useStudio();
  const q = useRead<any>(st.app, "app", "", { every: (d) => (d && d.running ? 4000 : 10000) });
  const v = q.data;
  return v ? { next: (v.flow && v.flow.next) || [], running: Number(v.running) || 0, maxRunning: Number(v.maxRunning) || 3, jobs: (v.rec && v.rec.jobs) || [] } : null;
}
export function useActionsList() {
  const st = useStudio();
  return useRead<any>(st.app, "studio", "actions", { stale: 600_000 }).data?.actions || null;
}
export function useFrameInfo() {
  const st = useStudio();
  return useRead<any>(st.app, "app", "frame/_/info", { every: 30000 }).data || null;
}

// ---------- tiny shared stores (the gear's settings, the env confirms, the action message, a press in flight)
export function store<T>(init: T) {
  let v = init;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set(n: T | ((x: T) => T)) {
      v = typeof n === "function" ? (n as (x: T) => T)(v) : n;
      subs.forEach((f) => f());
    },
    sub(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}
export function useStore<T>(s: ReturnType<typeof store<T>>) {
  return useSyncExternalStore(s.sub, s.get, s.get);
}

/** The gear (card-studio.js S.set): the model and caps for the next actions, and "Answering runs the next step" (the questions read it). */
export const settings = store({ model: "auto", maxUsd: "", maxMin: "", advance: true });
/** The action settings, for any studio tool (the questions' "Answering runs the next step"). */
export const useActionSettings = () => useStore(settings);

/** The env row's confirms (Make Production Ready, Promote, Rollback) and its presses in flight; the Launch menu opens them too. */
export const envUi = store<{ confirm: null | "ready" | "promote" | "rollback"; open: boolean; starting: boolean; promoting: boolean; cancelArm: boolean; cancelling: boolean; rolling: boolean }>({
  confirm: null,
  open: false,
  starting: false,
  promoting: false,
  cancelArm: false,
  cancelling: false,
  rolling: false,
});
/** The action row's message (a lead action that failed, the staging builder being asked). */
export const actMsg = store<{ tone: string; text: string; busy?: boolean } | null>(null);
/** The autopilot's press in flight (the row and the Build menu share it). */
export const pilotBusy = store<string | null>(null);

/** Below 760 px the five menus fold into one (narrowNow), followed live. */
export function useNarrow() {
  const q = "(max-width: 759px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setN(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

/** Open a lifecycle tile's detail (the legacy L.tile(k)): its own button, pressed when it is not already open. */
export function openTile(app: string, k: string) {
  const b = document.querySelector<HTMLButtonElement>(`[data-testid=studio][data-app="${app}"] .st-tile[data-k="${k}"]`);
  if (b && b.getAttribute("aria-expanded") !== "true") b.click();
  if (b) setTimeout(() => document.getElementById("st-detail")?.scrollIntoView({ block: "nearest" }), 60);
}

// ---------- words (the legacy modules' own)
export const agoShort = (t: unknown) => {
  const s = Math.max(0, (Date.now() - Date.parse(String(t || ""))) / 1000);
  return !Number.isFinite(s) ? "?" : s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? (s / 3600).toFixed(1) + " h" : Math.round(s / 86400) + " d";
};
export const fmt = (v: unknown, unit?: string) =>
  v === null || v === undefined || v === ""
    ? "–"
    : (unit === "$" ? "$" : "") + (Math.abs(Number(v)) >= 1000 ? Math.round(Number(v)).toLocaleString() : Math.round(Number(v) * 100) / 100) + (unit && unit !== "$" ? (unit === "%" ? "%" : " " + unit) : "");
export const errOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
