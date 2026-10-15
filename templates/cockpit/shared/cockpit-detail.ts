/**
 * The detail model behind a card's click window: what get-card-detail returns
 * and the dialog renders. Built server-side from the cockpit client's
 * resources (server/cockpit/client.ts), so the page stays a generic renderer. Bounded: at most DETAIL_MAX_ROWS rows
 * per table or list and DETAIL_MAX_CHARS characters per string.
 */
import type { CardId, Tone } from "./cockpit.js";

export const DETAIL_MAX_ROWS = 200;
export const DETAIL_MAX_CHARS = 300;

/**
 * The cockpit actions (manifest names) each dialog write runs through the
 * client; orphan and release are families (orphans.land / .discard / .hand,
 * release.now / .auto). Checked against the manifest by
 * server/cockpit/manifest-parity.spec.ts.
 */
export const COCKPIT_ACTIONS = {
  "job-start": "jobs.start",
  "job-stop": "jobs.stop",
  orphan: "orphans",
  release: "release",
  "funnel-on": "appkpis.funnelOn",
  "board-card": "board.cardAction",
  "halo-model": "halo.setModel",
} as const;
/** Every manifest action name a dialog can run. */
export const COCKPIT_ACTION_NAMES_USED = [
  "jobs.start",
  "jobs.stop",
  "orphans.land",
  "orphans.discard",
  "orphans.hand",
  "release.now",
  "release.auto",
  "appkpis.funnelOn",
  "board.cardAction",
  "halo.setModel",
] as const;

/**
 * The writes a dialog can offer. Each is its own POST action that runs the
 * cockpit action above through the client and answers loopback callers only.
 */
export const WRITE_ACTIONS = {
  "job-start": "cockpit-job-start",
  "job-stop": "cockpit-job-stop",
  orphan: "cockpit-orphan-action",
  release: "cockpit-release-landed",
  "funnel-on": "cockpit-funnel-on",
  "board-card": "cockpit-board-card-action",
  "halo-model": "cockpit-halo-model",
} as const;
export type WriteKind = keyof typeof WRITE_ACTIONS;
export const WRITE_ACTION_NAMES = Object.values(WRITE_ACTIONS);

export interface DetailAction {
  kind: WriteKind;
  label: string;
  args: Record<string, unknown>;
  /** Asked before sending; the button does nothing until confirmed. */
  confirm?: string;
  /** A field the viewer fills in, sent as args[input.name]. */
  input?: { name: string; label: string; options?: string[]; required?: boolean };
  danger?: boolean;
}

export type DetailCell = string | { t: string; tone?: Tone; mono?: boolean; title?: string };

export interface DetailRow {
  cells: DetailCell[];
  tone?: Tone;
  /** Matched by the dialog's client-side filter (events). */
  tag?: string;
  /** A second, quieter line under the row. */
  note?: string;
  actions?: DetailAction[];
  /** The text the dialog's search matches (a board card's FA id and title); a row without it never matches a search. */
  find?: string;
}

export interface DetailStat {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}

export interface DetailItem {
  text: string;
  strong?: string;
  tone?: Tone;
  tag?: string;
  actions?: DetailAction[];
}

export interface DetailSection {
  title: string;
  sub?: string;
  kind: "stats" | "table" | "list" | "text";
  stats?: DetailStat[];
  columns?: string[];
  /** Which columns are numbers (right-aligned). */
  numeric?: number[];
  rows?: DetailRow[];
  items?: DetailItem[];
  text?: string;
  /** Rows or items left out by the cap. */
  more?: number;
  /** Shown collapsed (details/summary). */
  collapsed?: boolean;
  /** An empty table or list says this instead. */
  empty?: string;
}

export interface DetailFilter {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  /** true: changing it refetches with the value as an argument; false: filters rows by tag in the dialog. */
  server: boolean;
}

export interface JobForm {
  kinds: { id: string; label: string; does: string }[];
}

export interface CardDetail {
  id: CardId;
  title: string;
  tone: Tone;
  headline: string;
  sub: string;
  chips: { t: string; tone?: Tone }[];
  at: number;
  ok: boolean;
  error?: string;
  lead?: string;
  filters?: DetailFilter[];
  /** Whole-dialog writes (release now, auto-release, funnel on). */
  actions?: DetailAction[];
  jobForm?: JobForm;
  /** A search field at the top of the dialog, filtering table rows by their find text. */
  search?: DetailSearch;
  sections: DetailSection[];
}

export interface DetailSearch {
  label: string;
  placeholder: string;
}

/** Lower case with spaces, dashes and underscores dropped, so "FA 18951", "fa-18951" and "18951" all find FA-18951. */
export const searchKey = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/** True when the row's find text holds the query (empty query: every row). */
export function rowMatches(row: DetailRow, query: string): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return !!row.find && searchKey(row.find).includes(q);
}

/**
 * The sections a search leaves: table rows that match, a section with no match
 * dropped, and a collapsed section opened (a match hidden in a closed Released
 * group would read as no match). An empty query returns the sections unchanged.
 */
export function searchSections(sections: DetailSection[], query: string): { sections: DetailSection[]; matches: number } {
  if (!searchKey(query)) return { sections, matches: -1 };
  let matches = 0;
  const out: DetailSection[] = [];
  for (const s of sections) {
    if (s.kind !== "table") continue;
    const rows = (s.rows || []).filter((r) => rowMatches(r, query));
    if (!rows.length) continue;
    matches += rows.length;
    out.push({ ...s, rows, collapsed: false, more: undefined, sub: rows.length + " of " + (s.rows || []).length + " match" });
  }
  return { sections: out, matches };
}
