/**
 * Which path each part of an Ask agent request takes. FA-18951 filed every
 * change as a card; FA-19080 split a change in two; FA-19087 (console
 * 2026-10-15 ~08:45Z: "Cancel 19211, just move it above the lane card" was
 * filed whole as a system card, then "Is there something to optimize in how it
 * classifies?") made the answer a LIST OF PARTS, each with its own path:
 *
 *   layout   ONLY reorder, hide, show or size the 14 region cards, at every width alike:
 *            the region agent run (set-layout). A layout part set-layout cannot express
 *            escalates to change (agent.ts layoutExpressible + the run's CANNOT_LAYOUT line)
 *   read     a question about what the cockpit shows: the same run, reads only
 *   change   anything in the cockpit's UI that frontend code can do with the data the client
 *            already serves (agent-native renders the WHOLE front-facing cockpit since FA-19087:
 *            the top bar, Lane, Budget, Office, the home faces, the region, dialogs, the studio,
 *            the phone layout): moving any element, phone-only or responsive layout, restyles,
 *            new views. APPLIED live by the code agent behind the gates in apply/job.ts
 *   system   ONLY new data or a new action behind the client, or lane, board or model
 *            behaviour: filed as a board card by request-card.ts, never executed
 *   board    cancel (archive), pause, resume, backlog or promote an existing board card: never a
 *            card about a card. Offered to a paired viewer as a one-tap confirm that runs the
 *            existing client action (cockpit-board-card-action); the tap is the act
 *
 * One short call to the Mac's Claude CLI with NO tools at all (--tools "",
 * --strict-mcp-config with no config, no setting sources, dontAsk), returning
 * {"parts":[...]} as one line of JSON. The answer only picks paths.
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CARD_IDS } from "../../shared/cockpit.js";
import { firstLine, runCli } from "./agent.js";

export type AskKind = "layout" | "read" | "change" | "system";
export const ASK_KINDS: readonly AskKind[] = ["layout", "read", "change", "system"];
/** A part's kind: the four paths, plus a board card action (never filed as a card). */
export type PartKind = AskKind | "board";
export const PART_KINDS: readonly PartKind[] = [...ASK_KINDS, "board"];
/** The board card actions the cockpit client offers (board.cardAction). */
export const BOARD_VERBS = ["pause", "resume", "backlog", "promote", "archive"] as const;
export type BoardVerb = (typeof BOARD_VERBS)[number];
/** Words the console uses for a board verb. Cancelling a card archives it: archiving hides a card and deletes nothing. */
const VERB_SYNONYMS: Record<string, BoardVerb> = {
  cancel: "archive",
  cancelled: "archive",
  close: "archive",
  drop: "archive",
  kill: "archive",
  archive: "archive",
  pause: "pause",
  hold: "pause",
  resume: "resume",
  unpause: "resume",
  restart: "resume",
  backlog: "backlog",
  promote: "promote",
};
export const MAX_PARTS = 4;

/** Where a change would land; the request card's CHANGE line names the file. */
export const CHANGE_AREAS = {
  region: { file: "templates/cockpit/app/components/cockpit/CardRegion.tsx", symbol: "CardRegion", fork: true },
  panel: { file: "templates/cockpit/app/components/cockpit/CardRegion.tsx", symbol: "AskPanel", fork: true },
  dialog: { file: "templates/cockpit/app/components/cockpit/CardDialog.tsx", symbol: "CardDialog", fork: true },
  data: { file: "templates/cockpit/server/cockpit/detail.ts", symbol: "buildDetail", fork: true },
  // FA-19087: agent-native renders the whole cockpit page (the top bar, the home column, the phone glance)
  page: { file: "templates/cockpit/app/components/cockpit/Cockpit.tsx", symbol: "Cockpit", fork: true },
} as const;
export type ChangeArea = keyof typeof CHANGE_AREAS;
export type Width = "any" | "phone" | "desktop";

