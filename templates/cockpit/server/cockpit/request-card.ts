/**
 * A "change" asked in the Ask agent panel becomes a board card, never an edit
 * (console 2026-10-15: "it files a board card with your request and any
 * images you attached, and replies with the card number. That card then gets
 * built, Playwright-checked and deployed through the normal path, so nothing
 * runs code straight from the panel").
 *
 * The card is filed by the parent repo's own filer, node
 * tools/lane/file-card.mjs <batch.json>, run from the repo root with an argv
 * array (never a shell string). The request is quoted verbatim in the note,
 * except that the filer's runner skip words and backticks are swapped for
 * plain words (the filer refuses them). Attached images go onto the card
 * through the board's own /api/attach (loopback); if the board cannot take
 * them they are saved under .tmp/lane/maint/run/ask-attachments/<FA>/ and the
 * paths are added to the card's note.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AskImageType } from "../../shared/ask-images.js";
import { AgentError, dataDir, firstLine } from "./agent.js";
import { CHANGE_AREAS, type Classification, cleanTitle } from "./classify.js";

export const FILE_CARD_TIMEOUT_MS = 120_000;
export const REQUEST_NOTE_MAX = 2000;
export const PARENT_CARD = "FA-18951";
/** The prefix every request card's title carries (the filer caps titles at 56). */
export const TITLE_PREFIX = "Cockpit region: ";

export const portfolioDir = () => path.resolve(process.env.COCKPIT_PORTFOLIO_DIR || path.join(process.cwd(), "..", "..", "..", ".."));
const boardUrl = () => (process.env.COCKPIT_BOARD_URL || "http://127.0.0.1:5199").replace(/\/$/, "");

