/**
 * The Ask agent APPLIES a frontend change live (FA-19080; console 2026-10-15:
 * "The agent can modify the entire frontend cockpit, the user facing UI and
 * nothing part of the system abstracted by the client", then "basically do
 * what the library is meant to do").
 *
 * The edit itself is agent-native's own code agent (Agent-Native Code: the
 * run store and executor in @agent-native/core/code-agents, the claude-cli
 * engine, which drives the Mac's logged-in Claude Code as a "driver" with
 * Read/Glob/Grep/Edit/Write and acceptEdits, no Bash) - see code-agent.ts.
 * This file is the gate around it, so a change reaches the live region only
 * when every gate passes, and is reverted automatically otherwise:
 *
 *   worktree    a fresh git worktree of the fork on branch ask/<id>, cut from the live commit
 *   agent       the code agent edits that worktree only (its cwd is the worktree's templates/cockpit)
 *   scope       scope.ts: every changed path inside the frontend allowlist, every added line frontend-only
 *   typecheck   agent-native typecheck
 *   tests       vitest, including client-only.spec.ts (the page reaches the system only through the client)
 *   build       agent-native build
 *   screenshot  the built worktree served on a spare port, driven by Playwright at 1280 and 390:
 *               the region renders, no console errors, no sideways scroll, screenshots kept
 *   commit      one fork commit on ask/<id>
 *   live        the live checkout fast-forwards to it and rebuilds
 *   restart     the served region restarts on the new build (scripts/restart-region.mjs)
 *
 * A failure before live discards the worktree: nothing went live. A failure in
 * live reverts the commit and rebuilds. Undo (undoApply) is one action: it
 * reverts the applied commit, so the live tree is the previous live commit's,
 * rebuilds and restarts. The gate scripts run from the LIVE checkout, never the
 * agent's worktree, and the allowlist excludes them, so a change cannot weaken
 * the gate that judges it.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { addedLinesFromDiff, APP_REL, type ChangedFile, checkScope, parsePorcelainZ } from "./scope.js";

export const PHASES = ["worktree", "agent", "scope", "typecheck", "tests", "build", "screenshot", "commit", "live", "restart"] as const;
export type Phase = (typeof PHASES)[number];
export const UNDO_PHASES = ["revert", "build", "restart"] as const;
export type PhaseState = "pending" | "running" | "ok" | "failed" | "skipped";
export interface PhaseRec {
  name: string;
  state: PhaseState;
  ms?: number;
  detail?: string;
}
export type JobStatus = "running" | "live" | "failed" | "no-change" | "needs-system" | "undone";
export interface ApplyJob {
  id: string;
  kind: "apply" | "undo";
  /** for an undo: the apply job it undoes */
  of?: string;
  question: string;
  title: string;
  /** a board card the request belongs to, when one is known (named in the commit) */
  fa?: string;
  status: JobStatus;
  phases: PhaseRec[];
  /** the code agent's own words: what it changed, or why it could not */
  summary?: string;
  error?: string;
  refusals?: string[];
  base?: string;
  commit?: string;
  files?: string[];
  shots?: string[];
  /** for needs-system: the card it was filed as */
  filed?: { fa: string; title: string };
  /** for an applied job: the undo job that reverted it */
  undoneBy?: string;
  pid: number;
  startedAt: string;
  endedAt?: string;
}

const MIN = 60_000;
export const LIMITS = { agentMs: 20 * MIN, typecheckMs: 5 * MIN, testsMs: 5 * MIN, buildMs: 10 * MIN, gateMs: 4 * MIN, gitMs: 2 * MIN };

// ---------- where things are ----------
export interface ApplyPaths {
  /** this app (templates/cockpit of the live checkout) */
  appDir: string;
  /** the fork's root */
  repoRoot: string;
  /** where ask worktrees are made (outside the fork, so its status stays clean) */
  wtRoot: string;
  /** job records */
  jobsDir: string;
  node: string;
  gatePort: number;
}
export function applyPaths(dataDir: string): ApplyPaths {
  const appDir = path.resolve(process.env.COCKPIT_APP_DIR || process.cwd());
  const repoRoot = path.resolve(appDir, "..", "..");
  return {
    appDir,
    repoRoot,
    wtRoot: path.resolve(process.env.COCKPIT_ASK_WT_DIR || path.join(repoRoot, "..", "agent-native-ask")),
    jobsDir: path.join(dataDir, "apply"),
    node: process.execPath,
    gatePort: Number(process.env.COCKPIT_GATE_PORT) || 5243,
  };
}