export interface AskPart {
  kind: PartKind;
  /** The part restated so it stands alone; what its path receives. */
  text: string;
  /** A short card title for a change or system part (sanitized, at most 48 characters). */
  title: string;
  area: ChangeArea;
  /** board: the card and the verb */
  fa?: string;
  action?: BoardVerb;
  /** layout: the region card ids it names (anything else makes it a change) */
  cards?: string[];
  /** a placement limited to one width is never layout */
  width?: Width;
}

export interface Classification {
  /** The primary path (the first non-board part's kind; read when there is none): what callers that predate parts read. */
  kind: AskKind;
  title: string;
  area: ChangeArea;
  /** Every part of the request, in order; never empty from classify(). A caller that predates parts may leave it out (one part: kind). */
  parts?: AskPart[];
  /** false when the CLI failed or answered something unreadable; the safe default (read) was used. */
  ok: boolean;
  detail?: string;
}

export const CLASSIFY_TIMEOUT_MS = 30_000;

const EX = (req: string, parts: Partial<AskPart>[]) => `${req} -> ${JSON.stringify({ parts })}`;
/** Few-shot examples, the two 2026-10-15 misfires among them (FA-19213 filed a board action as a system card; the phone-only move went to set-layout twice). */
export const CLASSIFY_EXAMPLES = [
  EX('"move halo above AI models"', [{ kind: "layout", text: "Move the Halo card above the AI models card", title: "", area: "region", cards: ["halo", "models"], width: "any" }]),
  EX('"hide drafting modes and make the scorecard large"', [{ kind: "layout", text: "Hide the Drafting modes card and make the Scorecard card large", title: "", area: "region", cards: ["modes", "score"], width: "any" }]),
  EX('"Cancel 19211, just move it above the lane card" (FA-19211: On mobile move ask agent to a button on the toolbar)', [
    { kind: "board", text: "Cancel FA-19211", title: "", area: "region", fa: "FA-19211", action: "archive" },
    { kind: "change", text: "On phone widths, move the Ask agent button and its panel above the Lane card", title: "Ask agent above the Lane card on phones", area: "page", width: "phone" },
  ]),
  EX('"On phone widths only, move the Ask agent button and its panel to the very top, above the Lane card. Keep desktop as it is."', [
    { kind: "change", text: "On phone widths only, move the Ask agent button and its panel to the very top, above the Lane card; desktop unchanged", title: "Ask agent at the top on phones", area: "page", width: "phone" },
  ]),
  // the third misfire (~08:50Z, FA-19221, sent with one image): the top bar's layout is pure frontend
  EX('"Make the header one line on desktop" (with 1 image attached)', [{ kind: "change", text: "On desktop widths, lay the cockpit's header (the top bar) out on one line, as in the attached image", title: "One-line header on desktop", area: "page", width: "desktop" }]),
  EX('"hide the events card on the phone"', [{ kind: "change", text: "Hide the Activity card on phone widths only", title: "Hide Activity on phones", area: "region", width: "phone" }]),
  EX('"Cancel FA-00000, and make the Waiting tile glow brighter"', [
    { kind: "board", text: "Cancel FA-00000", title: "", area: "region", fa: "FA-00000", action: "archive" },
    { kind: "change", text: "Make the Waiting tile glow brighter", title: "Brighter glow on the Waiting tile", area: "page", width: "any" },
  ]),
  EX('"make the office card look like the attached image"', [{ kind: "change", text: "Restyle the Office card to match the attached image", title: "Restyle the Office card", area: "page", width: "any" }]),
  EX('"add a search box to the board window"', [{ kind: "change", text: "Add a search box to the Board card's window", title: "Search in the Board window", area: "dialog", width: "any" }]),
  EX('"pause FA-123"', [{ kind: "board", text: "Pause FA-123", title: "", area: "region", fa: "FA-123", action: "pause" }]),
  EX('"add a refusal-rate field to the office resource"', [{ kind: "system", text: "Add a refusal-rate field to the office resource", title: "Refusal rate in the office resource", area: "data" }]),
  EX('"make the dispatcher draw cards faster"', [{ kind: "system", text: "Make the dispatcher draw cards faster", title: "Faster dispatcher draws", area: "data" }]),
  EX('"what is blocking production?"', [{ kind: "read", text: "What is blocking production?", title: "", area: "region" }]),
];

