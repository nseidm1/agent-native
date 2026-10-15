/**
 * FA-19174: STEERING THE STAGING APP WITHOUT PROMPTS (the legacy studio-steer.js, whole). The live frame (StudioStage) hands it the
 * frame script's reports (studio-live-frame.js: pick, drawn, cropped, edited, pinned).
 *   SELECT: the bar's Select toggle (or Alt-click any time) picks an element in the live app; Cmd/Ctrl/Shift-click adds more (up to 8).
 *     The selection is a tray over the frame: the picked elements as chips, then
 *       Change this…  opens the Agent chat with the selection attached (selector, text, source line, a crop of how it looks now)
 *       Edit text     NO MODEL: the element's own text becomes editable in place; Enter writes it into the staging file (one staging
 *                     commit through frame/_/tweak, $0, undoable); Esc puts it back
 *       Style         NO MODEL: colour from the app's own tokens (its root CSS variables), size, weight, alignment, spacing; previewed
 *                     live, Save writes one rule per element (frame/_/tweak), Cancel takes the preview back
 *       Comment       a note pinned on the element (a numbered pin in the frame), free until sent
 *   MARK: with Mark on, drag over the app: the stroke's box names the element holding it and the tray opens on Comment.
 *   COMMENTS (N): the open comments; Send to the agent opens the chat with them attached (sending marks them sent); Remove.
 * Every control changes something visible or says why it cannot; every async act shows busy and its error beside it. A viewer that
 * cannot write keeps Select, Mark, Style's preview and the chat; the writes say READ_ONLY.
 */
import { type ReactNode, useCallback, useEffect, useReducer, useRef } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, type FrameRef, studioRead, studioWrite } from "../api";
import { type Comment, chipOf, colourTokens, padStep, type Pick, refOf, sizeStep } from "./pure";

export type SteerEnv = {
  app: string;
  appName: string;
  canWrite: boolean;
  tell: (o: Record<string, unknown>) => void;
  say: (t: string, ok?: boolean) => void;
  /** open the Agent chat with text and the selection attached */
  chat: (text: string, refs: FrameRef[]) => void;
  /** a staging change was written: re-read the staged changes */
  onStaged: () => void;
  /** the app's root CSS variables (the frame's ready report) */
  vars: () => Record<string, unknown>;
};
type Msg = { ok: boolean; text: string } | null;
type Mode = "acts" | "comment" | "style";

const Spin = () => <i className="ap-spin" aria-hidden="true" />;

