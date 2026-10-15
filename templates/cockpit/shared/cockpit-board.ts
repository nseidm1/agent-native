/**
 * The whole board as the card region renders it (FA-19027): every column and
 * every open card, read through the cockpit client (resources board and
 * board/cards), and one card's detail (resource board/card/<fa>). Pure types
 * and rules, shared by the actions (server) and the board view (client).
 */
import type { DetailAction } from "./cockpit-detail.js";

export interface BoardLink {
  type: string;
  to: string;
}

/** One card's face, in the client's own field names. */
export interface BoardCard {
  id: string;
  fa: string | null;
  title: string;
  column: string | null;
  priority: string | null;
  estimate: number | null;
  parent: string | null;
  parentFa: string | null;
  children: string[];
  links: BoardLink[];
  paused: boolean;
  triaged: boolean;
  blocked: number;
  chips: string[];
  app: string | null;
  laneStage: string | null;
  at: string | number | null;
}

export interface BoardColumn {
  id: string;
  name: string;
  /** the board's own count for the column (Released counts more than the cards it lists) */
  count: number;
}

export interface BoardView {
  at: number;
  ok: boolean;
  error?: string;
  /** true while the client's change stream is connected */
  live: boolean;
  columns: BoardColumn[];
  cards: BoardCard[];
  total: number;
  archived: number | null;
  releasedCount: number | null;
}

export interface BoardCardDetail extends BoardCard {
  body: string;
  notes: string;
  notesLength: number;
  notesTruncated: boolean;
  questions: unknown[];
  sections: unknown[];
}

export interface BoardCardRead {
  ok: boolean;
  error?: string;
  at: number;
  card: BoardCardDetail | null;
}

export const COLUMN_NAMES: Record<string, string> = {
  pending: "Backlog",
  recommendations: "Recommendations",
  todo: "To do",
  reopened: "Reopened",
  "in-progress": "In progress",
  "release-ready": "Release ready",
  released: "Released",
};

/** The writes a card offers, the same rule the Board window has always used (MI-157: every FA card can be archived). */
export function boardCardActions(c: Pick<BoardCard, "fa" | "column" | "paused">): DetailAction[] {
  const fa = String(c.fa || "");
  if (!/^FA-\d{1,6}$/.test(fa)) return [];
  const acts: DetailAction[] = [];
  if (c.column === "in-progress" && !c.paused) acts.push({ kind: "board-card", label: "Pause", args: { fa, action: "pause" }, confirm: "Pause " + fa + "? It moves to Reopened until resumed." });
  if (c.paused) acts.push({ kind: "board-card", label: "Resume", args: { fa, action: "resume" }, confirm: "Resume " + fa + "? It goes to To do, where the dispatcher draws it." });
  if (c.column === "recommendations") {
    acts.push({ kind: "board-card", label: "Backlog", args: { fa, action: "backlog" }, confirm: "Move " + fa + " to Backlog?" });
    acts.push({ kind: "board-card", label: "Promote", args: { fa, action: "promote" }, confirm: "Promote " + fa + " to To do?" });
  }
  if (c.column !== "archived") acts.push({ kind: "board-card", label: "Archive", args: { fa, action: "archive" }, confirm: "Archive " + fa + "? It moves to Archived; nothing is deleted.", danger: true });
  return acts;
}

/** Whether a card matches a search: every word of the query appears in its FA id, title, app or chips. Pure. */
export function boardMatch(c: BoardCard, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [c.fa || "", c.title, c.app || "", c.parentFa || "", ...c.chips].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