/** The filer's skip words (tools/lane/file-card-check.mjs SKIP_SWAPS), swapped for the same plain words it suggests. */
const SKIP_SWAPS: [RegExp, string][] = [
  [/`/g, "'"],
  [/\[needs a human\]/gi, "(needs the console)"],
  [/\bUMBRELLA\b/gi, "parent"],
  [/do not execute/gi, "do not run"],
  [/superseded/gi, "replaced"],
  [/NOT ARMABLE/gi, "not yet armed"],
  [/^HOLD: /gim, "On hold: "],
];
export function plainText(s: string): string {
  return SKIP_SWAPS.reduce((t, [re, to]) => t.replace(re, to), String(s)).replace(/\s+/g, " ").trim();
}

export interface RequestCard {
  id: string;
  title: string;
  outcome: string;
  change: string;
  note: string;
  priority: "normal";
  estimate: 5;
}

/** The batch entry for one request. Pure, so the shape is testable without filing. */
export function buildRequestCard(question: string, cls: Pick<Classification, "title" | "area">, opts: { at: string; images: number }): RequestCard {
  const q = plainText(question).slice(0, REQUEST_NOTE_MAX);
  const short = cleanTitle(cls.title) || cleanTitle(q) || "change request from Ask agent";
  const title = (TITLE_PREFIX + short).slice(0, 56).trim();
  const area = CHANGE_AREAS[cls.area] ?? CHANGE_AREAS.region;
  const where = area.fork
    ? "the work is in the fork nseidm1/agent-native, branch cockpit-region, file " + area.file + ":" + area.symbol
    : "the work is in " + area.file + ":" + area.symbol + " itself (the cockpit page, outside the card region app)";
  const change =
    "CHANGE: tools/lane/maint/ui/index.html:cardAction is where the cockpit opens the card region; " +
    where +
    ", which gains the requested change (" +
    short +
    "); GREEN when the change is visible in the live region through 127.0.0.1:5207 and Playwright passes at 1280 and 390 with no console errors and no sideways scroll";
  const note =
    "REQUEST (console, via the cockpit card region's Ask agent panel, " +
    opts.at +
    ', verbatim): "' +
    q +
    '". Filed by the region (' +
    PARENT_CARD +
    "): a change asked in the panel is never executed from the panel; this card is built, Playwright-checked and deployed through the normal path." +
    (opts.images ? " Images: " + opts.images + " attached by the console with the request." : "");
  return {
    id: "req",
    title,
    outcome: "The cockpit card region does what the console asked: " + short,
    change,
    note,
    priority: "normal",
    estimate: 5,
  };
}

/**
 * The filer's environment: the user's basics only, never this server's own. The region server runs with PORT=5241
 * (and HOST, APP_BASE_PATH, ...); the board CLI reads PORT as the board's port, so an inherited one sent the filer's
 * note and priority writes to this app instead of the board (FA-19010 was filed with neither). Pure, so it is tested.
 */
export const FILER_ENV_KEYS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TERM", "TZ"] as const;
export function filerEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of FILER_ENV_KEYS) if (from[k] !== undefined) env[k] = from[k];
  return env;
}

interface ExecOut {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function run(file: string, args: string[], cwd: string, timeout: number): Promise<ExecOut> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env: filerEnv(), timeout, maxBuffer: 2_000_000 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
      resolve({
        code: e ? (typeof e.code === "number" ? e.code : null) : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: e ? (e.killed ? `timed out after ${timeout / 1000} s` : e.message) : undefined,
      });
    });
  });
}

/** The board's card id (a title slug) for an FA number, read from the board's own state file. */
async function boardIdOf(root: string, fa: string): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    try {
      const st = JSON.parse(await readFile(path.join(root, "tools", "board", "board.json"), "utf8"));
      const hit = Object.entries((st && st.tickets) || {}).find(([, v]) => v === fa);
      if (hit) return hit[0];
    } catch {
      // the board rewrites the file; read again
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export interface DecodedImage {
  bytes: Buffer;
  ext: string;
  type: AskImageType;
}

export interface FiledRequest {
  fa: string;
  title: string;
  /** "board": on the card; "folder": saved beside the lane state and named in the note; "none": no images. */
  attached: "board" | "folder" | "none";
  images: string[];
}

export async function fileRequestCard(question: string, cls: Classification, images: DecodedImage[]): Promise<FiledRequest> {
  const root = portfolioDir();
  const filer = path.join(root, "tools", "lane", "file-card.mjs");
  if (!existsSync(filer)) throw new AgentError(`The card filer is not at ${filer}; nothing was filed.`);
  const card = buildRequestCard(question, cls, { at: new Date().toISOString(), images: images.length });
  const dir = path.join(dataDir(), "requests");
  await mkdir(dir, { recursive: true });
  const batch = path.join(dir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
  await writeFile(batch, JSON.stringify([card], null, 1) + "\n");
  const r = await run(process.execPath, [filer, batch], root, FILE_CARD_TIMEOUT_MS);
  let fa = "";
  try {
    const ids = JSON.parse(await readFile(batch.replace(/\.json$/, "") + ".ids.json", "utf8"));
    fa = typeof ids.req === "string" ? ids.req : "";
  } catch {
    fa = "";
  }
  if (!/^FA-\d{1,6}$/.test(fa)) {
    const why = (r.stdout + "\n" + r.stderr)
      .split("\n")
      .map((x) => x.trim())
      .filter((x) => /REFUSED|NOT FILED|error|Error/.test(x))
      .slice(0, 3)
      .join(" ");
    throw new AgentError("The change request was not filed: " + (why || r.error || firstLine(r.stderr) || `the filer exited ${r.code}`));
  }
  if (!images.length) return { fa, title: card.title, attached: "none", images: [] };

  const names = images.map((im, i) => `ask-request-${i + 1}.${im.ext}`);
  // on the card itself, through the board's loopback attach route
  const id = await boardIdOf(root, fa);
  if (id) {
    let ok = 0;
    for (let i = 0; i < images.length; i++) {
      try {
        const res = await fetch(boardUrl() + "/api/attach", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, name: names[i], dataUrl: `data:${images[i].type};base64,${images[i].bytes.toString("base64")}` }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) ok++;
      } catch {
        // falls through to the folder
      }
    }
    if (ok === images.length) return { fa, title: card.title, attached: "board", images: names };
  }
  // the board could not take them: saved beside the lane state, and the card's note names the paths
  const folder = path.join(root, ".tmp", "lane", "maint", "run", "ask-attachments", fa);
  await mkdir(folder, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const p = path.join(folder, names[i]);
    await writeFile(p, images[i].bytes);
    paths.push(path.relative(root, p));
  }
  await run(process.execPath, [path.join(root, "tools", "board", "cli.mjs"), "note", fa, "IMAGES attached to the request: " + paths.join(", ")], root, 30_000);
  return { fa, title: card.title, attached: "folder", images: paths };
}
