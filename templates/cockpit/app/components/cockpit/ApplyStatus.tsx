import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

/**
 * FA-19080: an Ask agent change being APPLIED. The panel follows the job
 * (get-ask-job) through its gates, reloads the region once it restarted on the
 * new build, and offers the one-click Undo (undo-ask-change). The banner shows
 * the newest applied change after that reload.
 */

type PhaseState = "pending" | "running" | "ok" | "failed" | "skipped";
interface Phase {
  name: string;
  state: PhaseState;
  ms?: number;
  detail?: string;
}
export interface AskJob {
  id: string;
  kind: "apply" | "undo";
  of?: string;
  question: string;
  title: string;
  fa?: string;
  status: "running" | "live" | "failed" | "no-change" | "needs-system" | "undone";
  phases: Phase[];
  summary?: string;
  error?: string;
  refusals?: string[];
  commit?: string;
  files?: string[];
  filed?: { fa: string; title: string };
  undoneBy?: string;
  startedAt: string;
  endedAt?: string;
}
interface JobRead {
  job: AskJob | null;
  busy: string | null;
  serverPid: number;
}

const LABEL: Record<string, string> = {
  worktree: "Copy",
  agent: "Code agent",
  scope: "Scope",
  typecheck: "Typecheck",
  tests: "Tests",
  build: "Build",
  screenshot: "Playwright",
  commit: "Commit",
  live: "Live",
  restart: "Restart",
  revert: "Revert",
};
const MARK: Record<PhaseState, string> = { pending: "·", running: "◌", ok: "✓", failed: "✕", skipped: "–" };
const secs = (ms?: number) => (ms == null ? "" : ms < 1000 ? "<1 s" : ms < 60_000 ? Math.round(ms / 1000) + " s" : Math.floor(ms / 60_000) + " m " + Math.round((ms % 60_000) / 1000) + " s");

/** The job is done and the region restarted on the new build: time to load it. */
const restarted = (j: AskJob) => j.status === "live" && j.phases.some((p) => p.name === "restart" && (p.state === "ok" || p.state === "failed"));

function Phases({ job }: { job: AskJob }) {
  return (
    <ol className="cp-apply-phases" aria-label="Gates">
      {job.phases.map((p) => (
        <li key={p.name} className={"s-" + p.state} title={p.detail || (p.ms != null ? secs(p.ms) : p.state)}>
          <i aria-hidden="true">{MARK[p.state]}</i>
          <span>{LABEL[p.name] || p.name}</span>
          <span className="sr-only">{" " + p.state}</span>
        </li>
      ))}
    </ol>
  );
}

export function UndoButton({ job, onStarted }: { job: AskJob; onStarted: (id: string) => void }) {
  const undo = useActionMutation<{ job: { id: string } }, { id?: string }>("undo-ask-change", {
    onSuccess: (r) => onStarted(r.job.id),
  });
  return (
    <>
      <button type="button" className="cp-btn cp-undo" disabled={undo.isPending} onClick={() => undo.mutate({ id: job.id })} aria-label={`Undo: ${job.title}`}>
        {undo.isPending ? "Undoing…" : "↶ Undo"}
      </button>
      {undo.isError ? (
        <span className="cp-apply-err" role="alert">
          {undo.error instanceof Error ? undo.error.message : String(undo.error)}
        </span>
      ) : null}
    </>
  );
}

/** Follows one job until it ends; reloads the region once a live change restarted it. */
export function ApplyProgress({ id, onFollow }: { id: string; onFollow: (id: string) => void }) {
  const [done, setDone] = useState(false);
  const q = useActionQuery<JobRead>("get-ask-job", { id }, { refetchInterval: done ? false : 1500, retry: true });
  const job = q.data?.job ?? null;
  const reloaded = useRef(false);
  useEffect(() => {
    if (!job) return;
    if (job.status !== "running" && !(job.status === "live" && !restarted(job))) setDone(true);
    if (restarted(job) && !reloaded.current) {
      reloaded.current = true;
      // the new build is serving: load it (the banner below picks the job up again after the reload)
      window.setTimeout(() => window.location.reload(), 1200);
    }
  }, [job]);
  if (!job) return <div className="cp-ask-out busy">Starting the change…</div>;
  const undo = job.kind === "undo";
  const head =
    job.status === "running"
      ? undo
        ? "Undoing the change…"
        : job.phases.find((p) => p.state === "running")?.name === "agent"
          ? "The code agent is editing a copy of the region…"
          : "Checking the change…"
      : job.status === "live"
        ? restarted(job)
          ? "Live. Loading the new region…"
          : "Built; restarting the region on it…"
        : job.status === "failed"
          ? "Not applied; nothing changed."
          : job.status === "needs-system"
            ? "This needs the system side, so it was filed, not applied."
            : job.status === "no-change"
              ? "The code agent changed nothing."
              : "Undone.";
  return (
    <div className={"cp-apply st-" + job.status} data-testid="apply-progress" data-status={job.status} aria-live="polite">
      <div className="cp-apply-head">
        <b>{head}</b>
        {job.commit ? <code title={job.commit}>{job.commit.slice(0, 10)}</code> : null}
      </div>
      <Phases job={job} />
      {job.summary ? <div className="cp-ask-out">{job.summary}</div> : null}
      {job.filed ? <div className="cp-ask-out filed">Filed {job.filed.fa}: {job.filed.title}</div> : null}
      {job.error ? (
        <div className="cp-ask-out err" role="alert">
          {job.error}
          {job.refusals?.length ? "\n" + job.refusals.slice(0, 6).join("\n") : ""}
        </div>
      ) : null}
      {job.status === "live" && !undo ? <UndoButton job={job} onStarted={onFollow} /> : null}
    </div>
  );
}

const DISMISS_KEY = "cockpit.apply.dismissed";

/** After the reload: what the newest applied change was, with Undo while it is live. */
export function AppliedBanner() {
  const [follow, setFollow] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const q = useActionQuery<JobRead>("get-ask-job", {}, { refetchInterval: 60_000 });
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY));
    } catch {
      // per-viewer convenience only
    }
  }, []);
  const job = q.data?.job;
  if (follow) return <ApplyProgress id={follow} onFollow={setFollow} />;
  if (!job || job.status === "running" || dismissed === job.id) return null;
  const age = Date.now() - Date.parse(job.endedAt || job.startedAt);
  if (!(age < 30 * 60_000)) return null;
  if (job.kind === "apply" && job.status !== "live") return null;
  const dismiss = () => {
    setDismissed(job.id);
    try {
      window.localStorage.setItem(DISMISS_KEY, job.id);
    } catch {
      // per-viewer convenience only
    }
  };
  return (
    <div className="cp-applied" role="status" data-testid="applied-banner" data-job={job.id} data-kind={job.kind}>
      <span className="cp-ask-path k-apply">{job.kind === "undo" ? (job.status === "live" ? "Undone" : "Undo failed") : "Applied"}</span>
      <span className="cp-applied-t">
        {job.kind === "undo" ? job.title : job.summary || job.title}
        {job.commit ? <code title={job.commit}> {job.commit.slice(0, 10)}</code> : null}
      </span>
      {job.kind === "apply" && job.status === "live" ? <UndoButton job={job} onStarted={setFollow} /> : null}
      <button type="button" className="cp-btn cp-x" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
