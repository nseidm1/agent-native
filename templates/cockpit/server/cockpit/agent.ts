/**
 * The cockpit's agent is the Mac's own Claude Code CLI, already logged in
 * (console instruction: "use the current Mac client as the client"). One run
 * at a time, 120 s cap, argv array (never a shell string), and the run can
 * reach exactly three tools: this app's get-cards, get-layout and set-layout
 * over its own MCP endpoint. Built-in tools (shell, files, web) are disabled
 * with --tools "", other MCP servers are excluded with --strict-mcp-config,
 * and anything not allow-listed is denied by --permission-mode dontAsk.
 */
import { spawn } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readLayout } from "./layout.js";

export const AGENT_TIMEOUT_MS = 120_000;
export const MCP_SERVER_NAME = "cockpit";
export const AGENT_TOOL_NAMES = ["get-cards", "get-layout", "set-layout"] as const;
export const ALLOWED_TOOLS = AGENT_TOOL_NAMES.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);
/**
 * The framework's own MCP tools on the same endpoint. --allowedTools plus
 * dontAsk already denies them; --disallowedTools removes them from the run
 * outright, so the model is not even offered them.
 */
export const DISALLOWED_TOOLS = ["ask_app", "ask_app_status", "list_apps", "open_app", "create_embed_session", "tool-search"].map(
  (t) => `mcp__${MCP_SERVER_NAME}__${t}`,
);
export const AGENT_SYSTEM_PROMPT =
  "You manage the cockpit card region. Change layout only through set-layout. " +
  "Read get-layout before changing it, send the whole layout back with only the requested change, and answer in one or two short sentences.";

const dataDir = () => path.resolve(process.env.COCKPIT_DATA_DIR || path.join(process.cwd(), "data", "cockpit-agent"));
const claudeBin = () => process.env.COCKPIT_CLAUDE_BIN || path.join(os.homedir(), ".local", "bin", "claude");
const mcpUrl = () =>
  process.env.COCKPIT_MCP_URL || `http://127.0.0.1:${process.env.PORT || process.env.NITRO_PORT || 5241}/_agent-native/mcp`;
const agentModel = () => process.env.COCKPIT_AGENT_MODEL || "claude-sonnet-5-5";

/** Exact loopback addresses only; a proxy on this host connects from one of these. */
export function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const a = ip.trim().toLowerCase();
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/** The argv for one run. Pure, so the bounds are testable without spawning. */
export function buildArgs(question: string, mcpConfigPath: string): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    agentModel(),
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath,
    "--tools",
    "",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--disallowedTools",
    DISALLOWED_TOOLS.join(","),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--append-system-prompt",
    AGENT_SYSTEM_PROMPT,
    // after "--" the question is a positional prompt, never parsed as a flag
    "--",
    question,
  ];
}

export class AgentError extends Error {
  /** 400 bad question, 409 a run is already going, 502 the CLI failed. */
  constructor(
    message: string,
    readonly status: 400 | 409 | 502 = 502,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

let busy = false;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

function runCli(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    // the Mac login, never an API key or a parent Claude session's identity
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    const finish = (r: RunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(claudeBin(), args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, AGENT_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      if (stdout.length < 1_000_000) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < 100_000) stderr += d;
    });
    child.on("error", (e: NodeJS.ErrnoException) =>
      finish({ code: null, stdout, stderr, timedOut, spawnError: e.code === "ENOENT" ? `Claude CLI not found at ${claudeBin()}` : e.message }),
    );
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

const firstLine = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .find(Boolean)
    ?.slice(0, 300) || "";

/**
 * The MCP config for one run. The endpoint admits a loopback caller that names
 * its owner (x-agent-native-owner-email, the framework's loopback dev-open
 * rule), so the CLI acts as the same user the UI is signed in as and reads and
 * writes the same layout.
 */
export function buildMcpConfig(ownerEmail: string) {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: "http",
        url: mcpUrl(),
        headers: { "x-agent-native-owner-email": ownerEmail },
      },
    },
  };
}

export async function askAgent(
  question: string,
  ownerEmail: string | undefined,
): Promise<{ answer: string; layoutChanged: boolean }> {
  const q = question.trim();
  if (!q) throw new AgentError("Ask a question first.", 400);
  if (q.length > 2000) throw new AgentError("Questions are limited to 2000 characters.", 400);
  if (!ownerEmail) throw new AgentError("No signed-in user for this request.", 400);
  if (busy) throw new AgentError("The agent is already answering a question; try again when it finishes.", 409);
  busy = true;
  const started = Date.now();
  const dir = dataDir();
  let exit: number | null = null;
  let layoutChanged = false;
  let error: string | undefined;
  try {
    await mkdir(dir, { recursive: true });
    const cfg = path.join(dir, "mcp-config.json");
    await writeFile(cfg, JSON.stringify(buildMcpConfig(ownerEmail), null, 2));
    // an empty working directory outside any repo: no project settings, hooks or CLAUDE.md ride along
    const cwd = path.join(os.tmpdir(), "cockpit-agent-cwd");
    await mkdir(cwd, { recursive: true });
    const before = JSON.stringify(await readLayout());
    const r = await runCli(buildArgs(q, cfg), cwd);
    exit = r.code;
    layoutChanged = JSON.stringify(await readLayout()) !== before;
    if (r.spawnError) throw new AgentError(r.spawnError);
    if (r.timedOut) throw new AgentError(`The agent did not answer within ${AGENT_TIMEOUT_MS / 1000} s.`);
    let parsed: { result?: unknown; is_error?: boolean } | null = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
    const result = parsed && typeof parsed.result === "string" ? parsed.result.trim() : "";
    if (r.code !== 0 || !parsed || parsed.is_error) {
      throw new AgentError(firstLine(result) || firstLine(r.stderr) || firstLine(r.stdout) || `Claude CLI exited ${r.code}`);
    }
    return { answer: result || "(no answer)", layoutChanged };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e instanceof AgentError ? e : new AgentError(error);
  } finally {
    busy = false;
    const line = JSON.stringify({ time: new Date().toISOString(), question: q, exit, layoutChanged, ms: Date.now() - started, ...(error ? { error } : {}) });
    await appendFile(path.join(dir, "ask-agent.log"), line + "\n").catch(() => {});
  }
}
