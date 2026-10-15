/**
 * FA-19126: Message master, ported from the legacy msgDlg (tools/lane/maint/ui/index.html, the MESSAGE MASTER AS A TEXT THREAD
 * script): the thread with master (the console's messages and master's replies, whole, oldest first, newest last), whether
 * master answers now, and the composer. The thread and composer are the window's part (app/components/cockpit/windows/
 * MasterPart.tsx), which reads the messages from `part`, sends with master.send optimistically, and marks the replies seen
 * (localStorage msgSeen) exactly as the legacy dialog does, so the header's unread count clears.
 */
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

export type MasterMessage = { id: string; at: string; side: "me" | "re"; text: string; via?: string | null; from?: string | null; readAt?: string | null; answered?: boolean; re?: string };
type Master = {
  thread?: { messages?: MasterMessage[]; hasMore?: boolean } | null;
  replies?: { id?: string; at?: string | number; text?: string }[];
  sent?: { id?: string; at?: string; text?: string }[];
  live?: boolean;
};
/** What MasterPart reads. */
export type MasterPartData = { messages: MasterMessage[]; hasMore: boolean; live: boolean; seenAt: number };

const T = (x: unknown) => {
  const t = typeof x === "number" ? x : Date.parse(String(x ?? ""));
  return isNaN(t) ? 0 : t;
};

/** legacy list(): the thread oldest first; at one instant the console's message before master's reply */
export function threadOf(v: Master | null): MasterMessage[] {
  if (!v) return [];
  const raw: MasterMessage[] = v.thread
    ? (v.thread.messages || []).filter((m) => m && m.id)
    : [
        ...(v.sent || []).map((x) => ({ ...x, side: "me" as const }) as MasterMessage),
        ...(v.replies || []).map((x) => ({ ...x, side: "re" as const }) as MasterMessage),
      ]; // an older server: no thread, its sent and replies
  const byId = new Map<string, MasterMessage>();
  for (const m of raw) byId.set(m.id, { id: m.id, at: String(m.at ?? ""), side: m.side === "re" ? "re" : "me", text: String(m.text ?? ""), via: m.via ?? null, from: m.from ?? null, readAt: m.readAt ?? null, answered: !!m.answered });
  return [...byId.values()].sort((a, b) => T(a.at) - T(b.at) || (a.side === b.side ? 0 : a.side === "me" ? -1 : 1));
}

/** The pure half: the master resource -> the window (exported for its spec). */
export function masterWindow(v: Master | null, at: number, ok: boolean, error?: string): WindowDetail {
  const messages = threadOf(v);
  const live = !!(v && v.live);
  const seenAt = Math.max(0, ...((v && v.replies) || []).map((r) => T(r.at)));
  const part: MasterPartData = { messages, hasMore: !!(v && v.thread && v.thread.hasMore), live, seenAt };
  return {
    id: "master",
    title: "Message master",
    tone: !v ? "d" : live ? "g" : "a",
    headline: !v ? "Reading the thread…" : live ? "Answers within a minute" : "Replies when master is back",
    sub: !v ? "" : messages.length ? "The newest " + messages.length + " message" + (messages.length === 1 ? "" : "s") + " with master, newest last." : "No messages yet.",
    chips: [],
    at,
    ok,
    error,
    sections: [],
    part,
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<Master>("master", { fresh: true });
    return masterWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return masterWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
