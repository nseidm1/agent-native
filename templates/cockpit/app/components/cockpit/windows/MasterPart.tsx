import { useActionMutation } from "@agent-native/core/client/hooks";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MasterMessage, MasterPartData } from "../../../../server/cockpit/windows/master";
import { READ_ONLY } from "../CardDialog";
import type { WindowPartProps } from "./index";
import "./master-part.css";

const LIMIT = 4000;
const GAP = 10 * 60e3;
/** The header's unread count reads this key (TopBar); the legacy page uses the same one. */
export const SEEN_KEY = "msgSeen";
export const SEEN_EVENT = "cf-msgseen";

const T = (x: unknown) => {
  const t = Date.parse(String(x ?? ""));
  return isNaN(t) ? 0 : t;
};
const hm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** legacy dayLabel(): Today / Yesterday / weekday / date, then the time */
function dayLabel(t: number) {
  const d = new Date(t);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const k = Math.round((day(now) - day(d)) / 864e5);
  return (
    (k === 0
      ? "Today"
      : k === 1
        ? "Yesterday"
        : k < 7
          ? d.toLocaleDateString([], { weekday: "long" })
          : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })) +
    " " +
    hm(d)
  );
}
/** URLs become links; everything else stays text (pre-wrap keeps the lines) */
function linkify(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push(s.slice(i, m.index));
    out.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer">
        {m[0]}
      </a>,
    );
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

type Local = { lid: string; text: string; at: string; state: "sending" | "failed" | "sent"; why?: string; id?: string };
type Row = MasterMessage & { local?: Local };

/**
 * FA-19126: the Message master thread and composer, ported from the legacy msgDlg: bubbles (yours right, master's left), a time
 * line where ten minutes pass, "Sent by" for a message another sender filed, Sent / Read under your latest until master answers,
 * the typing dots while master is live and owes an answer, newest last and scrolled to the end. Sending is optimistic: the bubble
 * shows at once as Sending…, a failed one says Not delivered with Retry. Opening the window marks master's replies seen
 * (localStorage msgSeen = the newest reply's time), exactly as the legacy dialog does, so the header's unread count clears.
 */
