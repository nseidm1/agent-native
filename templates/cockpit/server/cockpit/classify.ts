/**
 * Which path an Ask agent request takes (console 2026-10-15: "Ask agent
 * answers layout questions as it does now. When you ask for a change ... it
 * files a board card with your request and any images you attached, and
 * replies with the card number ... so nothing runs code straight from the
 * panel").
 *
 * One short call to the Mac's Claude CLI with NO tools at all (--tools "",
 * --strict-mcp-config with no config, no setting sources, dontAsk), returning
 * {"kind":"layout"|"read"|"change","title","area"} as JSON. The answer only
 * picks a path: layout and read go to the existing agent run (four region
 * tools, nothing else); change goes to request-card.ts, which files a card and
 * never edits, builds or runs anything.
 */
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { firstLine, runCli } from "./agent.js";

export type AskKind = "layout" | "read" | "change";
export const ASK_KINDS: readonly AskKind[] = ["layout", "read", "change"];

/** Where a change would land; the request card's CHANGE line names the file. */
export const CHANGE_AREAS = {
  region: { file: "templates/cockpit/app/components/cockpit/CardRegion.tsx", symbol: "CardRegion", fork: true },
  panel: { file: "templates/cockpit/app/components/cockpit/CardRegion.tsx", symbol: "AskPanel", fork: true },
  dialog: { file: "templates/cockpit/app/components/cockpit/CardDialog.tsx", symbol: "CardDialog", fork: true },
  data: { file: "templates/cockpit/server/cockpit/detail.ts", symbol: "buildDetail", fork: true },
  page: { file: "tools/lane/maint/ui/index.html", symbol: "cardAction", fork: false },
} as const;
export type ChangeArea = keyof typeof CHANGE_AREAS;

export interface Classification {
  kind: AskKind;
  /** A short card title for a change (sanitized, at most 48 characters). */
  title: string;
  area: ChangeArea;
  /** false when the CLI failed or answered something unreadable; the safe default (read) was used. */
  ok: boolean;
  detail?: string;
}

export const CLASSIFY_TIMEOUT_MS = 30_000;
export const CLASSIFY_SYSTEM_PROMPT = [
  "You route requests typed into the Ask agent panel of a cockpit's status-card region. You never act on the request; you only classify it.",
  'Reply with ONE line of JSON and nothing else: {"kind":"layout"|"read"|"change","title":"<at most 48 characters>","area":"region"|"panel"|"dialog"|"data"|"page"}.',
  "kind: layout = move, reorder, hide, show or resize the existing cards; read = a question about what the cards or their windows show;",
  "change = anything that needs new or different code: a new feature, button, field, search, style, behaviour, data source, or a change to the cockpit page.",
  "title: a short imperative card title for a change (e.g. 'Search field in the Board card dialog'), else empty.",
  "area (for a change): region = the card grid; panel = this Ask agent panel; dialog = a card's click window; data = what a card or window reads;",
  "page = the cockpit page around the region (its toolbar, header, other panels, tools/lane/maint/ui). Use region when unsure.",
].join(" ");

const classifyModel = () => process.env.COCKPIT_CLASSIFY_MODEL || "haiku";

/** The argv for one classification: no tools, no MCP, no settings, the request after "--". Pure. */
export function buildClassifyArgs(question: string): string[] {
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
    "Request: " + question,
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

/** The classification from the CLI's result text. Unreadable or unknown answers fall back to read (the run that cannot change code). */
export function parseClassification(text: string): Classification {
  const m = /\{[\s\S]*\}/.exec(text || "");
  let o: Record<string, unknown> | null = null;
  if (m) {
    try {
      o = JSON.parse(m[0]);
    } catch {
      o = null;
    }
  }
  const kind = o && ASK_KINDS.includes(o.kind as AskKind) ? (o.kind as AskKind) : null;
  if (!o || !kind) return { kind: "read", title: "", area: "region", ok: false, detail: "unreadable classification: " + firstLine(text || "(empty)") };
  const area = typeof o.area === "string" && o.area in CHANGE_AREAS ? (o.area as ChangeArea) : "region";
  return { kind, title: cleanTitle(o.title), area, ok: true };
}

export async function classify(question: string): Promise<Classification> {
  const cwd = path.join(os.tmpdir(), "cockpit-agent-cwd");
  await mkdir(cwd, { recursive: true });
  const r = await runCli(buildClassifyArgs(question), cwd, CLASSIFY_TIMEOUT_MS);
  if (r.spawnError) return { kind: "read", title: "", area: "region", ok: false, detail: r.spawnError };
  if (r.timedOut) return { kind: "read", title: "", area: "region", ok: false, detail: "the classifier timed out" };
  let result = "";
  try {
    const p = JSON.parse(r.stdout);
    result = p && typeof p.result === "string" && !p.is_error ? p.result : "";
  } catch {
    result = "";
  }
  if (r.code !== 0 || !result) return { kind: "read", title: "", area: "region", ok: false, detail: firstLine(r.stderr) || `classifier exited ${r.code}` };
  return parseClassification(result);
}