// ---------- the subprocess primitive ----------
export interface ExecResult {
  code: number | null;
  out: string;
  err: string;
  timedOut?: boolean;
}
export type Exec = (cmd: string, args: string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<ExecResult>;

/** The environment this server started with (server/plugins/00-local-database.ts keeps it before adding its own). */
export function bootEnv(): NodeJS.ProcessEnv {
  const g = globalThis as { __cockpitBootEnv?: NodeJS.ProcessEnv };
  const env = { ...(g.__cockpitBootEnv ?? process.env) };
  if (!g.__cockpitBootEnv) {
    // no snapshot (a test): never hand a child the values this server sets for itself
    delete env.BETTER_AUTH_SECRET;
    if (/^pglite:/.test(env.DATABASE_URL || "")) delete env.DATABASE_URL;
  }
  return env;
}

/** The boot environment, Node 22 first on PATH (the gates and the CLI they start), then the Mac's Claude CLI. */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...bootEnv(), ...extra };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  env.PATH = [path.dirname(process.execPath), path.join(os.homedir(), ".local", "bin"), env.PATH || ""].join(":");
  return env;
}

const tail = (s: string, n = 4000) => (s.length > n ? "…" + s.slice(-n) : s);

export const exec: Exec = (cmd, args, o) =>
  new Promise((resolve) => {
    let out = "";
    let err = "";
    let timedOut = false;
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env ?? childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, o.timeoutMs ?? LIMITS.gitMs);
    child.stdout.on("data", (d) => {
      out = tail(out + d, 200_000);
    });
    child.stderr.on("data", (d) => {
      err = tail(err + d, 200_000);
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: null, out, err: err + String(e), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, out, err, timedOut });
    });
  });

// ---------- what the job needs from outside (injectable for tests) ----------
export interface CodeAgentOutcome {
  ok: boolean;
  message: string;
  runId?: string;
}
export interface ApplyDeps {
  exec: Exec;
  /** runs agent-native's code agent in `cwd`; code-agent.ts */
  runCodeAgent: (o: { cwd: string; prompt: string; title: string }) => Promise<CodeAgentOutcome>;
  /** a sample of every client resource's fields, for the agent to bind to; code-agent.ts */
  resourceContext: () => Promise<unknown>;
  /** files a board card for a request the frontend cannot do */
  fileSystemCard: (why: string) => Promise<{ fa: string; title: string } | null>;
  /** serves a build on a port and drives it with Playwright; returns the verdict */
  screenshotGate: (o: { appDir: string; outDir: string }) => Promise<{ ok: boolean; detail: string; shots: string[] }>;
  /** restarts the served region on the live build (after this job is recorded) */
  restart: (o: { jobId: string }) => Promise<void>;
}

