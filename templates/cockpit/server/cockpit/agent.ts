/**
 * The cockpit's agent is the Mac's own Claude Code CLI, already logged in
 * (console instruction: "use the current Mac client as the client"). One run
 * at a time, 120 s cap, argv array (never a shell string), and the run can
 * reach exactly these tools over its own MCP endpoint: this app's get-cards,
 * get-card-detail, get-board, get-board-card, cockpit-manifest and
 * cockpit-read (reads, all through the cockpit client: cockpit-read reaches
 * any resource the cockpit's manifest names, so a new one needs no change
 * here), get-layout and set-layout. It never writes to the cockpit:
 * cockpit-act and the dialog writes are disallowed outright. Built-in tools (shell, files, web) are disabled
 * with --tools "", other MCP servers are excluded with --strict-mcp-config,
 * and anything not allow-listed is denied by --permission-mode dontAsk.
 *
 * Image attachments (at most 3): each is checked by its magic bytes and size,
 * written to the data dir under a random name, named in the prompt, and made
 * readable by enabling the built-in Read tool with an allow rule for exactly
 * those paths (Read(//<abs path>)); any other Read is denied by dontAsk. The
 * files are deleted when the run ends, whatever the outcome.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ASK_IMAGE_EXT,
  type AskImage,
  type AskImageType,
  MAX_ASK_IMAGE_B64,
  MAX_ASK_IMAGE_BYTES,
  MAX_ASK_IMAGES,
  sniffImageType,
} from "../../shared/ask-images.js";
import { WRITE_ACTION_NAMES } from "../../shared/cockpit-detail.js";
import { type AskKind, type Classification, classify } from "./classify.js";
import { readLayout } from "./layout.js";
import { type FiledRequest, fileRequestCard } from "./request-card.js";

export const AGENT_TIMEOUT_MS = 120_000;
export const MCP_SERVER_NAME = "cockpit";
export const AGENT_TOOL_NAMES = ["get-cards", "get-card-detail", "get-board", "get-board-card", "cockpit-manifest", "cockpit-read", "get-layout", "set-layout"] as const;
export const ALLOWED_TOOLS = AGENT_TOOL_NAMES.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`);
/**
 * The framework's own MCP tools on the same endpoint. --allowedTools plus
 * dontAsk already denies them; --disallowedTools removes them from the run
 * outright, so the model is not even offered them.
 */
export const DISALLOWED_TOOLS = [
  "ask_app",
  "ask_app_status",
  "list_apps",
  "open_app",
  "create_embed_session",
  "tool-search",
  // the dialog writes and the generic cockpit-act are never MCP tools (mcpTool: false); named here too, so the run is never offered one
  "cockpit-act",
  ...WRITE_ACTION_NAMES,
].map(
  (t) => `mcp__${MCP_SERVER_NAME}__${t}`,
);
export const AGENT_SYSTEM_PROMPT =
  "You manage the cockpit card region. Read a card's full detail with get-card-detail, the whole board with get-board and one board card with get-board-card; " +
  "cockpit-manifest lists everything the cockpit offers and cockpit-read reads any of it. Change layout only through set-layout. " +
  "Read get-layout before changing it, send the whole layout back with only the requested change, and answer in one or two short sentences.";

export const dataDir = () => path.resolve(process.env.COCKPIT_DATA_DIR || path.join(process.cwd(), "data", "cockpit-agent"));
export const claudeBin = () => process.env.COCKPIT_CLAUDE_BIN || path.join(os.homedir(), ".local", "bin", "claude");
const mcpUrl = () =>
  process.env.COCKPIT_MCP_URL || `http://127.0.0.1:${process.env.PORT || process.env.NITRO_PORT || 5241}/_agent-native/mcp`;
const agentModel = () => process.env.COCKPIT_AGENT_MODEL || "claude-sonnet-5-5";

/** Exact loopback addresses only; a proxy on this host connects from one of these. */
export function isLoopbackAddress(ip: string | undefined | null): boolean {
  if (!ip) return false;
  const a = ip.trim().toLowerCase();
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/** Characters a path may hold to go into a permission rule verbatim (no glob, no parenthesis, no space). */
const RULE_SAFE_PATH = /^\/[A-Za-z0-9._\/-]+$/;

/** The CLI permission rule that allows Read of exactly this absolute path ("//" marks an absolute path). */
export function readRuleFor(absPath: string): string {
  if (!RULE_SAFE_PATH.test(absPath) || absPath.includes("..")) throw new AgentError("Image path is not safe to allow-list.");
  return `Read(/${absPath})`;
}

/** The prompt the CLI receives: the question, then the attached images' paths when there are any. */
export function promptWithImages(question: string, imagePaths: string[]): string {
  if (!imagePaths.length) return question;
  return `${question}\n\nAttached images: ${imagePaths.join(", ")} - view them with the Read tool.`;
}

/** The argv for one run. Pure, so the bounds are testable without spawning. */
export function buildArgs(question: string, mcpConfigPath: string, imagePaths: string[] = []): string[] {
  const allowed = [...ALLOWED_TOOLS, ...imagePaths.map(readRuleFor)];
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
    imagePaths.length ? "Read" : "",
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    DISALLOWED_TOOLS.join(","),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--append-system-prompt",
    AGENT_SYSTEM_PROMPT,
    // after "--" the question is a positional prompt, never parsed as a flag
    "--",
    promptWithImages(question, imagePaths),
  ];
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decode and check one attachment; the bytes and the type they really are. Throws a 400 AgentError. */
export function decodeImage(img: AskImage, i: number): { bytes: Buffer; ext: string; type: AskImageType } {
  const label = `Image ${i + 1}${img && typeof img.name === "string" && img.name ? ` (${img.name.slice(0, 60)})` : ""}`;
  const data = img && typeof img.data === "string" ? img.data.replace(/\s+/g, "") : "";
  if (!data) throw new AgentError(`${label} is empty.`, 400);
  if (data.length > MAX_ASK_IMAGE_B64 + 4) throw new AgentError(`${label} is larger than 5 MB.`, 400);
  if (data.length % 4 !== 0 || !B64.test(data)) throw new AgentError(`${label} is not valid base64.`, 400);
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_ASK_IMAGE_BYTES) throw new AgentError(`${label} is larger than 5 MB.`, 400);
  const type = sniffImageType(bytes);
  if (!type) throw new AgentError(`${label} is not a PNG, JPEG, WebP or GIF image.`, 400);
  return { bytes, ext: ASK_IMAGE_EXT[type], type };
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

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export function runCli(args: string[], cwd: string, timeoutMs = AGENT_TIMEOUT_MS): Promise<RunResult> {
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
    }, timeoutMs);
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

