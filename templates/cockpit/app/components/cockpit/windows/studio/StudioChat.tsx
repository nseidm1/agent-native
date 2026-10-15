/**
 * FA-19172: the studio's Agent chat (card-studio.js chatOpen / chatStaging / chatAttach / chatSend / chatPoll / chatRender / chatPlan),
 * rendered natively. One conversation per app (studio-chat.mjs, resumed across opens), docked beside the live staging app (on a phone:
 * full screen, Chat | Staging). The reply in flight streams from chat/live, read every second while a turn runs (4 s while the tab is
 * hidden); nothing polls while the chat is closed or idle. Reads and writes are the legacy studio's own routes through the cockpit
 * client (app chat, chat/live, frame/_/info; chat/send, chat/stop, chat/plan/<id>[/approve|/cancel], staged/<id>/undo), so every
 * refusal is the studio's own words. A device that cannot write still reads the thread; its write controls say why they are off.
 */
import { type ClipboardEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../CardDialog";
import { type FrameRef, errText, studioFileSrc, studioRead, studioWrite, usd, useStudio, when } from "./api";
import { Md } from "./chat/md";
import { setTalking, useTalking } from "./chat/talking";
import { StudioModal } from "./Modal";
import "./studio-chat.css";

// ---------- the legacy chat's data (studio-chat.mjs view() + qwen + auto, live(), planAct())
type Change = { id: string; title: string; commit?: string; undone?: boolean };
type Ref = FrameRef & { comment?: string };
type Msg = {
  id: string;
  role: "me" | "agent";
  at: string;
  text?: string;
  model?: string;
  status?: string;
  costUsd?: number | null;
  wallMs?: number;
  actions?: { at?: string; what: string }[];
  changes?: Change[];
  error?: string | null;
  image?: string;
  refs?: Ref[];
  joins?: string;
  taken?: string;
  dropped?: string;
  plan?: string;
};
type Plan = {
  id: string;
  msg?: string;
  steps: string[];
  p: number;
  tau: number;
  how?: string;
  state: string;
  versions?: { at: string; diff?: { added: string[]; removed: string[]; changed: { from: string; to: string }[] } }[];
};
type ChatView = {
  models?: { k: string; label: string; capUsd: number }[];
  model?: string;
  costUsd?: number;
  turn: string | null;
  plans?: Plan[];
  messages: Msg[];
  qwen?: { k?: string; label: string; available: boolean; why?: string } | null;
  auto?: { route: string; why?: string } | null;
};
type LiveTurn = { id: string; status: string; model?: string; seq?: number; text?: string; actions?: { what: string }[]; phase?: string | null; elapsedMs?: number; costUsd?: number | null };
type Live = { turn: LiveTurn | null };
type FrameInfo = { platform?: string; staging?: { exists?: boolean; base?: string | null; why?: string | null } | null };

// ---------- the legacy studio's words
const JOB_WORD: Record<string, string> = { queued: "Queued", working: "Working", done: "Done", failed: "Failed", stopped: "Stopped" };
const PLAN_WORD: Record<string, string> = { proposed: "waiting for you", auto: "built without asking", approved: "approved", cancelled: "cancelled" };
const ACTIVE = (s: unknown) => s === "queued" || s === "working";
/** the chat's own duration (card-studio.js dur: "1 min 05 s") */
const dur = (ms: unknown) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
};
const DEFAULT_MODELS = [
  { k: "haiku", label: "Haiku", capUsd: 1 },
  { k: "sonnet", label: "Sonnet", capUsd: 2 },
  { k: "opus", label: "Opus", capUsd: 4 },
];
const MODEL_KEY = "cs-chat-model";
const ERR_MS = 8000;
const Spin = () => <i className="ap-spin" aria-hidden="true" />;

/** The Agent button: first in the action row, primary; pressed while the chat is open; spins while the agent replies. */
export function AgentButton() {
  const st = useStudio();
  const talking = useTalking(st.app);
  return (
    <button
      type="button"
      className="cp-btn st-agent sc-agent"
      data-k="agent"
      aria-haspopup="dialog"
      aria-expanded={st.layer?.kind === "chat"}
      title="Talk to an agent about the design: it adjusts the staging app as you go"
      onClick={() => st.open({ kind: "chat" })}
    >
      {talking ? <Spin /> : null}
      <span className="sc-agent-ico" aria-hidden="true">
        💬
      </span>{" "}
      Agent
      {talking ? <span className="sr-only"> (replying)</span> : null}
    </button>
  );
}

