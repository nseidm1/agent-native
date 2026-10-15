/**
 * The detail model behind a card's click window: what get-card-detail returns
 * and the dialog renders. Built server-side from the cockpit's full state, so
 * the client stays a generic renderer. Bounded: at most DETAIL_MAX_ROWS rows
 * per table or list and DETAIL_MAX_CHARS characters per string.
 */
import type { CardId, Tone } from "./cockpit.js";

export const DETAIL_MAX_ROWS = 200;
export const DETAIL_MAX_CHARS = 300;

/**
 * The writes a dialog can offer. Each is its own POST action that forwards to
 * the cockpit (127.0.0.1:5217) and answers loopback callers only.
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
  sections: DetailSection[];
}
