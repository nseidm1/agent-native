/**
 * The whole board through the cockpit client (FA-19027): the frame (resource
 * board) and every open card (resource board/cards), and one card's detail
 * (resource board/card/<fa>). Nothing here knows where the cockpit is.
 */
import { type BoardCard, type BoardCardDetail, type BoardCardRead, type BoardView, COLUMN_NAMES } from "../../shared/cockpit-board.js";
import { get, getMany, streamConnected } from "./client.js";

type J = any;

const asCard = (c: J): BoardCard => ({
  id: String(c.id || ""),
  fa: c.fa ?? null,
  title: String(c.title || ""),
  column: c.column ?? null,
  priority: c.priority ?? null,
  estimate: typeof c.estimate === "number" ? c.estimate : null,
  parent: c.parent ?? null,
  parentFa: c.parentFa ?? null,
  children: Array.isArray(c.children) ? c.children : [],
  links: Array.isArray(c.links) ? c.links : [],
  paused: !!c.paused,
  triaged: !!c.triaged,
  blocked: Number(c.blocked) || 0,
  chips: Array.isArray(c.chips) ? c.chips : [],
  app: c.app ?? null,
  laneStage: c.laneStage ?? null,
  at: c.at ?? null,
});

export async function getBoard(): Promise<BoardView> {
  const r = await getMany(["board", "board/cards"]);
  const frame = r.data["board"] || {};
  const list = r.data["board/cards"] || {};
  const cards: BoardCard[] = (Array.isArray(list.cards) ? list.cards : []).map(asCard);
  const counts: Record<string, number> = frame.counts && typeof frame.counts === "object" ? frame.counts : {};
  const ids: string[] = Array.isArray(frame.columns) && frame.columns.length
    ? frame.columns.map((c: J) => String(c.id))
    : Array.isArray(list.columns) ? list.columns.filter((c: string) => c !== "archived") : Object.keys(COLUMN_NAMES);
  const names: Record<string, string> = Object.fromEntries((Array.isArray(frame.columns) ? frame.columns : []).map((c: J) => [String(c.id), String(c.name || c.id)]));
  const columns = ids.map((id) => ({ id, name: names[id] || COLUMN_NAMES[id] || id, count: typeof counts[id] === "number" ? counts[id] : cards.filter((c) => c.column === id).length }));
  const err = frame.err ? String(frame.err) : "";
  return {
    at: typeof frame.at === "number" ? frame.at : r.at,
    ok: r.ok && !err,
    error: err ? "the board did not answer: " + err : r.ok ? undefined : r.errors[0],
    live: streamConnected(),
    columns,
    cards,
    total: typeof list.total === "number" ? list.total : cards.length,
    archived: typeof counts.archived === "number" ? counts.archived : null,
    releasedCount: typeof frame.releasedCount === "number" ? frame.releasedCount : null,
  };
}

export async function getBoardCard(fa: string): Promise<BoardCardRead> {
  try {
    const r = await get<J>("board/card/" + fa);
    const d = r.data || {};
    const card: BoardCardDetail = {
      ...asCard(d),
      body: String(d.body || ""),
      notes: String(d.notes || ""),
      notesLength: Number(d.notesLength) || 0,
      notesTruncated: !!d.notesTruncated,
      questions: Array.isArray(d.questions) ? d.questions : [],
      sections: Array.isArray(d.sections) ? d.sections : [],
    };
    return { ok: r.ok, error: r.error, at: r.at, card };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now(), card: null };
  }
}