export function useSteer(env: SteerEnv) {
  const E = useRef(env);
  E.current = env;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const S = useRef({
    on: false,
    draw: false,
    picks: [] as Pick[],
    mode: "acts" as Mode,
    drawn: false,
    comments: [] as Comment[],
    cmtErr: null as string | null,
    pend: {} as { props?: Record<string, string>; target?: string },
    waits: new Map<string, (d: any) => void>(),
    pop: false,
    page: null as string | null,
    busy: {} as Record<string, boolean>,
    msg: null as Msg,
    popMsg: null as Msg,
    gone: false,
  }).current;
  const inp = useRef<HTMLInputElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);

  // a frame answer by token (crop, edit), with a timeout
  const ask = (op: string, o: Record<string, unknown>, ms: number) =>
    new Promise<any>((res) => {
      const token = op + Date.now() + Math.random().toString(36).slice(2, 5);
      const t = setTimeout(() => {
        S.waits.delete(token);
        res(null);
      }, ms);
      S.waits.set(token, (d) => {
        clearTimeout(t);
        S.waits.delete(token);
        res(d);
      });
      E.current.tell({ op, ...o, token });
    });
  // one async act: its button busy, its error (or its success) beside it
  async function act(key: string, where: "msg" | "popMsg", fn: () => Promise<unknown>) {
    if (S.busy[key]) return null;
    S.busy[key] = true;
    S[where] = null;
    bump();
    try {
      return await fn();
    } catch (e) {
      S[where] = { ok: false, text: errText(e) };
      return null;
    } finally {
      S.busy[key] = false;
      if (!S.gone) bump();
    }
  }
  // where a picked element lives in the staging copy (file and line), asked once per pick (reading it changes nothing)
  async function srcOf(e: Pick) {
    if (e.file !== undefined) return e;
    try {
      const j = await studioWrite<{ src?: { file?: string; line?: number; css?: string } }>(E.current.app, "app", "frame/_/src", { chain: e.chain, src: e.src, srcOwn: e.srcOwn, st: e.st, vars: E.current.vars() });
      e.file = (j && j.src && j.src.file) || null;
      e.line = (j && j.src && j.src.line) || null;
      e.css = (j && j.src && j.src.css) || null;
    } catch {
      e.file = null;
    }
    return e;
  }

  // ---------- Select / Mark
  const setOn = (v: boolean) => {
    S.on = v;
    if (v && S.draw) {
      S.draw = false;
      E.current.tell({ op: "draw", on: false });
    }
    E.current.tell({ op: "inspect", on: v });
    E.current.say(v ? "Select is on: click a part of the app (Cmd-click adds more)" : "Select is off");
    bump();
  };
  const setDraw = (v: boolean) => {
    S.draw = v;
    if (v && S.on) {
      S.on = false;
      E.current.tell({ op: "inspect", on: false });
    }
    E.current.tell({ op: "draw", on: v });
    E.current.say(v ? "Mark is on: drag over the app to mark an area" : "Mark is off");
    bump();
  };
  function clearSel() {
    S.picks = [];
    S.mode = "acts";
    E.current.tell({ op: "clear" });
    if (S.pend.props) E.current.tell({ op: "unpreview", props: Object.keys(S.pend.props) });
    S.pend = {};
    S.msg = null;
    bump();
  }

  // ---------- comments
  const pins = () => {
    const open = S.comments.filter((c) => c.state === "open");
    E.current.tell({ op: "pins", pins: open.map((c, i) => ({ n: i + 1, sel: c.sel })) });
  };
  const loadComments = useCallback(async () => {
    try {
      const j = await studioRead<{ comments?: Comment[] }>(E.current.app, "app", "comments");
      S.comments = (j && j.comments) || [];
      S.cmtErr = null;
    } catch (e) {
      S.cmtErr = errText(e);
    }
    if (S.gone) return;
    pins();
    bump();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    S.gone = false;
    loadComments();
    return () => {
      S.gone = true;
    };
  }, [env.app]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- the frame's reports
  function onMsg(d: any): boolean {
    if (d.token && S.waits.has(d.token)) {
      S.waits.get(d.token)!(d);
      return true;
    }
    if (d.ev === "pick") {
      const all: { sel: string; tag?: string; text?: string }[] = d.all || [];
      const keep = new Map(S.picks.map((p) => [p.sel, p]));
      S.picks = all.map((a) => (a.sel === (d.el && d.el.sel) ? { ...d.el, sel: a.sel } : keep.get(a.sel) || { sel: a.sel, tag: a.tag, text: a.text })).filter((p) => p.sel);
      S.mode = "acts";
      S.drawn = false;
      S.msg = null;
      bump();
      if (!d.quiet) E.current.say(S.picks.length + " selected: " + S.picks.map(chipOf).join(", "));
      return true;
    }
    if (d.ev === "drawn") {
      S.picks = [{ ...d.el }];
      S.mode = "comment";
      S.drawn = true;
      S.msg = null;
      bump();
      E.current.say("Area marked on " + chipOf(d.el) + ": write your comment");
      return true;
    }
    if (d.ev === "pinned") return true;
    if (d.ev === "key" && d.key === "Escape") return escape();
    return false;
  }
  function frameReady(d: any) {
    S.page = d.page || null;
    if (S.on) E.current.tell({ op: "inspect", on: true });
    if (S.draw) E.current.tell({ op: "draw", on: true });
    pins();
    S.picks = [];
    S.mode = "acts";
    bump();
  }
  function escape(): boolean {
    if (S.mode !== "acts" && S.picks.length) {
      if (S.pend.props) E.current.tell({ op: "unpreview", props: Object.keys(S.pend.props) });
      S.pend = {};
      S.mode = "acts";
      bump();
      return true;
    }
    if (S.pop) {
      S.pop = false;
      bump();
      return true;
    }
    if (S.picks.length) {
      clearSel();
      return true;
    }
    if (S.on) {
      setOn(false);
      return true;
    }
    if (S.draw) {
      setDraw(false);
      return true;
    }
    return false;
  }

  // ---------- the bar: Select, Mark, Comments (N)
  const open = S.comments.filter((c) => c.state === "open");
  const barItems: ReactNode = (
    <>
      <button
        type="button"
        className="cp-btn sm ss-tool"
        data-k="ss-select"
        aria-pressed={S.on}
        title="Select parts of the app to change them or point the agent at them (Alt-click works any time; Cmd/Ctrl/Shift-click adds more)"
        onClick={() => setOn(!S.on)}
      >
        <span className="ss-ic" aria-hidden="true">
          ⌖
        </span>
        {S.on ? "Selecting…" : "Select"}
      </button>
      <button type="button" className="cp-btn sm ss-tool" data-k="ss-mark" aria-pressed={S.draw} title="Draw over the app to mark an area and comment on it" onClick={() => setDraw(!S.draw)}>
        <span className="ss-ic" aria-hidden="true">
          ✎
        </span>
        {S.draw ? "Marking…" : "Mark"}
      </button>
      <button
        type="button"
        className="cp-btn sm ss-tool"
        data-k="ss-comments"
        aria-expanded={S.pop}
        aria-haspopup="dialog"
        aria-controls="ss-comments-pop"
        title="Your comments on the staging app: free until you send them to the agent"
        onClick={() => {
          S.pop = !S.pop;
          bump();
        }}
      >
        <span className="ss-ic" aria-hidden="true">
          💬
        </span>
        {"Comments (" + open.length + ")"}
      </button>
    </>
  );

  // ---------- the tray
  const RO = !env.canWrite;
  const msgEl = (m: Msg) =>
    m ? (
      <span className={m.ok ? "ss-ok" : "ss-err"} role={m.ok ? "status" : "alert"} data-k="st-msg">
        {m.text}
      </span>
    ) : (
      <span className="ss-err" role="alert" data-k="st-msg" />
    );
  const one = S.picks.length === 1 ? S.picks[0] : null;
  function styleRows(): ReactNode {
    const e = S.picks[0],
      st = e.st || {},
      P = S.pend.props || (S.pend.props = {});
    const set = (prop: string, value: string) => {
      P[prop] = value;
      E.current.tell({ op: "preview", kind: "style", prop, value, all: true });
      bump();
    };
    const toks = colourTokens(env.vars());
    const target = S.pend.target || "color";
    const size = P["font-size"] || st.size,
      pad = P.padding || st.pad;
    const B = (label: string, k: string, fn: () => void, pressed?: boolean) => (
      <button type="button" className="cp-btn sm ghost" data-k={"st-" + k} aria-pressed={pressed == null ? undefined : pressed} onClick={fn}>
        {label}
      </button>
    );
    const n = Object.keys(P).length;
    return (
      <>
        <div className="ss-row">
          <span className="ss-lab">Colour</span>
          <div className="cp-seg ss-seg" role="group" aria-label="Colour of">
            {(
              [
                ["color", "Text"],
                ["background-color", "Background"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                aria-pressed={target === k}
                onClick={() => {
                  S.pend.target = k;
                  bump();
                }}
              >
                {l}
              </button>
            ))}
          </div>
          {toks.length ? (
            toks.map((t) => (
              <button
                key={t.name}
                className="ss-sw"
                type="button"
                style={{ background: t.swatch }}
                aria-pressed={P[target] === t.value}
                aria-label={t.name + " (" + t.swatch + ")"}
                title={"--" + t.name + ": " + t.swatch}
                data-k={"st-sw-" + t.name}
                onClick={() => set(target, t.value)}
              />
            ))
          ) : (
            <span className="ss-w">{env.appName} has no colour tokens (root CSS variables): ask the agent for colours</span>
          )}
        </div>
        <div className="ss-row">
          <span className="ss-lab">Size</span>
          {B("Smaller", "size-down", () => set("font-size", sizeStep(size, -1)))}
          {B("Bigger", "size-up", () => set("font-size", sizeStep(size, 1)))}
          {B("Regular", "weight-400", () => set("font-weight", "400"), (P["font-weight"] || st.weight) === "400")}
          {B("Bold", "weight-700", () => set("font-weight", "700"), (P["font-weight"] || st.weight) === "700")}
        </div>
        <div className="ss-row">
          <span className="ss-lab">Layout</span>
          {["left", "center", "right"].map((a) => (
            <span key={a} className="ss-contents">
              {B(a[0].toUpperCase() + a.slice(1), "align-" + a, () => set("text-align", a), (P["text-align"] || st.align) === a)}
            </span>
          ))}
          {B("Tighter", "pad-down", () => set("padding", padStep(pad, -1)))}
          {B("Roomier", "pad-up", () => set("padding", padStep(pad, 1)))}
        </div>
        <div className="ss-row">
          <button
            type="button"
            className="cp-btn sm ss-pri"
            data-k="st-style-save"
            disabled={!n || RO || S.busy.style}
            title={RO ? READ_ONLY : undefined}
            aria-busy={S.busy.style || undefined}
            onClick={() =>
              act("style", "msg", async () => {
                const t0 = Date.now();
                let k = 0;
                for (const x of S.picks) {
                  await studioWrite(E.current.app, "app", "frame/_/tweak", { kind: "style", sel: x.sel, props: P, css: x.css || undefined, where: S.page || undefined });
                  k++;
                }
                S.msg = { ok: true, text: "Saved to staging in " + ((Date.now() - t0) / 1000).toFixed(1) + " s, no model, $0: " + k + " element" + (k > 1 ? "s" : "") + " (Undo in its toast)" };
                S.pend = {};
                S.mode = "acts";
                E.current.onStaged();
              })
            }
          >
            {S.busy.style ? <Spin /> : null}Save to staging
          </button>
          <button
            type="button"
            className="cp-btn sm ghost"
            data-k="st-style-cancel"
            onClick={() => {
              if (n) E.current.tell({ op: "unpreview", props: Object.keys(P) });
              S.pend = {};
              S.mode = "acts";
              bump();
            }}
          >
            Cancel
          </button>
          <span className="ss-w">
            {n
              ? Object.entries(P)
                  .map(([k, v]) => k + " " + v)
                  .join(" · ")
              : "Pick a change: it shows in the app at once"}
          </span>
          {msgEl(S.msg)}
        </div>
      </>
    );
  }
  async function editText(e: Pick) {
    E.current.say("Edit the text in the app: Enter saves to staging, Esc cancels");
    const d = await ask("edit", { sel: e.sel }, 120000);
    if (!d || d.cancel) {
      E.current.say(d && d.why ? "Nothing to edit: " + d.why : "Text edit cancelled");
      return;
    }
    // a save that does not land puts the page's text back (the frame shows staging, never an unsaved edit)
    const back = () => E.current.tell({ op: "preview", kind: "text", value: d.before });
    await srcOf(e);
    if (!e.file) {
      back();
      throw new Error("Could not find where that text is written in the staging copy: use Change this…");
    }
    const t0 = Date.now();
    const j = await studioWrite<{ change?: { title: string } }>(E.current.app, "app", "frame/_/tweak", { kind: "text", file: e.file, line: e.line, before: d.before, after: d.after, where: S.page || undefined }).catch((x) => {
      back();
      throw x;
    });
    S.msg = { ok: true, text: "Saved to staging in " + ((Date.now() - t0) / 1000).toFixed(1) + " s, no model, $0: " + (j && j.change ? j.change.title : '"' + d.after + '"') + " (Undo in its toast)" };
    e.text = d.after;
    S.picks = [...S.picks];
    E.current.onStaged();
  }
  const pinComment = () =>
    act("pin", "msg", async () => {
      const note = (inp.current?.value || "").trim();
      if (note.length < 2) throw new Error("Write the comment first");
      for (const e of S.picks) {
        await srcOf(e);
        const j = await studioWrite<{ comments?: Comment[] }>(E.current.app, "app", "comments", { sel: e.sel, tag: e.tag, text: e.text, src: e.file && e.line ? e.file + ":" + e.line : null, page: S.page || null, note });
        S.comments = (j && j.comments) || S.comments;
      }
      E.current.say("Comment pinned: free until you send it to the agent");
      S.drawn = false;
      clearSel();
      pins();
    });
  useEffect(() => {
    if (S.mode === "comment" && S.picks.length) setTimeout(() => inp.current?.focus({ preventScroll: true }), 0);
    // the tray sits over the bottom of a tall stage: bring it into view when it opens or changes
    if (S.picks.length && trayRef.current) trayRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [S.mode, S.picks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const tray: ReactNode = S.picks.length ? (
    <div className="ss-tray" ref={trayRef} role="region" aria-label={"Selected in " + env.appName} data-k="st-tray">
      <div className="ss-row">
        <b>{S.picks.length} selected</b>
        {S.picks.map((e, i) => (
          <span key={e.sel + i} className="ss-chip" title={e.sel || ""}>
            <span>{chipOf(e)}</span>
          </span>
        ))}
        <span className="ss-sp" />
        <button className="ss-x" type="button" data-k="st-clear" aria-label="Clear the selection" onClick={clearSel}>
          ×
        </button>
      </div>
      {S.mode === "acts" ? (
        <div className="ss-row">
          <button
            type="button"
            className="cp-btn sm ss-pri"
            data-k="st-change"
            disabled={S.busy.change}
            aria-busy={S.busy.change || undefined}
            onClick={() =>
              act("change", "msg", async () => {
                const refs: FrameRef[] = [];
                for (const e of S.picks) {
                  await srcOf(e);
                  const c = await ask("crop", { sel: e.sel }, 3000);
                  refs.push(refOf(e, { page: S.page || null, shot: c && c.url && c.url.length < 4 << 20 ? c.url : null }) as FrameRef);
                }
                E.current.chat("", refs);
                setOn(false);
                E.current.say("The Agent chat has " + refs.length + " selected element" + (refs.length > 1 ? "s" : "") + " attached: say what to change");
              })
            }
          >
            {S.busy.change ? <Spin /> : null}Change this…
          </button>
          <button
            type="button"
            className="cp-btn sm"
            data-k="st-edit"
            disabled={!(one && one.text) || RO || S.busy.edit}
            aria-busy={S.busy.edit || undefined}
            title={RO ? READ_ONLY : one ? (one.text ? "Edit its text in place (no model, $0); Enter saves to staging" : "It has no text of its own") : "Select one element to edit its text"}
            onClick={() => one && act("edit", "msg", () => editText(one))}
          >
            {S.busy.edit ? <Spin /> : null}Edit text
          </button>
          <button
            type="button"
            className="cp-btn sm"
            data-k="st-style"
            title="Colour, size, weight, alignment, spacing from the app's own tokens (no model, $0)"
            onClick={() => {
              S.mode = "style";
              S.pend = { props: {} };
              S.msg = null;
              bump();
            }}
          >
            Style
          </button>
          <button
            type="button"
            className="cp-btn sm"
            data-k="st-comment"
            title="Pin a note on it for the agent (free until you send it)"
            onClick={() => {
              S.mode = "comment";
              S.msg = null;
              bump();
            }}
          >
            Comment
          </button>
          {msgEl(S.msg)}
        </div>
      ) : S.mode === "comment" ? (
        <>
          <div className="ss-row">
            <input
              ref={inp}
              className="ss-in"
              type="text"
              maxLength={600}
              placeholder={S.drawn ? "What about this area?" : "Your comment for the agent"}
              aria-label="Comment"
              data-k="st-comment-text"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!RO) pinComment();
                }
              }}
            />
            <button type="button" className="cp-btn sm ss-pri" data-k="st-comment-save" disabled={RO || S.busy.pin} title={RO ? READ_ONLY : undefined} aria-busy={S.busy.pin || undefined} onClick={pinComment}>
              {S.busy.pin ? <Spin /> : null}Pin comment
            </button>
            <button
              type="button"
              className="cp-btn sm ghost"
              data-k="st-back"
              onClick={() => {
                S.mode = "acts";
                S.msg = null;
                bump();
              }}
            >
              Back
            </button>
          </div>
          {msgEl(S.msg)}
        </>
      ) : (
        styleRows()
      )}
    </div>
  ) : null;

  // ---------- the comments list
  const pop: ReactNode = S.pop ? (
    <div className="ss-pop" id="ss-comments-pop" role="dialog" aria-label={"Comments on " + env.appName} data-k="st-comments-pop">
      <div className="ss-row">
        <b>Comments on {env.appName}</b>
        <span className="ss-sp" />
        <button
          className="ss-x"
          type="button"
          data-k="st-comments-close"
          aria-label="Close the comments"
          onClick={() => {
            S.pop = false;
            bump();
          }}
        >
          ×
        </button>
      </div>
      {S.cmtErr ? (
        <div className="ss-err" role="alert">
          Could not read the comments: {S.cmtErr}
        </div>
      ) : null}
      {open.length ? (
        <ol>
          {open.map((c) => (
            <li key={c.id}>
              <div>{c.note}</div>
              <div className="ss-w">{chipOf(c) + (c.page ? " · " + c.page : "")}</div>
              <button
                className="ss-lnk"
                type="button"
                data-k="st-comment-rm"
                aria-label={"Remove the comment " + c.note}
                disabled={RO || S.busy["rm-" + c.id]}
                title={RO ? READ_ONLY : undefined}
                onClick={() =>
                  act("rm-" + c.id, "popMsg", async () => {
                    const j = await studioWrite<{ comments?: Comment[] }>(E.current.app, "app", "comments/" + c.id + "/delete", {});
                    S.comments = (j && j.comments) || [];
                    pins();
                  })
                }
              >
                {S.busy["rm-" + c.id] ? <Spin /> : null}Remove
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ss-w">No open comments. Select or Mark a part of the app, then Comment.</p>
      )}
      <div className="ss-row">
        <button
          type="button"
          className="cp-btn sm ss-pri"
          data-k="st-comments-send"
          disabled={!open.length}
          onClick={() => {
            E.current.chat(
              "Please address my comments on the staging app (each is pinned on an element).",
              open.map(
                (c) =>
                  refOf({ sel: c.sel, tag: c.tag, text: c.text, file: c.src ? c.src.split(":")[0] : null, line: c.src ? Number(c.src.split(":")[1]) : null }, { page: c.page, note: c.note, comment: c.id }) as FrameRef,
              ),
            );
            S.pop = false;
            bump();
          }}
        >
          Send {open.length} to the agent
        </button>
        <span className="ss-w">Free until sent: the chat opens with them attached</span>
      </div>
      {msgEl(S.popMsg)}
    </div>
  ) : null;

  return { barItems, tray, pop, onMsg, frameReady, escape, refresh: loadComments, state: S };
}