export const firstLine = (s: string) =>
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

export interface AskResult {
  answer: string;
  layoutChanged: boolean;
  /** Which path ran: layout and read are the agent run; change filed a board card and changed nothing. */
  kind: AskKind;
  /** The classifier's own note when it failed and the read path was used as the safe default. */
  classifyNote?: string;
  card?: FiledRequest;
}

/** Injectable for tests: the classifier and the filer. */
export interface AskDeps {
  classify?: (q: string) => Promise<Classification>;
  fileRequest?: typeof fileRequestCard;
  runAgent?: typeof runCli;
}

export async function askAgent(
  question: string,
  ownerEmail: string | undefined,
  images: AskImage[] = [],
  deps: AskDeps = {},
): Promise<AskResult> {
  const q = question.trim();
  if (!q) throw new AgentError("Ask a question first.", 400);
  if (q.length > 2000) throw new AgentError("Questions are limited to 2000 characters.", 400);
  if (!ownerEmail) throw new AgentError("No signed-in user for this request.", 400);
  if (!Array.isArray(images)) throw new AgentError("images must be a list.", 400);
  if (images.length > MAX_ASK_IMAGES) throw new AgentError(`At most ${MAX_ASK_IMAGES} images.`, 400);
  // every image is checked before anything is written or spawned
  const decoded = images.map(decodeImage);
  if (busy) throw new AgentError("The agent is already answering a question; try again when it finishes.", 409);
  busy = true;
  const imagePaths: string[] = [];
  const started = Date.now();
  const dir = dataDir();
  let exit: number | null = null;
  let layoutChanged = false;
  let error: string | undefined;
  let kind: AskKind | undefined;
  let filed: FiledRequest | undefined;
  try {
    await mkdir(dir, { recursive: true });
    // 1. which path: a short tool-less CLI call; an unreadable answer falls back to read (the run that cannot change code)
    const cls = await (deps.classify ?? classify)(q);
    kind = cls.kind;
    if (cls.kind === "change") {
      // 2a. a change is never executed here: it becomes a board card carrying the request and its images
      filed = await (deps.fileRequest ?? fileRequestCard)(q, cls, decoded);
      const imgs = filed.attached === "board" ? ` ${filed.images.length} image${filed.images.length === 1 ? "" : "s"} attached to the card.` : filed.attached === "folder" ? ` Images saved and named on the card: ${filed.images.join(", ")}.` : "";
      const head = filed.again ? `Already filed as ${filed.fa}: ${filed.title} (asked again; noted on the card, nothing new filed).` : `Filed ${filed.fa}: ${filed.title}.`;
      return { answer: head + imgs, layoutChanged: false, kind, card: filed };
    }
    // 2b. layout and read: today's agent run, four region tools and nothing else
    const cfg = path.join(dir, "mcp-config.json");
    await writeFile(cfg, JSON.stringify(buildMcpConfig(ownerEmail), null, 2));
    // an empty working directory outside any repo: no project settings, hooks or CLAUDE.md ride along
    const cwd = path.join(os.tmpdir(), "cockpit-agent-cwd");
    await mkdir(cwd, { recursive: true });
    if (decoded.length) {
      const imgDir = path.join(dir, "images");
      await mkdir(imgDir, { recursive: true, mode: 0o700 });
      for (const d of decoded) {
        const p = path.join(imgDir, `${randomBytes(16).toString("hex")}.${d.ext}`);
        imagePaths.push(p); // pushed first, so a failed write is still cleaned up
        await writeFile(p, d.bytes, { mode: 0o600, flag: "wx" });
      }
    }
    const before = JSON.stringify(await readLayout());
    const r = await (deps.runAgent ?? runCli)(buildArgs(q, cfg, imagePaths), cwd);
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
    return { answer: result || "(no answer)", layoutChanged, kind: cls.kind, ...(cls.ok ? {} : { classifyNote: cls.detail || "classifier unavailable" }) };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e instanceof AgentError ? e : new AgentError(error);
  } finally {
    // the attachments live only for the run: removed on success, error and timeout alike
    await Promise.all(imagePaths.map((p) => rm(p, { force: true }).catch(() => {})));
    busy = false;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      question: q,
      images: decoded.length,
      kind,
      ...(filed ? { card: filed.fa, attached: filed.attached } : {}),
      exit,
      layoutChanged,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    });
    await appendFile(path.join(dir, "ask-agent.log"), line + "\n").catch(() => {});
  }
}
