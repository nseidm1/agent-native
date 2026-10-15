/**
 * FA-19131: the commit queue, ported from the legacy qvDlg (tools/lane/maint/ui/index.html, THE QUEUE VIEW): the cockpit's
 * own queue-view text (queued sets with their true state, today's landings) shown whole, in a monospace block. Read from
 * the client resource queueview ({ view, text }); the headline counts come from view.
 */
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type QueueView = { view?: { queued?: unknown[]; landed?: unknown[] } | null; text?: string | null; error?: string };
/** The text is shown whole; a bound keeps one runaway reading from flooding the page. */
export const QUEUE_TEXT_MAX = 20_000;
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

/** The pure half: the queueview resource -> the window. */
export function queueWindow(v: QueueView | null, at: number, ok: boolean, error?: string): WindowDetail {
  const text = v && typeof v.text === "string" && v.text ? v.text : "";
  const q = v && v.view && Array.isArray(v.view.queued) ? v.view.queued.length : null,
    l = v && v.view && Array.isArray(v.view.landed) ? v.view.landed.length : null;
  const body = text
    ? text.length > QUEUE_TEXT_MAX
      ? text.slice(0, QUEUE_TEXT_MAX) + "\n… (cut at " + QUEUE_TEXT_MAX + " characters)"
      : text
    : "The queue view is not available: " + ((v && v.error) || error || "no text in the reading");
  return {
    id: "queue",
    title: "Commit queue and landed today",
    tone: q ? "a" : text ? "g" : "d",
    headline: q == null ? "" : (q ? pl(q, "set") + " queued for commit" : "Nothing queued for commit") + (l == null ? "" : " · " + l + " landed today"),
    sub: "",
    chips: [],
    at,
    ok: ok && !!text,
    error,
    sections: [{ title: "Queued sets and today's landings", kind: "text", text: body }],
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<QueueView>("queueview", { fresh: true });
    return queueWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return queueWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