export function ChatLayer() {
  const st = useStudio();
  const open = st.layer?.kind === "chat";
  const { app, name, canWrite } = st;

  const [v, setV0] = useState<ChatView | null>(null);
  const [live, setLive0] = useState<Live | null>(null);
  const vRef = useRef<ChatView | null>(null);
  const liveRef = useRef<Live | null>(null);
  const setV = (x: ChatView | null) => {
    vRef.current = x;
    setV0(x);
  };
  const setLive = (x: Live | null) => {
    liveRef.current = x;
    setLive0(x);
  };
  const [model, setModel] = useState<string | null>(() => {
    let m0 = "sonnet";
    try {
      m0 = (typeof localStorage !== "undefined" && localStorage.getItem(MODEL_KEY)) || "";
    } catch {
      /* private mode */
    }
    return ["haiku", "sonnet", "opus", "qwen"].includes(m0) ? m0 : null;
  });
  const [text, setText] = useState("");
  const [img, setImg] = useState<{ url: string; name: string } | null>(null);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [side, setSide] = useState<"chat" | "stg">("chat");
  const [stg, setStg] = useState<{ loading?: true; info?: FrameInfo; error?: string } | null>(null);
  const [undone, setUndone] = useState<Record<string, true>>({});
  const [planEdit, setPlanEdit] = useState<string | null>(null);
  const [err, setErr] = useState<{ text: string; n: number } | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const busyRef = useRef<Record<string, boolean>>({});

  const openRef = useRef(open);
  openRef.current = open;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const force = useRef(false);
  const errN = useRef(0);

  // ERRORS ARE TRANSIENT (legacy flashErr): shown next to the composer, gone after 8 s or on a tap
  const flash = useCallback((t: string) => setErr({ text: t, n: ++errN.current }), []);
  useEffect(() => {
    if (!err) return;
    const n = err.n;
    const t = setTimeout(() => setErr((x) => (x && x.n === n ? null : x)), ERR_MS);
    return () => clearTimeout(t);
  }, [err]);

  const read = useCallback(<T,>(path: string) => studioRead<T>(app, "app", path), [app]);
  const post = useCallback(<T = any,>(path: string, body: Record<string, unknown> = {}) => studioWrite<T>(app, "app", path, body), [app]);

  // ASYNC CONTROL (legacy act()): the button busy, the error line cleared, the refusal in the studio's words
  const act = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
      if (busyRef.current[key]) return null;
      busyRef.current = { ...busyRef.current, [key]: true };
      setBusy(busyRef.current);
      setErr(null);
      try {
        return await fn();
      } catch (e) {
        flash(errText(e));
        return null;
      } finally {
        const { [key]: _, ...rest } = busyRef.current;
        busyRef.current = rest;
        setBusy(rest);
      }
    },
    [flash],
  );

  // ONE POLL LOOP (legacy chatPoll): the view when idle (once), the live reply every second while a turn runs, the view again when it ends
  const poll = useCallback(
    async (fresh = false) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!openRef.current) return;
      const g = gen.current;
      try {
        let cv = vRef.current,
          cl = liveRef.current;
        const was = cv && cv.turn;
        if (fresh || !cv || !was || !cl || !cl.turn || cl.turn.id !== was || ACTIVE(cl.turn.status)) {
          if (was) {
            cl = await read<Live>("chat/live");
            // the turn ended (or the live file no longer names it): the view again, with its reply, cost and changes
            if (fresh || !cl.turn || cl.turn.id !== was || !ACTIVE(cl.turn.status)) cv = await read<ChatView>("chat");
          } else cv = await read<ChatView>("chat");
        }
        if (cv && cv.turn && !was) cl = await read<Live>("chat/live");
        if (g !== gen.current) return;
        setV(cv);
        setLive(cl);
        setTalking(app, Boolean(cv && cv.turn));
        if (was && cv && !cv.turn) {
          const t = cv.messages.find((m) => m.id === was);
          st.say("The agent " + (t && t.status === "done" ? "replied" + ((t.changes || []).length ? " and changed staging: " + t.changes![0].title : "") : t ? t.status : "finished"));
          if (t && (t.changes || []).length) st.refresh();
        }
      } catch (e) {
        if (g === gen.current) flash("Could not reach the chat: " + errText(e));
      }
      if (g === gen.current && openRef.current && vRef.current && vRef.current.turn) timer.current = setTimeout(() => void pollRef.current(), typeof document !== "undefined" && document.hidden ? 4000 : 1000);
    },
    [app, read, flash, st],
  );
  const pollRef = useRef(poll);
  pollRef.current = poll;

  // the live staging app (studio-live.mjs info), in its pane; read once, Try again after a failure
  const loadStaging = useCallback(() => {
    setStg({ loading: true });
    read<FrameInfo>("frame/_/info")
      .then((i) => setStg({ info: i }))
      .catch((e) => setStg({ error: errText(e) }));
  }, [read]);

  // opening (or re-opening with a prefill or selected elements): the staging app once, the conversation, the cursor in the composer
  const layer = st.layer;
  useEffect(() => {
    if (!layer || layer.kind !== "chat") return;
    if (layer.prefill) setText(layer.prefill);
    if (layer.refs && layer.refs.length) {
      const add = layer.refs;
      setRefs((cur) => {
        const next = [...cur];
        for (const r of add) if (!next.some((x) => x.sel === r.sel && x.note === r.note)) next.push(r);
        return next.slice(-8);
      });
    }
  }, [layer]);
  useEffect(() => {
    if (!open) return;
    gen.current++;
    force.current = true;
    if (!stg || stg.error) loadStaging();
    void pollRef.current();
    const f = setTimeout(() => ta.current && ta.current.focus(), 0);
    return () => {
      clearTimeout(f);
      gen.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // scroll to the end on new content when the reader was already at the end
  useLayoutEffect(() => {
    const el = thread.current;
    if (!el) return;
    if (stick.current || force.current) el.scrollTop = el.scrollHeight;
    force.current = false;
  });

  if (!open) return null;

  // ---------- derived (legacy chatRender)
  const turn = v && v.turn ? v.messages.find((m) => m.id === v.turn) || null : null;
  const lt = live && live.turn && turn && live.turn.id === turn.id ? live.turn : null;
  const models = (v && v.models) || DEFAULT_MODELS;
  // Qwen3.8 on the Halo (free, advice only); greyed with its reason when it is off or down
  const qw = v && v.qwen,
    qwOn = Boolean(qw && qw.available);
  // AUTO: Qwen3.8 for a small question once it earned the chat in shadow, else the last Claude model; the default pick once that use is live
  const autoLive = Boolean(qwOn && v && v.auto && v.auto.route === "live");
  let pick = model || (autoLive ? "auto" : null) || (v && v.model) || "sonnet";
  if ((pick === "qwen" || pick === "auto") && !qwOn) pick = "sonnet";
  const sending = Boolean(busy.send);

  const send = async () => {
    if (sending) return;
    if (!canWrite) return flash(READ_ONLY);
    const t = text.trim();
    const rs = refs.map(({ label, ...r }) => r);
    if (!t && !img && !rs.some((r) => r.note)) {
      flash("Write a message first");
      ta.current && ta.current.focus();
      return;
    }
    // MID-RUN FOLLOW-UP: while a turn works, Send adds the message to it (the agent reads it before the turn ends)
    if (turn && turn.model === "qwen") return flash("Qwen3.8 is answering (it reads one message at a time): send this when it is done");
    const m = turn ? turn.model || "sonnet" : pick || "sonnet";
    const r = await act("send", () =>
      post<{ joined?: boolean; asks?: boolean; plan?: { p: number; tau: number; steps: string[] } }>("chat/send", {
        text: t,
        model: m,
        image: img ? img.url : undefined,
        refs: rs.length ? rs : undefined,
        join: turn ? true : undefined,
      }),
    );
    if (!r) return;
    setText("");
    setImg(null);
    setRefs([]);
    st.say(
      r.joined
        ? "Added to the turn in flight: the agent reads it before it ends"
        : r.asks && r.plan
          ? "A plan first: confidence " + r.plan.p + " is under " + r.plan.tau + ", so it asks. Build it, edit it or cancel it"
          : r.plan
            ? "Planned " + r.plan.steps.length + " steps (confidence " + r.plan.p + "): building"
            : "Sent to the agent (" + m + ")",
    );
    force.current = true;
    ta.current && ta.current.focus();
    void poll(true);
  };

  const attach = (f: File) => {
    if (f.size > 5 << 20) return flash("Image too large (5 MB at most)");
    const rd = new FileReader();
    rd.onload = () => setImg({ url: String(rd.result), name: f.name || "pasted image" });
    rd.onerror = () => flash("Could not read that image");
    rd.readAsDataURL(f);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find((y) => /^image\//.test(y.type));
    if (f) {
      e.preventDefault();
      attach(f);
    }
  };

  const stop = () =>
    act("stop", async () => {
      await post("chat/stop", {});
      st.say("Stopping the agent");
      void poll(true);
    });
  const undo = (c: Change) =>
    act("undo:" + c.id, async () => {
      await post("staged/" + c.id + "/undo", {});
      setUndone((u) => ({ ...u, [c.id]: true }));
      st.say("Undid " + c.title);
      st.refresh();
    });

  // ---------- the thread
  const wo = canWrite ? undefined : READ_ONLY;
  const planCtx: PlanCtx = { planEdit, setPlanEdit, canWrite, busy, act, post, read, setV, say: (t) => st.say(t), poll: () => void poll() };
  const rows = v
    ? v.messages.map((m) => {
        if (m.role === "me") {
          const pl = m.plan ? (v.plans || []).find((x) => x.id === m.plan) || null : null;
          return [
            <div key={m.id} className="sc-m me" data-k="chat-msg" data-role="me">
              <div className="sc-who">{"You · " + when(m.at) + (m.joins ? " · " + (m.taken ? "joined the turn" : m.dropped ? "not read" : "joining the turn…") : "")}</div>
              {m.text ? <div className="sc-tx">{m.text}</div> : null}
              {(m.refs || []).length ? (
                <div className="sc-refs">
                  {m.refs!.map((r, i) => (
                    <span key={i} className="sc-ref" title={[r.sel, r.src].filter(Boolean).join(" · ")}>
                      {r.shot ? <img src={studioFileSrc(app, "app", "chat/img/" + r.shot)} alt="" /> : null}
                      <span>{(r.note ? "💬 " + r.note : (r.tag ? "<" + r.tag + "> " : "") + (r.text || r.sel || "")).slice(0, 80)}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {m.image ? <img className="sc-pic" src={studioFileSrc(app, "app", "chat/img/" + m.image)} alt="Your attached image" loading="lazy" /> : null}
              {m.dropped ? (
                <div className="sc-merr">
                  {m.dropped}{" "}
                  <button
                    type="button"
                    className="sc-lnk"
                    data-k="chat-resend"
                    onClick={() => {
                      setText(m.text || "");
                      ta.current && ta.current.focus();
                    }}
                  >
                    Send again
                  </button>
                </div>
              ) : null}
            </div>,
            pl ? <PlanBox key={"pl-" + pl.id} pl={pl} c={planCtx} /> : null,
          ];
        }
        const run = Boolean(turn && m.id === turn.id);
        const body = run ? (lt && lt.text) || "" : m.text || "";
        const acts = run ? (lt && lt.actions) || [] : m.actions || [];
        const status = run ? (lt ? lt.status : m.status) : m.status;
        return (
          <div key={m.id} className={"sc-m ag" + (run ? " run" : "") + (m.status === "failed" ? " bad" : "")} data-k="chat-msg" data-role="agent">
            <div className="sc-who">
              {"Agent · " + m.model + " "}
              {run ? (
                <>
                  <Spin />
                  {" " + (status === "queued" ? "starting" : (lt && lt.phase) || "thinking") + (lt && lt.elapsedMs ? " · " + dur(lt.elapsedMs) : "")}
                </>
              ) : (
                (m.status === "done" ? "" : JOB_WORD[m.status || ""] || m.status || "") + (m.costUsd != null ? " · " + usd(m.costUsd) : "") + (m.wallMs ? " · " + dur(m.wallMs) : "")
              )}
            </div>
            {body ? <Md className="sc-md sc-tx" text={body} /> : null}
            {acts.length ? (
              <ul className="sc-acts">
                {acts.map((a, i) => (
                  <li key={i}>{a.what}</li>
                ))}
              </ul>
            ) : null}
            {(m.changes || []).map((c) => {
              const gone = Boolean(c.undone || undone[c.id]);
              const b = Boolean(busy["undo:" + c.id]);
              return (
                <div key={c.id} className="sc-ch" data-k="chat-change">
                  <span aria-hidden="true">✓</span>
                  <span className="sc-ch-t">{"staging changed: " + c.title}</span>
                  <button
                    type="button"
                    className="sc-lnk"
                    data-k="chat-undo"
                    disabled={gone || b || !canWrite}
                    title={gone ? undefined : wo}
                    aria-busy={b || undefined}
                    aria-label={"Undo the staging change " + c.title}
                    onClick={() => void undo(c)}
                  >
                    {b ? <Spin /> : null}
                    {gone ? "Undone" : "Undo"}
                  </button>
                </div>
              );
            })}
            {m.error ? <div className="sc-merr">{m.error}</div> : null}
          </div>
        );
      })
    : [];

  // ---------- the staging pane
  const info = stg && stg.info,
    sg = info && info.staging;
  const frame =
    !stg || stg.loading ? (
      <div className="sc-msg" role="status">
        <Spin /> Opening the staging app…
      </div>
    ) : stg.error ? (
      <div className="sc-msg" role="alert">
        <span>{"Could not reach the staging app: " + stg.error}</span>
        <button type="button" className="cp-btn sm" data-k="chat-stg-retry" onClick={loadStaging}>
          Try again
        </button>
      </div>
    ) : info && info.platform === "web" && sg && sg.exists && sg.base ? (
      <iframe src={sg.base} title={name + ", the staging app now"} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="same-origin" data-k="chat-staging-frame" />
    ) : (
      <div className="sc-msg" role="status">
        {info && info.platform && info.platform !== "web" ? name + " is not a web app: it has no live frame here" : name + " has no staging copy yet" + (sg && sg.why ? ": " + sg.why : "")}
      </div>
    );

  const extra = (
    <>
      <label className="sc-ml" htmlFor="sc-chmodel">
        Model
      </label>
      <select
        id="sc-chmodel"
        className="cp-in sc-model"
        data-k="chat-model"
        aria-label="Model for the next message"
        title={pick === "qwen" ? "Qwen3.8 answers and advises; pick Haiku, Sonnet or Opus to change staging" : undefined}
        value={pick}
        onChange={(e) => {
          const x = e.target.value;
          setModel(x);
          try {
            localStorage.setItem(MODEL_KEY, x);
          } catch {
            /* private mode */
          }
        }}
      >
        {models.map((m) => (
          <option key={m.k} value={m.k}>
            {m.label + " · cap $" + m.capUsd}
          </option>
        ))}
        {qw && v && v.auto ? (
          <option
            value="auto"
            data-k="chat-model-auto"
            disabled={!qwOn}
            title={autoLive ? "Small questions go to Qwen3.8 (free, it earned the chat in shadow); edits and several asks go to Claude" : "Claude answers until Qwen3.8 earns the chat: " + String(v.auto.why || "")}
          >
            {"Auto · " + (autoLive ? "Qwen for small questions" : "Claude (Qwen not yet earned)")}
          </option>
        ) : null}
        {qw ? (
          <option value="qwen" data-k="chat-model-qwen" disabled={!qwOn} title={qwOn ? "Free, on the Halo. Advice only: it has no tools here and never edits staging" : qw.why}>
            {qw.label + (qwOn ? " · advice only" : " · off: " + String(qw.why || "").slice(0, 48))}
          </option>
        ) : null}
      </select>
      <span className="sc-spend" data-k="chat-spend">
        {v ? "spent " + usd(v.costUsd) : ""}
      </span>
      {turn ? (
        <button type="button" className="cp-btn sm danger" data-k="chat-stop" disabled={!canWrite || busy.stop} title={wo} aria-busy={busy.stop || undefined} onClick={() => void stop()}>
          {busy.stop ? <Spin /> : null}Stop
        </button>
      ) : null}
    </>
  );

  return (
    <StudioModal open onClose={st.close} title={"Agent · " + name} extra={extra} size="xl" testid="studio-chat">
      <div className="sc-root" data-k="chat-dialog" data-side={side}>
        <div className="cp-seg sc-seg" role="group" aria-label="Show">
          {(
            [
              ["chat", "Chat"],
              ["stg", "Staging"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" data-k={"chat-side-" + k} aria-pressed={side === k} onClick={() => setSide(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="sc-grid">
          <section className="sc-stg" aria-label="The staging app now">
            <div className="sc-ph">
              <b>Staging now</b>
              <span className="sc-hint">live: it updates as the agent edits</span>
            </div>
            <div className="sc-fw">{frame}</div>
          </section>
          <section className="sc-pane" aria-label="Chat with the agent">
            <div
              ref={thread}
              className="sc-thread"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Conversation with the agent"
              tabIndex={0}
              data-k="chat-thread"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {!v ? (
                <div className="sc-msg" role="status">
                  <Spin /> Loading the conversation…
                </div>
              ) : rows.length ? (
                rows
              ) : (
                <div className="sc-empty" data-k="chat-empty">
                  <b>{"Talk to the agent about " + name}</b>
                  <p className="sc-hint">
                    Ask for a change and it edits the staging copy now (it reloads beside this chat), ask a question, or attach a screenshot of what you mean. Each change can be undone. Pick the
                    model above; it applies from your next message.
                  </p>
                </div>
              )}
            </div>
            <div className="sc-foot">
              {refs.length ? (
                <div className="sc-refs" data-k="chat-refs" role="list" aria-label="Selected elements sent with the message">
                  {refs.map((r, i) => (
                    <span key={r.sel + ":" + (r.note || "") + i} className="sc-ref" role="listitem" title={[r.sel, r.src, r.note].filter(Boolean).join(" · ")}>
                      {r.shot ? <img src={r.shot} alt="" /> : null}
                      <span>{(r.note ? "💬 " : "") + (r.label || r.sel)}</span>
                      <button
                        type="button"
                        className="sc-x"
                        data-k="chat-ref-remove"
                        aria-label={"Remove " + (r.label || r.sel)}
                        onClick={() => {
                          setRefs((cur) => cur.filter((_, j) => j !== i));
                          ta.current && ta.current.focus();
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {img ? (
                <div className="sc-img">
                  <img src={img.url} alt="" />
                  <span>{img.name}</span>
                  <button
                    type="button"
                    className="sc-x"
                    data-k="chat-img-remove"
                    aria-label="Remove the attached image"
                    onClick={() => {
                      setImg(null);
                      ta.current && ta.current.focus();
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <div className="sc-in">
                <textarea
                  ref={ta}
                  rows={2}
                  maxLength={4000}
                  data-k="chat-text"
                  aria-label="Message to the agent"
                  aria-describedby="sc-chkeys"
                  placeholder={"Tell the agent what to change in " + name + ', e.g. "make the header calmer on phones"'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                  onPaste={onPaste}
                />
                <button type="button" className="cp-btn sc-attach" data-k="chat-attach" aria-label="Attach an image (a screenshot of what you mean)" title="Attach or paste a screenshot" onClick={() => file.current && file.current.click()}>
                  <span aria-hidden="true">📎</span>
                </button>
                <button
                  type="button"
                  className="cp-btn sc-send"
                  data-k="chat-send"
                  disabled={!canWrite || sending || Boolean(turn && turn.model === "qwen")}
                  aria-busy={sending || undefined}
                  title={!canWrite ? READ_ONLY : turn ? "The agent is working: this joins its turn and it reads it before it ends" : undefined}
                  onClick={() => void send()}
                >
                  {sending ? <Spin /> : null}
                  {turn ? "Add to turn" : "Send"}
                </button>
                <input
                  ref={file}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) attach(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="sc-hint" id="sc-chkeys">
                Enter sends · Shift+Enter for a new line · paste a screenshot to attach it
              </div>
              <div className="sc-err" role="alert" data-k="chat-err" title={err ? "Tap to dismiss" : undefined} onClick={() => setErr(null)}>
                {err ? err.text : ""}
              </div>
            </div>
          </section>
        </div>
      </div>
    </StudioModal>
  );
}

type PlanCtx = {
  planEdit: string | null;
  setPlanEdit: (id: string | null) => void;
  canWrite: boolean;
  busy: Record<string, boolean>;
  act: <T>(key: string, fn: () => Promise<T>) => Promise<T | null>;
  post: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  read: <T>(path: string) => Promise<T>;
  setV: (v: ChatView | null) => void;
  say: (t: string) => void;
  poll: () => void;
};
// ---------- a plan (legacy chatPlan): its steps, the confidence and its source, the versions; Build this plan / Edit / Cancel
function PlanBox({ pl, c }: { pl: Plan; c: PlanCtx }) {
const { planEdit, setPlanEdit, canWrite, busy, act, post, read, setV, say, poll } = c;
const wo = canWrite ? undefined : READ_ONLY;
  const editing = planEdit === pl.id,
    waiting = pl.state === "proposed";
  const [draft, setDraft] = useState(pl.steps.join("\n"));
  useEffect(() => {
    if (editing) setDraft(pl.steps.join("\n"));
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const call = (path: string, body: Record<string, unknown>) => post("chat/plan/" + pl.id + path, body);
  const vers = (pl.versions || []).length ? (
    <details className="sc-hint">
      <summary>{"edited " + pl.versions!.length + " time" + (pl.versions!.length > 1 ? "s" : "")}</summary>
      <ul>
        {pl.versions!.map((x, i) => (
          <li key={i}>
            {when(x.at) +
              ": " +
              [
                x.diff && x.diff.added.length ? "+ " + x.diff.added.join("; ") : null,
                x.diff && x.diff.removed.length ? "- " + x.diff.removed.join("; ") : null,
                ...(x.diff ? x.diff.changed.map((c) => c.from + " -> " + c.to) : []),
              ]
                .filter(Boolean)
                .join(" · ")}
          </li>
        ))}
      </ul>
    </details>
  ) : null;
  return (
    <div className={"sc-m ag sc-plan" + (waiting ? " run" : "")} data-k="chat-plan" role="group" aria-label="Plan for your message">
      <div className="sc-who">
        <b>{"Plan · " + pl.steps.length + " steps"}</b>
        {" · confidence " + pl.p + (pl.how === "jev" ? " (JEV)" : " (our past turns)") + " · " + (pl.p >= pl.tau ? "at or above " : "under ") + pl.tau + " · " + (PLAN_WORD[pl.state] || pl.state)}
      </div>
      {editing ? (
        <>
          <textarea
            className="sc-plan-ta"
            rows={Math.min(8, pl.steps.length + 1)}
            data-k="chat-plan-text"
            aria-label="The plan, one step per line"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="sc-row">
            <button
              type="button"
              className="cp-btn sm sc-pri"
              data-k="chat-plan-save"
              disabled={!canWrite || busy["plan-save"]}
              title={wo}
              onClick={() =>
                void act("plan-save", async () => {
                  await call("", { steps: draft.split("\n") });
                  setPlanEdit(null);
                  setV(await read<ChatView>("chat"));
                  say("Plan saved: the old version is kept");
                })
              }
            >
              {busy["plan-save"] ? <Spin /> : null}Save plan
            </button>
            <button type="button" className="cp-btn sm ghost" data-k="chat-plan-back" onClick={() => setPlanEdit(null)}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className="sc-steps">
            {pl.steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
          {waiting ? (
            <div className="sc-row">
              <button
                type="button"
                className="cp-btn sm sc-pri"
                data-k="chat-plan-approve"
                disabled={!canWrite || busy["plan-approve"]}
                title={wo}
                onClick={() =>
                  void act("plan-approve", async () => {
                    await call("/approve", {});
                    say("Building the plan");
                    setV(null);
                    poll();
                  })
                }
              >
                {busy["plan-approve"] ? <Spin /> : null}Build this plan
              </button>
              <button type="button" className="cp-btn sm" data-k="chat-plan-edit" disabled={!canWrite} title={wo} onClick={() => setPlanEdit(pl.id)}>
                Edit
              </button>
              <button
                type="button"
                className="cp-btn sm ghost"
                data-k="chat-plan-cancel"
                disabled={!canWrite || busy["plan-cancel"]}
                title={wo}
                onClick={() =>
                  void act("plan-cancel", async () => {
                    await call("/cancel", {});
                    setV(await read<ChatView>("chat"));
                    say("Plan cancelled");
                  })
                }
              >
                {busy["plan-cancel"] ? <Spin /> : null}Cancel
              </button>
            </div>
          ) : null}
        </>
      )}
      {vers}
    </div>
  );
}