export const CLASSIFY_SYSTEM_PROMPT = [
  "You route requests typed into the Ask agent panel of the Family Office cockpit. agent-native renders the ENTIRE front-facing cockpit: the top bar, the home column (the Lane card, Budget, Office, the home faces and key-number tiles such as Waiting), the 14-card status region, every card's click window and dialog, the studio, and the phone layout. You never act on a request; you only classify it.",
  "Split a request that asks for more than one thing into parts, in order; each part gets its own kind. Reply with ONE line of JSON and nothing else:",
  '{"parts":[{"kind":"layout"|"read"|"change"|"system"|"board","text":"<the part, restated so it stands alone>","title":"<at most 48 characters>","area":"region"|"panel"|"dialog"|"data"|"page","fa":"FA-<n>","action":"pause"|"resume"|"backlog"|"promote"|"archive","cards":["<card id>"],"width":"any"|"phone"|"desktop"}]}',
  `KINDS. layout = ONLY reordering, hiding, showing or sizing the 14 region cards (ids: ${CARD_IDS.join(", ")}), the same at every width. Moving anything else (the Ask agent, the Lane card, the top bar, a tile), or any placement for one width only (phone, mobile, desktop), is NOT layout.`,
  "read = a question about what the cockpit shows.",
  "change = anything in the cockpit's UI that frontend code can do with the data the client already serves: moving any element, responsive or phone-only or desktop-only layout, restyles, colour, glow, icons, a new face, view, panel, chart, button or search over data already there, a dialog's contents, this Ask panel.",
  "system = ONLY new data or a new action behind the client (a field or resource the cockpit does not serve yet, a new write), or lane, board or model behaviour. The header, top bar, toolbar and every other visible element are frontend: change, never system. An attached image does not make a request system.",
  "board = cancel, archive, pause, resume, backlog or promote an existing board card (cancel means archive): set fa and action. Never file a card about a card.",
  'When a part says "it" or "that", resolve it from the request and from the cards named under it (listed with their titles), and write the resolved thing into text.',
  "title: a short imperative title for change or system, else empty. area (change or system): region = the card grid; panel = this Ask agent panel; dialog = a card's click window; data = what a card reads; page = the cockpit page around the region (top bar, home column, Lane, Budget, Office, the phone layout).",
  "cards: for layout, the region card ids it names. width: phone or desktop when a part is limited to one, else any.",
  "Examples:",
  ...CLASSIFY_EXAMPLES,
].join("\n");

const classifyModel = () => process.env.COCKPIT_CLASSIFY_MODEL || "haiku";

/** The prompt after "--": the request, then the board cards it names with their titles (so "it" can be resolved). Pure. */
export function classifyPrompt(question: string, named: { fa: string; title: string }[] = [], images = 0): string {
  const lines = ["Request: " + question];
  if (images > 0) lines.push(`(with ${images} image${images === 1 ? "" : "s"} attached)`);
  if (named.length) lines.push("Cards named in the request:", ...named.map((n) => `${n.fa}: ${n.title || "(not on the board)"}`));
  return lines.join("\n");
}

/** The argv for one classification: no tools, no MCP, no settings, the request after "--". Pure. */
export function buildClassifyArgs(question: string, named: { fa: string; title: string }[] = [], images = 0): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    classifyModel(),
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--system-prompt",
    CLASSIFY_SYSTEM_PROMPT,
    "--",
    classifyPrompt(question, named, images),
  ];
}