// ---------- job records ----------
const jobFile = (P: ApplyPaths, id: string) => path.join(P.jobsDir, id + ".json");
/** A job record's own file name: not the restarter's .restart.json or the vitest report beside it. */
export const JOB_FILE = /^(ask|undo)-\d{14}-[0-9a-f]{6}\.json$/;
export function saveJob(P: ApplyPaths, j: ApplyJob): void {
  mkdirSync(P.jobsDir, { recursive: true });
  const f = jobFile(P, j.id);
  writeFileSync(f + ".tmp", JSON.stringify(j, null, 1));
  renameSync(f + ".tmp", f);
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** A job, or the newest one; a "running" job whose server died mid-way reads as failed. */
export function readJob(P: ApplyPaths, id?: string): ApplyJob | null {
  try {
    let f: string;
    if (id) {
      if (!/^[a-z0-9-]{6,64}$/.test(id)) return null;
      f = jobFile(P, id);
    } else {
      const all = readdirSync(P.jobsDir).filter((x) => JOB_FILE.test(x));
      if (!all.length) return null;
      f = path.join(P.jobsDir, all.map((x) => ({ x, t: statSync(path.join(P.jobsDir, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0].x);
    }
    const j = JSON.parse(readFileSync(f, "utf8")) as ApplyJob;
    if (j.status === "running" && j.pid !== process.pid && !alive(j.pid)) {
      j.status = "failed";
      j.error = j.error || "the region server stopped while this job ran; nothing past the last finished step was applied";
    }
    // the restarter records its outcome beside the job
    const rf = jobFile(P, j.id).replace(/\.json$/, ".restart.json");
    if (existsSync(rf)) {
      try {
        const r = JSON.parse(readFileSync(rf, "utf8"));
        const ph = j.phases.find((p) => p.name === "restart");
        if (ph && ph.state === "running") Object.assign(ph, { state: r.ok ? "ok" : "failed", detail: r.detail || (r.ok ? `pid ${r.pid}` : "the region did not come back") });
      } catch {
        // half-written; read next time
      }
    }
    return j;
  } catch {
    return null;
  }
}

let busy: string | null = null;
export const applyBusy = () => busy;

export function newJob(kind: ApplyJob["kind"], question: string, title: string, fa?: string, of?: string): ApplyJob {
  const id = `${kind === "undo" ? "undo" : "ask"}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  const names: readonly string[] = kind === "undo" ? UNDO_PHASES : PHASES;
  return { id, kind, of, question, title, fa, status: "running", phases: names.map((name) => ({ name, state: "pending" })), pid: process.pid, startedAt: new Date().toISOString() };
}

class GateError extends Error {
  constructor(
    message: string,
    readonly refusals?: string[],
  ) {
    super(message);
  }
}

/** The step runner: marks the phase, times it, saves the record before and after. */
function stepper(P: ApplyPaths, j: ApplyJob) {
  return async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const ph = j.phases.find((p) => p.name === name)!;
    ph.state = "running";
    saveJob(P, j);
    const t = Date.now();
    try {
      const r = await fn();
      ph.state = "ok";
      ph.ms = Date.now() - t;
      return r;
    } catch (e) {
      ph.state = "failed";
      ph.ms = Date.now() - t;
      ph.detail = (e instanceof Error ? e.message : String(e)).slice(0, 600);
      throw e;
    } finally {
      saveJob(P, j);
    }
  };
}

const must = (r: ExecResult, what: string) => {
  if (r.code !== 0) throw new GateError(`${what} failed${r.timedOut ? " (timed out)" : ""}: ${tail((r.err || "") + "\n" + (r.out || ""), 1200).trim()}`);
  return r.out;
};

/** The worktree gets the live checkout's installed dependencies (symlinks; node_modules is gitignored). Only after the agent ran. */
export function linkDeps(P: ApplyPaths, wt: string): void {
  const pairs: [string, string][] = [
    [path.join(P.repoRoot, "node_modules"), path.join(wt, "node_modules")],
    [path.join(P.appDir, "node_modules"), path.join(wt, APP_REL, "node_modules")],
  ];
  const pk = path.join(P.repoRoot, "packages");
  for (const name of existsSync(pk) ? readdirSync(pk) : []) {
    const src = path.join(pk, name, "node_modules");
    if (existsSync(src) && existsSync(path.join(wt, "packages", name))) pairs.push([src, path.join(wt, "packages", name, "node_modules")]);
  }
  for (const [src, dst] of pairs) if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst);
}

/** The prompt the code agent gets: the request, the attachments, the scope it is held to. */
export function buildAgentPrompt(question: string, imageNames: string[]): string {
  return [
    "You are changing the FRONTEND of the cockpit: the React app under app/ in this checkout (templates/cockpit of the agent-native fork). It serves the card region at /cards/ (app/components/cockpit/CardRegion.tsx) and the whole front-facing cockpit at /cards/cockpit (Cockpit.tsx: TopBar.tsx, Home.tsx with OfficeCard.tsx and the key-number tiles, and the card region). Find the component the request names and change that one. The console asked, verbatim:",
    "",
    `"${question}"`,
    "",
    ...(imageNames.length ? [`Attached images (open each with the Read tool before you start; they show what the console wants): ${imageNames.join(", ")}`, ""] : []),
    "WRITE SCOPE, enforced in code after you finish; one file outside it discards your whole change:",
    "- create or edit files only under app/, public/ and shared/presentation/;",
    "- never server/, actions/, the rest of shared/, package.json, any config, app/entry.server.tsx, or anything outside this directory.",
    "FRONTEND ONLY, also enforced on every line you add:",
    '- system data reaches the page only through this app\'s existing actions, called with the hooks from "@agent-native/core/client/hooks": useActionQuery("cockpit-read", { resource: "office" }) reads any resource named in shared/cockpit-manifest.json (the answer is { resource, at, ok, data }), useActionQuery("get-cards", {}) reads the 14 cards;',
    "- no fetch, XHR, WebSocket or EventSource, no absolute URL, no API path or port, no route loader or action, no node builtin, no process.env, no eval.",
    "- .ask-context/resources.json lists every field each resource answers right now, as a path inside cockpit-read's data with a sample value. Bind only to fields listed there. A value the request needs that exists nowhere is shown as \"no data\" and said so in your answer; never invent a number.",
    "- If the request cannot be done in the frontend at all (it needs a new data field or action, or any system behaviour), change nothing and make the first line of your final answer: NEEDS_SYSTEM: <one sentence naming what is missing>.",
    "HOW: read the component you change, its stylesheet (app/global.css for the region, app/cockpit-full.css for the cockpit page) and DESIGN.md first, and match the neon theme. Keep every existing card and behaviour working. It must look excellent at 1280 px and at 390 px wide (no sideways scroll), with accessible labels. TypeScript must stay clean: typecheck, the unit tests, a build and a Playwright check run after you, and any failure discards the change. Do not run git.",
    "FINAL ANSWER: one or two plain sentences saying what you changed and which live fields it shows; the console reads it as the reply.",
  ].join("\n");
}

export interface ApplyInput {
  question: string;
  title: string;
  fa?: string;
  images: { bytes: Buffer; ext: string; type: import("../../../shared/ask-images.js").AskImageType }[];
}

/** Starts an apply job in the background; returns its record at once. One job at a time. */
export function startApply(P: ApplyPaths, input: ApplyInput, deps: ApplyDeps): ApplyJob {
  if (busy) throw new Error(`An applied change is already in progress (${busy}); try again when it finishes.`);
  const j = newJob("apply", input.question, input.title, input.fa);
  busy = j.id;
  saveJob(P, j);
  void runApply(P, j, input, deps).finally(() => {
    busy = null;
  });
  return j;
}

export async function runApply(P: ApplyPaths, j: ApplyJob, input: ApplyInput, deps: ApplyDeps): Promise<ApplyJob> {
  const step = stepper(P, j);
  const git = (args: string[], cwd = P.repoRoot, timeoutMs = LIMITS.gitMs) => deps.exec("git", args, { cwd, timeoutMs });
  const wt = path.join(P.wtRoot, j.id);
  const wtApp = path.join(wt, APP_REL);
  const branch = "ask/" + j.id;
  let merged = false;
  try {
    // 1. a clean worktree at the live commit
    await step("worktree", async () => {
      j.base = must(await git(["rev-parse", "HEAD"]), "git rev-parse").trim();
      const dirty = must(await git(["status", "--porcelain=v1", "--untracked-files=no", "--", APP_REL]), "git status").trim();
      if (dirty) throw new GateError("the live checkout has uncommitted changes in " + APP_REL + ", so a change could not go live cleanly: " + dirty.split("\n").slice(0, 5).join("; "));
      mkdirSync(P.wtRoot, { recursive: true });
      // one job runs at a time, so any other ask worktree is left from a server that stopped mid-job: reap it
      for (const old of readdirSync(P.wtRoot)) {
        if (old === j.id || !/^ask-/.test(old)) continue;
        await git(["worktree", "remove", "--force", path.join(P.wtRoot, old)]);
        rmSync(path.join(P.wtRoot, old), { recursive: true, force: true });
        await git(["branch", "-D", "ask/" + old]);
      }
      await git(["worktree", "prune"]);
      must(await git(["worktree", "add", "-b", branch, wt, j.base]), "git worktree add");
      const ctx = path.join(wtApp, ".ask-context");
      mkdirSync(ctx, { recursive: true });
      writeFileSync(path.join(ctx, "resources.json"), JSON.stringify(await deps.resourceContext(), null, 1));
      input.images.forEach((im, i) => writeFileSync(path.join(ctx, `image-${i + 1}.${im.ext}`), im.bytes));
    });
    // 2. the code agent, confined to the worktree's app
    const liveBefore = must(await git(["status", "--porcelain=v1", "-z", "-uall"]), "git status");
    const outcome = await step("agent", async () => {
      const names = input.images.map((im, i) => `.ask-context/image-${i + 1}.${im.ext}`);
      const o = await deps.runCodeAgent({ cwd: wtApp, prompt: buildAgentPrompt(input.question, names), title: input.title });
      j.summary = o.message.trim().slice(0, 1500);
      if (!o.ok) throw new GateError("the code agent did not finish: " + (o.message || "no answer").slice(0, 400));
      return o;
    });
    const liveAfter = must(await git(["status", "--porcelain=v1", "-z", "-uall"]), "git status");
    if (liveAfter !== liveBefore) throw new GateError("the live checkout changed while the agent ran; the change is discarded");
    rmSync(path.join(wtApp, ".ask-context"), { recursive: true, force: true });
    // the agent said the frontend cannot do it: a card, never a half change
    const need = /^\s*NEEDS_SYSTEM:\s*(.+)/m.exec(outcome.message);
    // 3. scope: the enforcement point
    const changes = await step("scope", async () => {
      const files = parsePorcelainZ(must(await git(["status", "--porcelain=v1", "-z", "-uall"], wt), "git status"));
      const diff = must(await git(["diff", "-U0", "--no-color", "--no-ext-diff"], wt, LIMITS.gitMs), "git diff");
      const added = addedLinesFromDiff(diff);
      const out: ChangedFile[] = files.map((f) => {
        let lines = added.get(f.path) ?? [];
        if (f.status === "??") {
          try {
            const buf = readFileSync(path.join(wt, f.path));
            lines = buf.includes(0) ? [] : buf.toString("utf8").split("\n");
          } catch {
            lines = [];
          }
        }
        return { path: f.path, status: f.status, added: lines };
      });
      if (need || !out.length) return out;
      const v = checkScope(out);
      if (!v.ok) throw new GateError(`the change reaches outside the frontend (${v.refusals.length} refusal${v.refusals.length === 1 ? "" : "s"})`, v.refusals);
      return out;
    });
    if (need || !changes.length) {
      j.status = need ? "needs-system" : "no-change";
      for (const p of j.phases) if (p.state === "pending") p.state = "skipped";
      if (need) {
        if (changes.length) j.summary = "NEEDS_SYSTEM: " + need[1] + " (the agent's partial edits were discarded)";
        j.filed = (await deps.fileSystemCard(need[1].trim())) ?? undefined;
      }
      return j;
    }
    j.files = changes.map((c) => c.path);
    // 4. the gates, on the worktree, with the live checkout's installed dependencies
    linkDeps(P, wt);
    const cli = path.join(wtApp, "node_modules", "@agent-native", "core", "bin", "agent-native.js");
    const env = childEnv({ APP_BASE_PATH: "/cards" });
    await step("typecheck", async () => must(await deps.exec(P.node, [cli, "typecheck"], { cwd: wtApp, env, timeoutMs: LIMITS.typecheckMs }), "typecheck"));
    await step("tests", async () => {
      const report = path.join(P.jobsDir, j.id + "-vitest.json");
      const r = await deps.exec(P.node, [path.join(wtApp, "node_modules", "vitest", "vitest.mjs"), "--run", "--passWithNoTests", "--reporter=json", "--outputFile=" + report], { cwd: wtApp, env, timeoutMs: LIMITS.testsMs });
      must(r, "vitest");
      return requireClientOnly(report);
    });
    await step("build", async () => must(await deps.exec(P.node, [cli, "build"], { cwd: wtApp, env, timeoutMs: LIMITS.buildMs }), "build"));
    await step("screenshot", async () => {
      const g = await deps.screenshotGate({ appDir: wtApp, outDir: path.join(P.jobsDir, j.id + "-shots") });
      j.shots = g.shots;
      if (!g.ok) throw new GateError("the Playwright check failed: " + g.detail);
      return g;
    });
    // 5. one commit, then live
    await step("commit", async () => {
      must(await git(["add", "-A", "--", ...j.files!], wt), "git add");
      const msg = commitMessage(j);
      must(await git(["commit", "-q", "-m", msg], wt), "git commit");
      j.commit = must(await git(["rev-parse", "HEAD"], wt), "git rev-parse").trim();
    });
    await step("live", async () => {
      const head = must(await git(["rev-parse", "HEAD"]), "git rev-parse").trim();
      if (head !== j.base) throw new GateError(`the live checkout moved from ${j.base!.slice(0, 10)} to ${head.slice(0, 10)} while the job ran; nothing was applied`);
      must(await git(["merge", "--ff-only", "-q", branch]), "git merge --ff-only");
      merged = true;
      must(await deps.exec(P.node, [path.join(P.appDir, "node_modules", "@agent-native", "core", "bin", "agent-native.js"), "build"], { cwd: P.appDir, env, timeoutMs: LIMITS.buildMs }), "live build");
    });
    j.status = "live";
    await restartPhase(P, j, deps);
    return j;
  } catch (e) {
    j.status = "failed";
    j.error = (e instanceof Error ? e.message : String(e)).slice(0, 1500);
    if (e instanceof GateError && e.refusals) j.refusals = e.refusals.slice(0, 40);
    for (const p of j.phases) if (p.state === "pending") p.state = "skipped";
    if (merged && j.commit) {
      // it reached the live checkout but did not build: revert it, so the live tree is the one that was serving
      const r = await git(["revert", "--no-edit", j.commit]);
      j.error += r.code === 0 ? " - the applied commit was reverted" : " - REVERT FAILED, the live checkout holds " + j.commit.slice(0, 10) + ": " + tail(r.err, 300);
      await deps.exec(P.node, [path.join(P.appDir, "node_modules", "@agent-native", "core", "bin", "agent-native.js"), "build"], { cwd: P.appDir, env: childEnv({ APP_BASE_PATH: "/cards" }), timeoutMs: LIMITS.buildMs });
    }
    return j;
  } finally {
    j.endedAt = new Date().toISOString();
    saveJob(P, j);
    // the worktree is never kept: on success the commit is on the live branch, on failure it is discarded
    await git(["worktree", "remove", "--force", wt]).catch(() => null);
    if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
    await git(["worktree", "prune"]).catch(() => null);
    await git(["branch", "-D", branch]).catch(() => null);
  }
}

/** vitest passed AND the client-only guard was among the files it ran and passed. */
export function requireClientOnly(reportPath: string): string {
  let rep: { numFailedTests?: number; numPassedTests?: number; testResults?: { name: string; status: string }[] };
  try {
    rep = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw new GateError("vitest wrote no report");
  }
  const co = (rep.testResults || []).find((t) => /server\/cockpit\/client-only\.spec\.ts$/.test(t.name));
  if (!co) throw new GateError("vitest did not run client-only.spec.ts");
  if (co.status !== "passed") throw new GateError("client-only.spec.ts failed: the page must reach the system only through the client");
  if (rep.numFailedTests) throw new GateError(rep.numFailedTests + " test(s) failed");
  return `${rep.numPassedTests ?? 0} tests passed, client-only.spec.ts included`;
}

export function commitMessage(j: ApplyJob): string {
  const head = `${j.fa ? j.fa + ": " : ""}Ask agent applied: ${j.title || j.question}`.replace(/\s+/g, " ").slice(0, 100);
  return [
    head,
    "",
    `Request (console, Ask agent panel, verbatim): "${j.question.replace(/\s+/g, " ").slice(0, 1500)}"`,
    j.summary ? `Agent: ${j.summary.replace(/\s+/g, " ").slice(0, 800)}` : "",
    `Ask job ${j.id}. Gates passed: scope, typecheck, vitest (client-only.spec), build, Playwright 1280+390.`,
    "",
    "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
  ]
    .filter((x, i, a) => x || a[i - 1])
    .join("\n");
}

/** Reverts an applied job's commit (the live tree returns to the previous live commit's), rebuilds and restarts. */
export function startUndo(P: ApplyPaths, ofId: string | undefined, deps: Pick<ApplyDeps, "exec" | "restart">): ApplyJob {
  if (busy) throw new Error(`An applied change is already in progress (${busy}); try again when it finishes.`);
  const target = ofId ? readJob(P, ofId) : latestLive(P);
  if (!target || target.kind !== "apply" || target.status !== "live" || !target.commit) throw new Error(ofId ? `${ofId} is not a live applied change` : "there is no live applied change to undo");
  const j = newJob("undo", target.question, "Undo: " + target.title, target.fa, target.id);
  busy = j.id;
  saveJob(P, j);
  void runUndo(P, j, target, deps).finally(() => {
    busy = null;
  });
  return j;
}

function latestLive(P: ApplyPaths): ApplyJob | null {
  try {
    const all = readdirSync(P.jobsDir)
      .filter((x) => JOB_FILE.test(x) && x.startsWith("ask-"))
      .sort()
      .reverse();
    for (const f of all) {
      const j = readJob(P, f.replace(/\.json$/, ""));
      if (j && j.status === "live") return j;
    }
  } catch {
    // no jobs yet
  }
  return null;
}

export async function runUndo(P: ApplyPaths, j: ApplyJob, target: ApplyJob, deps: Pick<ApplyDeps, "exec" | "restart">): Promise<ApplyJob> {
  const step = stepper(P, j);
  const git = (args: string[]) => deps.exec("git", args, { cwd: P.repoRoot, timeoutMs: LIMITS.gitMs });
  const cli = path.join(P.appDir, "node_modules", "@agent-native", "core", "bin", "agent-native.js");
  const env = childEnv({ APP_BASE_PATH: "/cards" });
  let reverted = false;
  try {
    await step("revert", async () => {
      const anc = await git(["merge-base", "--is-ancestor", target.commit!, "HEAD"]);
      if (anc.code !== 0) throw new GateError(`${target.commit!.slice(0, 10)} is not in the live checkout any more`);
      const dirty = must(await git(["status", "--porcelain=v1", "--untracked-files=no", "--", APP_REL]), "git status").trim();
      if (dirty) throw new GateError("the live checkout has uncommitted changes in " + APP_REL + ": " + dirty.split("\n").slice(0, 5).join("; "));
      must(await git(["revert", "--no-edit", target.commit!]), "git revert");
      reverted = true;
      const msg = `${target.fa ? target.fa + ": " : ""}Undo Ask agent change ${target.id}: ${target.title}`.slice(0, 100) + `\n\nReverts ${target.commit} (one-click Undo in the Ask agent panel).\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
      must(await git(["commit", "--amend", "-q", "-m", msg]), "git commit --amend");
      j.commit = must(await git(["rev-parse", "HEAD"]), "git rev-parse").trim();
    });
    await step("build", async () => must(await deps.exec(P.node, [cli, "build"], { cwd: P.appDir, env, timeoutMs: LIMITS.buildMs }), "live build"));
    j.status = "live";
    target.status = "undone";
    target.undoneBy = j.id;
    saveJob(P, target);
    await restartPhase(P, j, deps);
    return j;
  } catch (e) {
    j.status = "failed";
    j.error = (e instanceof Error ? e.message : String(e)).slice(0, 1500);
    for (const p of j.phases) if (p.state === "pending") p.state = "skipped";
    if (reverted && j.phases.find((p) => p.name === "build")?.state === "failed") {
      await git(["revert", "--no-edit", "HEAD"]);
      await deps.exec(P.node, [cli, "build"], { cwd: P.appDir, env, timeoutMs: LIMITS.buildMs });
      j.error += " - the undo was reverted; the applied change stays live";
    }
    return j;
  } finally {
    j.endedAt = new Date().toISOString();
    saveJob(P, j);
  }
}

/**
 * The served region restarts on the new build. The restarter replaces THIS server, so it runs detached and records its
 * outcome beside the job (readJob folds it in); the phase stays "running" until then.
 */
async function restartPhase(P: ApplyPaths, j: ApplyJob, deps: Pick<ApplyDeps, "restart">): Promise<void> {
  const ph = j.phases.find((p) => p.name === "restart")!;
  ph.state = "running";
  saveJob(P, j);
  try {
    await deps.restart({ jobId: j.id });
  } catch (e) {
    ph.state = "failed";
    ph.detail = "the region could not be restarted on the new build (it is built; the next start serves it): " + (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
}

/** Waits for a URL to answer 200, up to ms. */
export function waitHttp(url: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        again();
      });
      req.on("error", again);
      req.on("timeout", () => req.destroy());
    };
    const again = () => (Date.now() > end ? resolve(false) : setTimeout(tryOnce, 500));
    tryOnce();
  });
}
