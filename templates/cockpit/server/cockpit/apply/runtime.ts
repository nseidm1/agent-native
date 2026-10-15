/**
 * The real dependencies of an apply job (job.ts takes them injected, so its
 * gate order and auto-revert are testable without a model or a build).
 *
 * runCodeAgent is agent-native's OWN code agent, unchanged: Agent-Native Code's
 * run store and executor from @agent-native/core/code-agents
 * (createCodeAgentRunRecord + executeCodeAgentRun, upstream
 * packages/core/src/cli/code-agent-runs.ts and code-agent-executor.ts). With
 * engine "claude-cli" and permission mode "auto-edit" it runs the Mac's
 * logged-in Claude Code through runClaudeCodeParticipant
 * (packages/core/src/cli/claude-code-participant.ts) as a "driver":
 * --tools Read,Glob,Grep,Edit,Write, --permission-mode acceptEdits, no Bash,
 * --strict-mcp-config with no MCP server (no AGENT_USER_EMAIL, no MCP_SERVERS:
 * the run has no path to the system at all), --setting-sources "", in the
 * worktree's templates/cockpit as its only checkout. Its run records and
 * transcripts live under data/cockpit-agent/code-agents.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { dataDir } from "../agent.js";
import { get, manifest } from "../client.js";
import { type ApplyDeps, type ApplyPaths, bootEnv, childEnv, exec, waitHttp } from "./job.js";

export const applyModel = () => process.env.COCKPIT_APPLY_MODEL || "claude-opus-5-5";

async function runCodeAgent(o: { cwd: string; prompt: string; title: string }): Promise<{ ok: boolean; message: string; runId?: string }> {
  // the upstream store and the CLI the executor starts: this app's data dir, Node 22 and ~/.local/bin on PATH
  process.env.AGENT_NATIVE_CODE_AGENTS_HOME = path.join(dataDir(), "code-agents");
  process.env.PATH = childEnv().PATH; // guard:allow-env-mutation — the upstream executor reads PATH and the store root from process.env
  const CA = await import("@agent-native/core/code-agents");
  const run = CA.createCodeAgentRunRecord({
    goalId: "cockpit-ask",
    title: o.title.slice(0, 120) || "Ask agent change",
    cwd: o.cwd,
    permissionMode: "auto-edit",
    metadata: { engine: "claude-cli", model: applyModel(), source: "cockpit-ask" },
  });
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20 * 60_000);
  try {
    const rec = await CA.executeCodeAgentRun({ runId: run.id, prompt: o.prompt, signal: ac.signal, streamToolOutputToStdout: false });
    const events = CA.listCodeAgentTranscriptEvents(run.id);
    const said = [...events].reverse().find((e) => e.kind === "system" && (e.metadata as Record<string, unknown> | undefined)?.role === "assistant");
    const ok = !!rec && rec.status === "completed";
    const last = [...events].reverse().find((e) => e.kind === "status");
    return { ok, message: said?.message || last?.message || (rec ? rec.status : "the run record vanished"), runId: run.id };
  } finally {
    clearTimeout(t);
  }
}

type Leaf = [string, unknown];
/** Every field path of a value with a short sample, arrays as .length and their first item's fields. Bounded. */
export function flatten(v: unknown, at = "", out: Leaf[] = [], depth = 0): Leaf[] {
  if (out.length >= 400) return out;
  if (Array.isArray(v)) {
    out.push([at + ".length", v.length]);
    if (v.length && depth < 7) flatten(v[0], at + "[0]", out, depth + 1);
    return out;
  }
  if (v && typeof v === "object") {
    if (depth >= 7) return out;
    for (const [k, x] of Object.entries(v)) flatten(x, at ? at + "." + k : k, out, depth + 1);
    return out;
  }
  out.push([at, typeof v === "string" ? v.slice(0, 60) : v]);
  return out;
}

async function resourceContext() {
  const m = await manifest();
  const res: Record<string, { description: string; fields: Record<string, unknown> }> = {};
  for (const r of m.resources) {
    if (r.name.includes("{")) continue;
    try {
      const d = await get(r.name);
      res[r.name] = { description: r.description, fields: Object.fromEntries(flatten(d.data)) };
    } catch (e) {
      res[r.name] = { description: r.description, fields: { error: String(e instanceof Error ? e.message : e).slice(0, 200) } };
    }
  }
  return {
    how: 'useActionQuery("cockpit-read", { resource }) answers { resource, at, ok, data }; each path below is inside that data. ".length" is an array\'s length; "[0]" is its first item.',
    resources: res,
  };
}

/** The gate script lives in the LIVE checkout (scripts/ is outside the agent's scope), served build in the worktree. */
/** A port nothing listens on right now (a fixed one met a gate server left over from an earlier job). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      const port = a && typeof a === "object" ? a.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

function screenshotGate(P: ApplyPaths) {
  return async ({ appDir, outDir }: { appDir: string; outDir: string }) => {
    const port = await freePort().catch(() => P.gatePort);
    const log = openSync(path.join(P.jobsDir, "gate-server.out"), "a");
    // its own process group, so the whole server (and anything it starts) is killed with it
    const server = spawn(P.node, [path.join(appDir, ".output", "server", "index.mjs")], {
      detached: true,
      cwd: appDir,
      env: childEnv({ PORT: String(port), HOST: "127.0.0.1", APP_BASE_PATH: "/cards", AUTH_DISABLED: "true", DO_NOT_TRACK: "1", AGENT_NATIVE_TELEMETRY_DISABLED: "1", COCKPIT_DATA_DIR: path.join(appDir, "data", "cockpit-agent") }),
      stdio: ["ignore", log, log],
    });
    try {
      if (!(await waitHttp(`http://127.0.0.1:${port}/cards/`, 60_000))) return { ok: false, detail: "the built region did not start on port " + port, shots: [] };
      const r = await exec(P.node, [path.join(P.appDir, "scripts", "ask-gate.mjs"), "--base", `http://127.0.0.1:${port}`, "--out", outDir], { cwd: P.appDir, timeoutMs: 4 * 60_000 });
      const line = r.out.trim().split("\n").pop() || "";
      try {
        const v = JSON.parse(line);
        return { ok: !!v.ok && r.code === 0, detail: v.ok ? "ok" : (v.failed || []).join("; ").slice(0, 600), shots: v.shots || [] };
      } catch {
        return { ok: false, detail: (r.err || r.out).slice(-600), shots: [] };
      }
    } finally {
      try {
        if (server.pid) process.kill(-server.pid, "SIGKILL");
      } catch {
        server.kill("SIGKILL");
      }
    }
  };
}

/** A detached restarter replaces this server with one on the new build, same environment, and records the outcome. */
function restart(P: ApplyPaths) {
  return async ({ jobId }: { jobId: string }) => {
    const out = openSync(path.join(dataDir(), "region.out"), "a");
    const child = spawn(
      P.node,
      [path.join(P.appDir, "scripts", "restart-region.mjs"), "--pid", String(process.pid), "--out", path.join(P.jobsDir, jobId + ".restart.json"), "--app", P.appDir],
      // the boot environment: the restarted region configures its own database and auth secret, as this one did
      { cwd: P.appDir, env: bootEnv(), detached: true, stdio: ["ignore", out, out] },
    );
    child.unref();
  };
}

export function liveDeps(P: ApplyPaths, fileSystemCard: ApplyDeps["fileSystemCard"]): ApplyDeps {
  return { exec, runCodeAgent, resourceContext, fileSystemCard, screenshotGate: screenshotGate(P), restart: restart(P) };
}
