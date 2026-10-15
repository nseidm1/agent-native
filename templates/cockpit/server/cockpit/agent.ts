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
import { type DetailAction, WRITE_ACTION_NAMES } from "../../shared/cockpit-detail.js";
import { type ApplyInput, type ApplyJob, applyPaths, startApply } from "./apply/job.js";
import { liveDeps } from "./apply/runtime.js";
import { appendRoute, type RoutePart, type RoutePath } from "./ask-routes.js";
import { getBoardCard } from "./board.js";
import { type AskPart, type BoardVerb, type Classification, classify, layoutExpressible, namedFas, type PartKind, partClassification } from "./classify.js";
import { readLayout } from "./layout.js";
import { buildRequestCard, faOfTitle, type FiledRequest, fileRequestCard, portfolioDir } from "./request-card.js";

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
  "Read get-layout before changing it, send the whole layout back with only the requested change, and answer in one or two short sentences. " +
  // FA-19087 no dead ends: a request set-layout cannot express goes on to the change path (the gated code agent) instead of stopping here
  `set-layout only reorders, hides, shows or sizes the 14 region cards, the same at every width. If the request needs anything else (another element, a placement for one width only, a restyle), do not call set-layout and make the first line of your answer exactly ${"CANNOT_LAYOUT"}: <one short reason>; the request then goes to the code agent.`;
/** The first line a layout run answers when set-layout cannot express the request (FA-19087). */
export const CANNOT_LAYOUT = /^\s*CANNOT_LAYOUT:\s*(.*)$/m;