export function MasterPart({ d, canWrite, onDone }: WindowPartProps) {
  const p = (d.part || {}) as unknown as MasterPartData;
  const server = useMemo(() => p.messages || [], [p.messages]);
  const [local, setLocal] = useState<Local[]>([]);
  const [text, setText] = useState("");
  const [stat, setStat] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const txt = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const send = useActionMutation<{ ok: boolean; answer?: any }, { text: string }>("cockpit-master-send", { timeoutMs: 60_000 });

  // the replies are seen while the thread is open (legacy load(): msgSeen = the newest reply's time); TopBar re-reads it
  useEffect(() => {
    if (!p.seenAt) return;
    try {
      if (Number(window.localStorage.getItem(SEEN_KEY) || 0) !== p.seenAt) window.localStorage.setItem(SEEN_KEY, String(p.seenAt));
    } catch {
      /* private mode: the count stays */
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, [p.seenAt]);

  // a sent bubble gives way to the server's copy once the thread carries it
  const ids = useMemo(() => new Set(server.map((m) => m.id)), [server]);
  useEffect(() => {
    setLocal((ls) => {
      const keep = ls.filter((l) => !(l.state === "sent" && (ids.has(l.id || "") || server.some((m) => m.side === "me" && m.text === l.text && T(m.at) >= T(l.at) - 60e3))));
      return keep.length === ls.length ? ls : keep;
    });
  }, [ids, server]);

  const rows: Row[] = [...server, ...local.map((l) => ({ id: l.id || l.lid, at: l.at, side: "me" as const, text: l.text, local: l }))];

  useLayoutEffect(() => {
    const el = log.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current || atBottom) el.scrollTop = el.scrollHeight;
    stick.current = false;
  });
  useEffect(() => {
    stick.current = true;
    if (canWrite) txt.current?.focus({ preventScroll: true });
  }, [canWrite]);

  const grow = () => {
    const t = txt.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(140, t.scrollHeight + 2) + "px";
  };
  async function deliver(item: Local) {
    stick.current = true;
    setStat("");
    setLocal((ls) => ls.map((l) => (l.lid === item.lid ? { ...l, state: "sending", why: undefined } : l)));
    try {
      const r = await send.mutateAsync({ text: item.text });
      const a = r && r.answer;
      const id = a && typeof a === "object" ? String(a.id || (a.message && a.message.id) || "") : "";
      setLocal((ls) => ls.map((l) => (l.lid === item.lid ? { ...l, state: "sent", id: id || undefined } : l)));
      onDone();
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
      setLocal((ls) => ls.map((l) => (l.lid === item.lid ? { ...l, state: "failed", why } : l)));
      setStat("Not delivered: " + why);
    }
  }
  function submit() {
    const t = text.trim();
    if (!t || t.length > LIMIT || !canWrite) return;
    const item: Local = { lid: "l" + Date.now(), text: t, at: new Date().toISOString(), state: "sending" };
    setLocal((ls) => [...ls, item]);
    setText("");
    requestAnimationFrame(grow);
    void deliver(item);
  }

  // legacy render(): the console's latest message carries its delivery state until master's answer follows
  const brk = rows.map((m, i) => i === 0 || T(m.at) - T(rows[i - 1].at) > GAP);
  const key = (m: Row) => m.side + "|" + (m.from || "");
  let mine = -1;
  for (let i = rows.length - 1; i >= 0; i--)
    if (rows[i].side === "me" && !rows[i].from) {
      mine = i;
      break;
    }
  const answered = mine >= 0 && rows.slice(mine + 1).some((m) => m.side === "re");
  const typing = p.live && mine >= 0 && !answered && !rows[mine].local && Date.now() - T(rows[mine].at) < 30 * 60e3;
  const n = text.length;
  return (
    <section className="cf-mm" aria-label="Messages with master">
      <div className="cf-mm-log" ref={log} role="log" aria-live="polite" aria-label="Messages with master, oldest first" data-testid="cf-mm-log">
        <div className="cf-mm-old">
          {p.hasMore ? "Earlier messages are not paged here yet: the legacy page's Message master scrolls back to them." : rows.length ? "The start of your messages with master" : "No messages yet. Ask master anything about the lane."}
        </div>
        {rows.map((m, i) => {
          const first = brk[i] || key(rows[i - 1]) !== key(m);
          const last = i === rows.length - 1 || brk[i + 1] || key(rows[i + 1]) !== key(m);
          const st = m.local ? m.local.state : "";
          return (
            <Fragment key={m.local ? m.local.lid : m.id}>
              {brk[i] ? <div className="cf-mm-time">{dayLabel(T(m.at))}</div> : null}
              {first && m.from ? <div className="cf-mm-from">{"Sent by " + m.from}</div> : null}
              <div
                className={["cf-mm-bub", m.side, first ? "first" : "", last ? "last" : "", st].filter(Boolean).join(" ")}
                title={(m.side === "re" ? "Master" : m.from ? m.from : "You" + (m.via ? " from " + m.via : "")) + " · " + dayLabel(T(m.at))}
                data-side={m.side}
              >
                {linkify(m.text)}
              </div>
              {m.local && m.local.state === "failed" ? (
                <div className="cf-mm-del bad">
                  Not delivered
                  <button type="button" onClick={() => void deliver(m.local!)} disabled={!canWrite}>
                    Retry
                  </button>
                </div>
              ) : m.local && m.local.state === "sending" ? (
                <div className="cf-mm-del">Sending…</div>
              ) : i === mine && !answered ? (
                <div className="cf-mm-del">{m.readAt ? "Read " + hm(new Date(T(m.readAt))) : "Sent"}</div>
              ) : null}
            </Fragment>
          );
        })}
        {typing ? (
          <div className="cf-mm-typing" aria-label="Master is answering">
            <i />
            <i />
            <i />
          </div>
        ) : null}
      </div>
      <div className="cf-mm-comp">
        <textarea
          ref={txt}
          className="cf-mm-txt"
          rows={1}
          maxLength={LIMIT}
          placeholder="Message master"
          aria-label="Message to master (Enter sends, Shift+Enter for a new line)"
          value={text}
          disabled={!canWrite}
          title={!canWrite ? READ_ONLY : undefined}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (!e.shiftKey && !e.nativeEvent.isComposing))) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="cf-mm-send" aria-label="Send" title={!canWrite ? READ_ONLY : "Send (Enter)"} disabled={!canWrite || !text.trim() || n > LIMIT} onClick={submit}>
          ↑
        </button>
      </div>
      <div className="cf-mm-stat" role="status">
        {stat || (canWrite && n > LIMIT - 400 ? n + " / " + LIMIT + " characters" : "")}
      </div>
    </section>
  );
}