/** A title safe for a board card: one line, no backticks or brackets, at most 48 characters, cut at a word. */
export function cleanTitle(t: unknown): string {
  let s = String(typeof t === "string" ? t : "")
    .replace(/[`\[\]{}<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "");
  if (s.length > 48) {
    const cut = s.slice(0, 48);
    const sp = cut.lastIndexOf(" ");
    s = (sp > 24 ? cut.slice(0, sp) : cut).trim();
  }
  return s;
}

/** "FA-123", "fa 123" or a bare "19211" as FA-n; null otherwise. */
export function normFa(v: unknown): string | null {
  const m = /^\s*(?:fa[-\s]?)?(\d{1,6})\s*$/i.exec(String(v ?? ""));
  return m ? "FA-" + m[1] : null;
}

export function normVerb(v: unknown): BoardVerb | null {
  return VERB_SYNONYMS[String(v ?? "").trim().toLowerCase()] ?? null;
}

/** The board card numbers a request names: FA-n, or a bare 3-6 digit number right after a board verb. */
export function namedFas(q: string): string[] {
  const out = new Set<string>();
  for (const m of q.matchAll(/\bFA-(\d{1,6})\b/gi)) out.add("FA-" + m[1]);
  for (const m of q.matchAll(BOARD_ACT_RE)) out.add("FA-" + m[2]);
  return [...out];
}

/** The verbs a request may write before a card number (narrower than VERB_SYNONYMS: "drop 500" or "close 300" is not a card). */
const VERB_WORDS = "cancel|archive|pause|unpause|resume|promote|backlog";
/** "<verb> [card] [FA-]n": a board action written into the request. */
const BOARD_ACT_RE = new RegExp(`\\b(${VERB_WORDS})\\s+(?:card\\s+|ticket\\s+)?(?:FA-?\\s?)?(\\d{3,6})\\b`, "gi");
/** A part that is nothing but a board action ("Cancel FA-19211."). */
const ONLY_BOARD_ACT = new RegExp(`^\\s*(${VERB_WORDS})\\s+(?:card\\s+|ticket\\s+)?(?:FA-?\\s?)?(\\d{3,6})\\s*[.!]?\\s*$`, "i");

/** The board actions written into a request, deterministically: the safety net for a part the classifier dropped. */
export function boardActsIn(q: string): { fa: string; action: BoardVerb; text: string }[] {
  const out: { fa: string; action: BoardVerb; text: string }[] = [];
  for (const m of q.matchAll(BOARD_ACT_RE)) {
    const action = normVerb(m[1]);
    if (action && !out.some((o) => o.fa === "FA-" + m[2])) out.push({ fa: "FA-" + m[2], action, text: m[0].trim() });
  }
  return out;
}

function cleanPart(o: Record<string, unknown>): AskPart | null {
  const kind = PART_KINDS.includes(o.kind as PartKind) ? (o.kind as PartKind) : null;
  if (!kind) return null;
  const text = typeof o.text === "string" ? o.text.replace(/\s+/g, " ").trim().slice(0, 2000) : "";
  const area = typeof o.area === "string" && o.area in CHANGE_AREAS ? (o.area as ChangeArea) : "region";
  const width: Width = o.width === "phone" || o.width === "desktop" ? o.width : "any";
  const part: AskPart = { kind, text, title: cleanTitle(o.title), area, width };
  if (kind === "board") {
    const fa = normFa(o.fa);
    const action = normVerb(o.action);
    // a board part with no card or no verb cannot be offered: the read run answers it
    if (!fa || !action) return { ...part, kind: "read" };
    part.fa = fa;
    part.action = action;
  }
  if (Array.isArray(o.cards)) part.cards = o.cards.filter((c): c is string => typeof c === "string").slice(0, 14).map((c) => c.trim().toLowerCase());
  return part;
}

/**
 * The parts, reconciled against the request itself (pure): every part has text (the whole request when the model left it out),
 * a board action the request names but the model dropped is added, and a system part that is nothing but a board action is
 * dropped (FA-19213 was a card filed about a card).
 */
export function reconcileParts(question: string, parts: AskPart[]): AskPart[] {
  let out = parts.map((p) => ({ ...p, text: p.text || question }));
  out = out.filter((p) => !(p.kind === "system" && ONLY_BOARD_ACT.test(p.text)));
  for (const b of boardActsIn(question)) {
    if (!out.some((p) => p.kind === "board" && p.fa === b.fa)) out.unshift({ kind: "board", text: b.text, title: "", area: "region", fa: b.fa, action: b.action, width: "any" });
  }
  if (!out.length) out = [{ kind: "read", text: question, title: "", area: "region", width: "any" }];
  return out.slice(0, MAX_PARTS);
}

const fallback = (question: string, detail: string): Classification => {
  const parts = reconcileParts(question, []);
  const lead = parts.find((p) => p.kind !== "board");
  return { kind: "read", title: "", area: "region", parts: lead ? parts : [...parts, { kind: "read", text: question, title: "", area: "region", width: "any" }], ok: false, detail };
};

/** The classification from the CLI's result text: {"parts":[...]} or the older single {"kind",...}. Unreadable answers fall back to read. */
export function parseClassification(text: string, question = ""): Classification {
  const m = /\{[\s\S]*\}/.exec(text || "");
  let o: Record<string, unknown> | null = null;
  if (m) {
    try {
      o = JSON.parse(m[0]);
    } catch {
      o = null;
    }
  }
  const raw: Record<string, unknown>[] = !o ? [] : Array.isArray(o.parts) ? (o.parts as unknown[]).filter((p): p is Record<string, unknown> => !!p && typeof p === "object") : [o];
  const parsed = raw.map(cleanPart).filter((p): p is AskPart => !!p);
  if (!parsed.length) return fallback(question, "unreadable classification: " + firstLine(text || "(empty)"));
  const parts = reconcileParts(question, parsed);
  const lead = parts.find((p) => p.kind !== "board");
  return { kind: lead ? (lead.kind as AskKind) : "read", title: lead?.title ?? "", area: lead?.area ?? "region", parts, ok: true };
}

/** The Classification a single part's path receives (the filer and the apply job read title and area). */
export function partClassification(p: AskPart): Classification {
  return { kind: p.kind === "board" ? "read" : p.kind, title: p.title, area: p.area, parts: [p], ok: true };
}

export async function classify(question: string, named: { fa: string; title: string }[] = [], images = 0): Promise<Classification> {
  const cwd = path.join(os.tmpdir(), "cockpit-agent-cwd");
  await mkdir(cwd, { recursive: true });
  const r = await runCli(buildClassifyArgs(question, named, images), cwd, CLASSIFY_TIMEOUT_MS);
  if (r.spawnError) return fallback(question, r.spawnError);
  if (r.timedOut) return fallback(question, "the classifier timed out");
  let result = "";
  try {
    const p = JSON.parse(r.stdout);
    result = p && typeof p.result === "string" && !p.is_error ? p.result : "";
  } catch {
    result = "";
  }
  if (r.code !== 0 || !result) return fallback(question, firstLine(r.stderr) || `classifier exited ${r.code}`);
  return parseClassification(result, question);
}

/** A placement for one width only: set-layout has one layout for every width. */
const WIDTH_RE = /\b(phones?|mobile|desktop|tablets?|narrow|widths?|small screens?|large screens?|portrait|landscape|responsive|\d{3,4}\s?px)\b/i;
/** Elements outside the 14 region cards (none of the cards' titles holds one of these words). */
const NON_REGION_RE = /\b(ask agent|ask panel|top bar|toolbar|header|lane|budget|office|home column|tiles?|buttons?|panels?|dialogs?|windows?|studio|glance|waiting)\b/i;

/**
 * Whether set-layout can express a layout part (FA-19087 no dead ends): only the 14 region card ids, at every width alike. Anything
 * else escalates to the change path before the layout run starts; the run's own CANNOT_LAYOUT line is the second net. Pure.
 */
export function layoutExpressible(p: Pick<AskPart, "text" | "cards" | "width">): { ok: true } | { ok: false; why: string } {
  if (p.width && p.width !== "any") return { ok: false, why: `it is limited to ${p.width} widths, and set-layout has one layout for every width` };
  const outside = (p.cards ?? []).filter((c) => !(CARD_IDS as readonly string[]).includes(c));
  if (outside.length) return { ok: false, why: `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not one of the 14 region cards set-layout orders` };
  const w = WIDTH_RE.exec(p.text);
  if (w) return { ok: false, why: `it names a width ("${w[0]}"), and set-layout has one layout for every width` };
  const e = NON_REGION_RE.exec(p.text);
  if (e) return { ok: false, why: `it moves "${e[0]}", which is not one of the 14 region cards set-layout orders` };
  return { ok: true };
}