/** MI-388: appended for a viewer that may not change anything (an unpaired remote device). */
export const READ_ONLY_VIEWER_PROMPT =
  "This viewer is on a device that is not paired with the cockpit, so you cannot change the layout here: answer reads, and for a layout change say that it needs this Mac or a phone signed in with the board token.";

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
export function buildArgs(question: string, mcpConfigPath: string, imagePaths: string[] = [], opts: { layoutWrites?: boolean } = {}): string[] {
  // MI-388: a viewer that may not apply (an unpaired remote device) is not offered set-layout at all: reads only
  const layoutWrites = opts.layoutWrites !== false;
  const setLayout = `mcp__${MCP_SERVER_NAME}__set-layout`;
  const allowed = [...ALLOWED_TOOLS.filter((t) => layoutWrites || t !== setLayout), ...imagePaths.map(readRuleFor)];
  const disallowed = layoutWrites ? DISALLOWED_TOOLS : [...DISALLOWED_TOOLS, setLayout];
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
    disallowed.join(","),
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--append-system-prompt",
    layoutWrites ? AGENT_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT + " " + READ_ONLY_VIEWER_PROMPT,
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

export interface PartResult {
  /** what the classifier called it */
  kind: PartKind;
  /** the path it finally ran on, and every path tried (more than one: it escalated) */
  path: RoutePath;
  trail: RoutePath[];
  text: string;
  /** this part's line of the reply */
  answer: string;
  /** why it escalated, when it did */
  escalated?: string;
}

export interface AskResult {
  answer: string;
  layoutChanged: boolean;
  /** The path the request's main part finally ran on: layout or read (the agent run), change (an applied change, job), system (filed), board (an offered card action). */
  kind: PartKind;
  /** The classifier's own note when it failed and the read path was used as the safe default. */
  classifyNote?: string;
  card?: FiledRequest;
  /** For an applied change: the background job the panel follows (get-ask-job) until it is live or reverted. */
  job?: { id: string; status: ApplyJob["status"] };
  /** FA-19087: every part of the request and the path it took. */
  parts: PartResult[];
  /** Board card actions offered to a paired viewer as one-tap confirms (the existing cockpit-board-card-action write); the tap is the act. */
  offers: DetailAction[];
}

/** Injectable for tests: the classifier, the filer, the apply starter and the card-title lookup. */
export interface AskDeps {
  classify?: (q: string, named?: { fa: string; title: string }[], images?: number) => Promise<Classification>;
  fileRequest?: typeof fileRequestCard;
  runAgent?: typeof runCli;
  apply?: (input: ApplyInput, cls: Classification) => ApplyJob;
  /** false for a caller that is neither this Mac nor a paired phone (MI-388): a change is filed, never applied, the layout is never moved, and a board action is not offered. */
  canApply?: boolean;
  /** The title of each board card the request names (read through the cockpit client), so the classifier can resolve "it". */
  cardTitles?: (fas: string[]) => Promise<{ fa: string; title: string }[]>;
}

const VERB_LABEL: Record<BoardVerb, string> = { archive: "Archive", pause: "Pause", resume: "Resume", backlog: "Backlog", promote: "Promote" };
/** The one-tap confirm for a board part: the dialog's own board card write (cockpit-board-card-action, the cockpit's write gate behind it). */
export function boardOffer(fa: string, action: BoardVerb): DetailAction {
  return { kind: "board-card", label: `${VERB_LABEL[action]} ${fa}`, args: { fa, action }, ...(action === "archive" ? { danger: true } : {}) };
}

/** The live title lookup: at most 3 cards, 3 s, through the cockpit client; a miss is simply not named. */
async function liveCardTitles(fas: string[]): Promise<{ fa: string; title: string }[]> {
  const one = async (fa: string) => {
    const r = await Promise.race([getBoardCard(fa), new Promise<null>((res) => setTimeout(() => res(null), 3000).unref())]);
    return { fa, title: r && r.card ? String((r.card as { title?: unknown }).title || "") : "" };
  };
  return Promise.all(fas.slice(0, 3).map(one));
}

/** A board card named in the request (not one a board part acts on), or the one already filed for this same request (FA-18951's again path). */
async function requestFa(q: string, cls: Classification, exclude: string[]): Promise<string | undefined> {
  const named = [...q.matchAll(/\bFA-\d{1,6}\b/g)].map((m) => m[0]).find((f) => !exclude.includes(f));
  if (named) return named;
  const t = buildRequestCard(q, cls, { at: "", images: 0 }).title;
  return (await faOfTitle(portfolioDir(), t)) ?? undefined;
}

/** The live apply starter: the gates in apply/job.ts around agent-native's code agent (apply/runtime.ts). */
function liveApply(input: ApplyInput, cls: Classification): ApplyJob {
  const P = applyPaths(dataDir());
  const fileSystemCard = async (why: string) => {
    const f = await fileRequestCard(input.question, { ...cls, kind: "system" }, input.images, why);
    return { fa: f.fa, title: f.title };
  };
  return startApply(P, input, liveDeps(P, fileSystemCard));
}

const PAIRING = "this Mac or a phone signed in with the board token";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

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
  const canApply = deps.canApply !== false;
  const imagePaths: string[] = [];
  const started = Date.now();
  const dir = dataDir();
  let exit: number | null = null;
  let layoutChanged = false;
  let error: string | undefined;
  let cls: Classification | undefined;
  let filed: FiledRequest | undefined;
  let applied: string | undefined;
  const results: (PartResult & { route: RoutePart; at: number })[] = [];
  try {
    await mkdir(dir, { recursive: true });
    // 1. which paths: the cards the request names (so "it" resolves), then a short tool-less CLI call that splits the request into parts
    const fas = namedFas(q);
    const lookup = deps.cardTitles ?? (deps.classify ? async () => [] : liveCardTitles);
    const named = fas.length ? await lookup(fas).catch(() => []) : [];
    cls = await (deps.classify ?? classify)(q, named, decoded.length);
    const parts = cls.parts?.length ? cls.parts : [{ kind: cls.kind, text: q, title: cls.title, area: cls.area, width: "any" as const }];
    const single = parts.filter((p) => p.kind !== "board").length <= 1;
    const add = (p: AskPart, r: Omit<PartResult, "kind" | "text">, extra: Partial<RoutePart> = {}) =>
      results.push({ kind: p.kind, text: p.text, ...r, at: parts.indexOf(p), route: { kind: p.kind, path: r.path, trail: r.trail, outcome: "", ...extra } });

    // 2. board parts: offered as a one-tap confirm to a viewer who may write, never filed as a card about a card
    const offers: DetailAction[] = [];
    for (const p of parts.filter((x) => x.kind === "board" && x.fa && x.action)) {
      const verb = p.action!;
      if (canApply) {
        offers.push(boardOffer(p.fa!, verb));
        add(p, { path: "board", trail: ["board"], answer: `${VERB_LABEL[verb]} ${p.fa}: tap the button below to do it${verb === "archive" ? " (archiving hides the card; nothing is deleted)" : ""}.` }, { outcome: "offered", fa: p.fa, action: verb });
      } else add(p, { path: "board", trail: ["board"], answer: `${VERB_LABEL[verb]} ${p.fa} needs a paired device (${PAIRING}); nothing was changed.` }, { outcome: "needs-pairing", fa: p.fa, action: verb });
    }

    // 3. no dead ends: a layout part set-layout cannot express goes to the change path before the run
    const toChange: { p: AskPart; from?: RoutePath; why?: string }[] = parts.filter((p) => p.kind === "change").map((p) => ({ p }));
    const agentParts: AskPart[] = [];
    for (const p of parts) {
      if (p.kind === "read") agentParts.push(p);
      if (p.kind !== "layout") continue;
      const v = layoutExpressible(p);
      if (v.ok) agentParts.push(p);
      else toChange.push({ p, from: "layout", why: v.why });
    }
    const systemParts = parts.filter((p) => p.kind === "system");

    // 4. layout and read: the agent run, the region tools and nothing else
    if (agentParts.length) {
      const cfg = path.join(dir, "mcp-config.json");
      await writeFile(cfg, JSON.stringify(buildMcpConfig(ownerEmail), null, 2));
      // an empty working directory outside any repo: no project settings, hooks or CLAUDE.md ride along
      const cwd = path.join(os.tmpdir(), "cockpit-agent-cwd");
      await mkdir(cwd, { recursive: true });
      // the images go with the change or the filed card when there is one; otherwise this run reads them
      if (decoded.length && !toChange.length && !systemParts.length) {
        const imgDir = path.join(dir, "images");
        await mkdir(imgDir, { recursive: true, mode: 0o700 });
        for (const d of decoded) {
          const p = path.join(imgDir, `${randomBytes(16).toString("hex")}.${d.ext}`);
          imagePaths.push(p); // pushed first, so a failed write is still cleaned up
          await writeFile(p, d.bytes, { mode: 0o600, flag: "wx" });
        }
      }
      const askText = single && agentParts.length === parts.length ? q : agentParts.map((p) => p.text).join(" ");
      const before = JSON.stringify(await readLayout());
      let answer = "";
      try {
        const r = await (deps.runAgent ?? runCli)(buildArgs(askText, cfg, imagePaths, { layoutWrites: canApply }), cwd);
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
        if (r.code !== 0 || !parsed || parsed.is_error) throw new AgentError(firstLine(result) || firstLine(r.stderr) || firstLine(r.stdout) || `Claude CLI exited ${r.code}`);
        answer = result || "(no answer)";
      } catch (e) {
        // the only part: the run's own error is the reply, as before; one of several: that part says it failed, the rest still answer
        if (parts.length === 1 || !(e instanceof AgentError)) throw e;
        for (const p of agentParts) add(p, { path: p.kind as RoutePath, trail: [p.kind as RoutePath], answer: e.message }, { outcome: "refused" });
        answer = "";
      }
      if (answer) {
        // the second net: the run said set-layout cannot express it, so its layout parts go on to the change path
        const cannot = CANNOT_LAYOUT.exec(answer);
        const layoutParts = agentParts.filter((p) => p.kind === "layout");
        if (cannot && !layoutChanged && layoutParts.length) {
          for (const p of layoutParts) toChange.push({ p, from: "layout", why: cannot[1].trim() || "set-layout cannot express it" });
          const rest = answer.replace(CANNOT_LAYOUT, "").trim();
          for (const p of agentParts.filter((x) => x.kind === "read")) add(p, { path: "read", trail: ["read"], answer: rest || "(no answer)" }, { outcome: "answered" });
        } else {
          agentParts.forEach((p, i) =>
            add(
              p,
              { path: p.kind as RoutePath, trail: [p.kind as RoutePath], answer: i === 0 ? answer : "" },
              { outcome: p.kind === "layout" ? (layoutChanged ? "moved" : "unchanged") : "answered" },
            ),
          );
        }
      }
    }

    // 5. change: one applied change for every change part (this Mac or a paired phone), filed for anyone else
    let job: AskResult["job"];
    if (toChange.length) {
      const lead = toChange[0].p;
      const title = toChange.map((c) => c.p.title).find(Boolean) || lead.text.slice(0, 60) || q.slice(0, 60);
      const changeText = single && !parts.some((p) => p.kind === "board") ? q : toChange.map((c) => c.p.text).join(" ");
      const fullText = changeText === q ? q : `${changeText}\n\n(From the console's request "${q}": its other parts were handled separately, so change only this.)`;
      const pc = { ...partClassification({ ...lead, kind: "change", title }), kind: "change" as const };
      const esc = toChange.find((c) => c.from);
      const escNote = esc ? `Set-layout cannot do this (${esc.why}), so it went on to the change path. ` : "";
      const trailOf = (c: (typeof toChange)[number]): RoutePath[] => (c.from ? [c.from, "change"] : ["change"]);
      if (canApply) {
        try {
          const boardFas = parts.filter((p) => p.kind === "board" && p.fa).map((p) => p.fa!);
          const fa = await requestFa(q, pc, boardFas).catch(() => undefined);
          const j = (deps.apply ?? liveApply)({ question: fullText, title, fa, images: decoded }, pc);
          applied = j.id;
          job = { id: j.id, status: j.status };
          const answer = `${escNote}Applying "${title}": the code agent is changing a copy of the cockpit${decoded.length ? ` from your ${decoded.length === 1 ? "image" : decoded.length + " images"}` : ""}. It goes live only after the scope check, typecheck, tests, build and a Playwright check pass; otherwise nothing changes.`;
          toChange.forEach((c, i) => add(c.p, { path: "change", trail: trailOf(c), answer: i === 0 ? answer : "", ...(c.from ? { escalated: c.why } : {}) }, { outcome: "applying", job: j.id }));
        } catch (e) {
          // another applied change is running: said, not thrown, so the request's other parts still answer
          const why = e instanceof Error ? e.message : String(e);
          toChange.forEach((c, i) => add(c.p, { path: "change", trail: trailOf(c), answer: i === 0 ? escNote + why : "", ...(c.from ? { escalated: c.why } : {}) }, { outcome: "refused" }));
        }
      } else {
        const f = await (deps.fileRequest ?? fileRequestCard)(fullText, pc, decoded, "asked from a device that is neither this Mac nor a paired phone, so the change was filed instead of applied");
        filed = f;
        const head = f.again ? `Already filed as ${f.fa}: ${f.title} (asked again; noted on the card, nothing new filed).` : `Filed ${f.fa}: ${f.title}.`;
        const answer = `${escNote}${head} Changes apply from ${PAIRING}; from this device it was filed instead.${imagesLine(f)}`;
        toChange.forEach((c, i) => add(c.p, { path: "filed", trail: c.from ? [c.from, "filed"] : ["filed"], answer: i === 0 ? answer : "", ...(c.from ? { escalated: c.why } : {}) }, { outcome: "filed", card: f.fa }));
      }
    }

    // 6. system: filed as a board card with its images, never executed here
    for (const p of systemParts) {
      const f = await (deps.fileRequest ?? fileRequestCard)(single ? q : p.text, partClassification(p), toChange.length ? [] : decoded, "it needs the system side (data or an action the cockpit's client does not serve yet, or lane, board or model behaviour)");
      filed ??= f;
      const head = f.again ? `Already filed as ${f.fa}: ${f.title} (asked again; noted on the card, nothing new filed).` : `Filed ${f.fa}: ${f.title}.`;
      add(p, { path: "filed", trail: ["filed"], answer: `${head} It needs the system side, so it was filed rather than applied.${imagesLine(f)}` }, { outcome: "filed", card: f.fa });
    }

    // the reply, in the request's order
    const ordered = [...results].sort((a, b) => a.at - b.at);
    const lead = ordered.find((r) => r.kind !== "board") ?? ordered[0];
    const kind: PartKind = !lead ? "read" : lead.path === "filed" ? (lead.kind === "system" ? "system" : "change") : (lead.path as PartKind);
    return {
      answer: ordered.map((r) => r.answer).filter(Boolean).join(" ") || "(no answer)",
      layoutChanged,
      kind,
      ...(filed ? { card: filed } : {}),
      ...(job ? { job } : {}),
      parts: ordered.map(({ route: _r, at: _a, ...r }) => r),
      offers,
      ...(cls.ok ? {} : { classifyNote: cls.detail || "classifier unavailable" }),
    };
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
      kind: cls?.kind,
      ...(cls?.parts && cls.parts.length > 1 ? { parts: cls.parts.map((p) => p.kind) } : {}),
      ...(filed ? { card: filed.fa, attached: filed.attached } : {}),
      ...(applied ? { job: applied } : {}),
      exit,
      layoutChanged,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    });
    await appendFile(path.join(dir, "ask-agent.log"), line + "\n").catch(() => {});
    // FA-19087: the routing KPI's row (ask-routes.ts); an ask refused before it was classified is not a routing decision
    if (cls) {
      const routes = results.map((r) => r.route);
      if (error && !routes.length) routes.push({ kind: cls.kind, path: cls.kind === "system" ? "filed" : (cls.kind as RoutePath), trail: [cls.kind as RoutePath], outcome: "refused" });
      await appendRoute(dir, { at: new Date(started).toISOString(), q: q.slice(0, 500), ok: cls.ok, canApply, parts: routes });
    }
  }
}

function imagesLine(f: FiledRequest): string {
  return f.attached === "board" ? ` ${plural(f.images.length, "image")} attached to the card.` : f.attached === "folder" ? ` Images saved and named on the card: ${f.images.join(", ")}.` : "";
}
