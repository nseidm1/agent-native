/**
 * FA-19175: the studio's INBOX drawer (card-studio.js renderQA for an app, with studio-lifecycle.js inboxTop above its questions):
 * Needs you (the deploy's phone signature, the Optimizers' decisions with "Decide in <lens>"), Questions for you (this app's
 * console questions, each with Answer -> the cockpit's Questions window; "N more questions across your work"), Proposals
 * ("<n> from the <lens>"), Suggested (one theme: "Add a <other> theme" -> the Agent chat), Activity (lenses running, the deploy,
 * Build it); then the studio record's own Questions (each a card: suggested answers, visual options previewed and chosen, a
 * free-text answer with an image, Later, Not needed, Answer), or "Nothing needs your answer.", Answered (folded), Note a
 * question for later, and the open questions on the app's cards. Writes: app ask (Ask me Questions), questions/<id>/answer,
 * questions/<id>/withdraw, choose, attach, questions.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { studioFileSrc, studioWrite, useStudio, useStudioRead } from "../api";
import { StudioDrawer } from "../Modal";
import {
  ACTIVE,
  ErrLine,
  focusSoon,
  useReturnFocus,
  Spin,
  useActs,
  useAppView,
  WBtn,
} from "./common";
import { deployStages } from "./TileDetails";

/** Opens one of the cockpit's own windows over the studio (Cockpit.tsx listens). */
export const openCockpitWindow = (id: string, args?: Record<string, string>) =>
  window.dispatchEvent(
    new CustomEvent("cockpit-open-window", {
      detail: { id, args: args || {} },
    }),
  );

const qFrom = (q: any) =>
  q.kind === "agent"
    ? (q.context && q.context.label) || "an agent"
    : q.kind === "lane"
      ? "the lane (" + ((q.context && q.context.stage) || "lane") + ")"
      : q.kind === "board"
        ? "a board question"
        : q.kind === "gap"
          ? "the studio"
          : "you";
const lc_ = (x: unknown) => String(x || "").toLowerCase();
const HEXC = /^#[0-9a-f]{6}$/i;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || "");

export function InboxDrawer() {
  const st = useStudio();
  const on = st.layer?.kind === "inbox";
  const vq = useAppView(on);
  const lcQ = useStudioRead<any>(st.app, "app", "lifecycle", {
    every: on ? 10000 : 0,
    enabled: on,
  });
  const envQ = useStudioRead<any>(st.app, "env", "", {
    every: on ? 10000 : 0,
    enabled: on,
  });
  const actsQ = useStudioRead<any>(st.app, "studio", "actions", {
    enabled: on,
  });
  const v = vq.data;
  const A = useActs(() => vq.refetch());
  // on open: the first answer box (legacy qSheet), else the drawer's close; never a write button
  useEffect(() => {
    if (on)
      focusSoon([
        '[data-testid=studio-inbox-drawer] [data-k^="qa-text"]',
        '[data-testid=studio-inbox-drawer] [aria-label="Close the drawer"]',
      ]);
  }, [on]);
  useReturnFocus(on, "[data-testid=studio] [data-testid=studio-inbox]");
  const qs: any[] = (v && v.rec && v.rec.questions) || [];
  const open = qs.filter((q) => q.state === "open");
  const live = ((v && v.rec && v.rec.jobs) || []).filter(ACTIVE);
  const aq =
    (v && v.flow && (v.flow.next || []).find((x: any) => x.k === "refine")) ||
    null;
  const asking =
    aq &&
    live.find(
      (j: any) =>
        !j.ask &&
        j.action === aq.action &&
        (!aq.followOf || j.followOf === aq.followOf),
    );
  const capsFor = (k: string) => {
    const a =
      ((actsQ.data && actsQ.data.actions) || []).find((x: any) => x.k === k) ||
      {};
    return { model: a.model, maxUsd: a.maxUsd, maxMin: a.maxMin };
  };
  return (
    <StudioDrawer
      open={on}
      onClose={st.close}
      title="Inbox"
      testid="studio-inbox-drawer"
      extra={
        <>
          {open.length ? (
            <span className="ap-chip t-a">{open.length} open</span>
          ) : null}
          {aq ? (
            <WBtn
              can={st.canWrite}
              busy={A.busy.askme}
              disabled={Boolean(asking)}
              k="qa-askme"
              title={aq.why}
              onClick={() =>
                A.run("askme", async () => {
                  const j = await studioWrite(st.app, "app", "ask", {
                    action: aq.action,
                    followOf: aq.followOf || undefined,
                    message: aq.message || "",
                    autoApply: true,
                    flow: aq.k,
                    ...capsFor(aq.action),
                  });
                  st.say(
                    aq.label + " started; the preview updates as it works",
                  );
                  return j;
                })
              }
            >
              {asking ? (
                <>
                  <Spin /> Asking…
                </>
              ) : (
                aq.label
              )}
            </WBtn>
          ) : null}
        </>
      }
    >
      <ErrLine
        text={A.err.askme}
        onClear={() => A.clear("askme")}
        k="qa-askme-err"
      />
      {!v ? (
        <div className="sd-row" role="status">
          {vq.error ? (
            <span className="sd-err">
              Could not load the app:{" "}
              {String((vq.error as Error).message || "").replace(
                /^Action [\w-]+ failed:\s*/,
                "",
              )}
            </span>
          ) : (
            <>
              <Spin /> Loading the app…
            </>
          )}
        </div>
      ) : (
        <>
          <InboxTop lc={lcQ.data || null} e={envQ.data || null} />
          <h4 className="sd-qh4">Questions</h4>
          <QuestionQueue
            v={v}
            open={open}
            live={live}
            aq={aq}
            refetch={() => vq.refetch()}
          />
          <AnsweredList v={v} />
          <NoteQuestion refetch={() => vq.refetch()} />
          <CardQuestions v={v} />
        </>
      )}
    </StudioDrawer>
  );
}

/** studio-lifecycle.js inboxTop: Needs you, Questions for you, Proposals, Suggested, Activity. */
function InboxTop({ lc, e }: { lc: any; e: any }) {
  const st = useStudio();
  const sig =
    e && e.promotion && e.promotion.phase === "awaiting-signature"
      ? e.promotion
      : null;
  const dec: any[] = lc && lc.inbox ? lc.inbox.decisions || [] : [];
  const inbox = st.s.inbox as any;
  const qsFor: any[] = inbox.qs || [];
  const more = Number(inbox.more || 0);
  const ls: any[] = lc ? (lc.lenses || []).filter((l: any) => l.waiting) : [];
  const T =
    st.stage && st.stage.theme && st.stage.theme.kind === false
      ? st.stage.theme
      : null;
  const other = T && T.base === "light" ? "dark" : "light";
  const act: string[] = [];
  for (const l of lc ? lc.lenses || [] : [])
    if (l.state === "measuring" || l.state === "running")
      act.push(l.label + ": " + l.step);
  if (e && e.promotion && e.promotion.state !== "published")
    act.push("Deploy: " + deployStages(e.promotion, false).text);
  if (
    lc &&
    lc.build &&
    lc.build.autopilot &&
    lc.build.autopilot.state === "running"
  )
    act.push("Build it: running");
  return (
    <>
      {sig || dec.length ? (
        <>
          <h4 className="sd-qh4">Needs you</h4>
          <ul className="sd-list" data-k="inbox-needs">
            {sig ? (
              <li>
                <span className="sd-ok r" aria-hidden="true">
                  !
                </span>
                <span>
                  <b>Sign the production deploy on your phone</b>
                  <span className="sd-hint">
                    {" · " +
                      ((sig.publish && sig.publish.message) ||
                        "the release candidate passed its checks")}
                  </span>
                </span>
              </li>
            ) : null}
            {dec.map((x) => (
              <li key={x.lens + ":" + x.id}>
                <span className="sd-ok n" aria-hidden="true">
                  ?
                </span>
                <span>
                  <b>{x.title}</b>{" "}
                  <button
                    type="button"
                    className="sd-lnk"
                    data-k={"inbox-decide-" + x.lens + "-" + x.id}
                    onClick={() => st.open({ kind: "lens", id: x.lens })}
                  >
                    {"Decide in " + x.label}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {qsFor.length || more > 0 ? (
        <>
          <h4 className="sd-qh4">Questions for you</h4>
          <ul className="sd-list" data-k="inbox-questions">
            {qsFor.map((q) => (
              <li key={q.id}>
                <span
                  className={"sd-ok " + (q.priority === "normal" ? "n" : "r")}
                  aria-hidden="true"
                >
                  ?
                </span>
                <span>
                  <b>{q.question}</b>{" "}
                  <button
                    type="button"
                    className="sd-lnk"
                    data-k={"inbox-q-" + q.id}
                    onClick={() => openCockpitWindow("questions", { id: q.id })}
                  >
                    Answer
                  </button>
                </span>
              </li>
            ))}
            {more > 0 ? (
              <li>
                <span className="sd-ok n" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  className="sd-lnk"
                  data-k="inbox-q-all"
                  onClick={() => openCockpitWindow("questions")}
                >
                  {more +
                    " more question" +
                    (more === 1 ? "" : "s") +
                    " across your work"}
                </button>
              </li>
            ) : null}
          </ul>
        </>
      ) : null}
      {ls.length ? (
        <>
          <h4 className="sd-qh4">Proposals</h4>
          <ul className="sd-list" data-k="inbox-proposals">
            {ls.map((l) => (
              <li key={l.id}>
                <span className="sd-ok n" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  className="sd-lnk"
                  onClick={() => st.open({ kind: "lens", id: l.id })}
                >
                  {l.waiting + " from the " + l.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {T ? (
        <>
          <h4 className="sd-qh4">Suggested</h4>
          <ul className="sd-list" data-k="inbox-theme">
            <li>
              <span className="sd-ok n" aria-hidden="true">
                ·
              </span>
              <span>
                {st.name + " has one theme (" + T.base + ") "}
                <button
                  type="button"
                  className="sd-lnk"
                  onClick={() =>
                    st.open({
                      kind: "chat",
                      prefill:
                        "Add a " +
                        other +
                        " theme to " +
                        st.name +
                        ", keyed to data-theme on <html> (and prefers-color-scheme when nothing is chosen), with a visible theme switch.",
                    })
                  }
                >
                  {"Add a " + other + " theme"}
                </button>
              </span>
            </li>
          </ul>
        </>
      ) : null}
      {act.length ? (
        <>
          <h4 className="sd-qh4">Activity</h4>
          <ul className="sd-list" data-k="inbox-activity">
            {act.map((t, i) => (
              <li key={i}>
                <Spin />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

const ORDER: Record<string, number> = {
  gap: 0,
  agent: 1,
  lane: 2,
  board: 3,
  console: 4,
};
function QuestionQueue({
  v,
  open,
  live,
  aq,
  refetch,
}: {
  v: any;
  open: any[];
  live: any[];
  aq: any;
  refetch: () => void;
}) {
  const [skip, setSkip] = useState<Record<string, number>>({});
  const [pv, setPv] = useState<{
    key: string;
    qid: string;
    i: number | null;
    visual: any;
    label: string;
  } | null>(null);
  const queue = useMemo(
    () =>
      open
        .slice()
        .sort(
          (a, b) =>
            (skip[a.id] || 0) - (skip[b.id] || 0) ||
            (ORDER[a.kind] ?? 5) - (ORDER[b.kind] ?? 5) ||
            String(a.at).localeCompare(String(b.at)),
        ),
    [open, skip],
  );
  if (!queue.length) {
    const x = v.flow && v.flow.next && v.flow.next[0];
    return (
      <div className="sd-qcard calm" data-k="qa-calm">
        <p className="sd-qt">Nothing needs your answer.</p>
        <p className="sd-hint">
          {live.length
            ? live.map((j) => j.label).join(", ") +
              " may ask you something when " +
              (live.length > 1 ? "they finish." : "it finishes.")
            : aq
              ? aq.label +
                " asks you the next questions; your answers build staging."
              : x
                ? "Next: " + x.label + ". " + (v.flow.produces || x.why)
                : "This card is ready."}
        </p>
      </div>
    );
  }
  return (
    <>
      {pv ? (
        <QPreview v={v} pv={pv} onBack={() => setPv(null)} refetch={refetch} />
      ) : null}
      {queue.map((q, i) => (
        <QCard
          key={q.id}
          q={q}
          i={i}
          n={queue.length}
          open={open}
          v={v}
          refetch={refetch}
          onLater={() =>
            setSkip((s) => ({
              ...s,
              [q.id]: Math.max(0, ...Object.values(s)) + 1,
            }))
          }
          onPreview={(x) => setPv({ ...x, qid: q.id })}
          previewKey={pv ? pv.key : null}
        />
      ))}
    </>
  );
}

/** card-studio.js answerQ: the answer (a chip, a visual's Choose this, or the text) with its option index; every answer builds. */
async function answerQ(
  app: string,
  q: any,
  text: string,
  option: number | undefined,
  say: (t: string, ok?: boolean) => void,
) {
  const t = String(text || "").trim();
  if (!t) throw new Error("Pick an answer or write one");
  const j: any = await studioWrite(
    app,
    "app",
    "questions/" + q.id + "/answer",
    {
      answer: t,
      advance: true,
      ...(Number.isInteger(option) ? { option } : {}),
    },
  );
  const built = Boolean(j && j.built && j.built.ok && j.built.change);
  const a = j && j.advanced;
  say(
    "Answered" +
      (built
        ? "; the staging build of everything decided is queued"
        : j && j.built && j.built.error
          ? "; the staging build was not queued: " + j.built.error
          : "") +
      (a && a.label ? "; " + a.label + " runs with your answer" : ""),
  );
  return j;
}

function VThumb({ v }: { v: any }) {
  const st = useStudio();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    const el = box.current;
    if (!el || v.kind !== "mockup") return;
    const fit = () => el.clientWidth && setScale(el.clientWidth / 1280);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [v.kind]);
  if (v.kind === "mockup")
    return (
      <div className="sd-vthumb" ref={box}>
        <iframe
          src={studioFileSrc(st.app, "app", "file/" + v.file)}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          aria-hidden="true"
          title={v.name || "Mockup"}
          style={{ transform: "scale(" + scale + ")" }}
        />
      </div>
    );
  if (v.kind === "swatch")
    return <div className="sd-vthumb">{swatch(v.colors, "sd-sw")}</div>;
  return (
    <div className="sd-vthumb">
      <img
        src={v.file ? studioFileSrc(st.app, "app", "file/" + v.file) : v.src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
const swatch = (cs: string[], cls: string) => (
  <div className={cls} aria-hidden="true">
    {(cs || [])
      .filter((c) => HEXC.test(c))
      .map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
  </div>
);

function QCard({
  q,
  i,
  n,
  open,
  v,
  refetch,
  onLater,
  onPreview,
  previewKey,
}: {
  q: any;
  i: number;
  n: number;
  open: any[];
  v: any;
  refetch: () => void;
  onLater: () => void;
  onPreview: (x: {
    key: string;
    i: number | null;
    visual: any;
    label: string;
  }) => void;
  previewKey: string | null;
}) {
  const st = useStudio();
  const A = useActs(refetch);
  const [text, setText] = useState("");
  const [img, setImg] = useState<{ file: string; name: string } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const chosen = v.rec && v.rec.chosen ? v.rec.chosen.file : null;
  const opts: any[] = q.options || [];
  const visual = opts.some((o) => o.visual);
  const send = (key: string, t: string, option?: number) =>
    A.run(
      key,
      async () => {
        const r = await answerQ(
          st.app,
          q,
          img
            ? String(t || "").trim() + " (attached image: " + img.file + ")"
            : t,
          option,
          st.say,
        );
        setText("");
        setImg(null);
        return r;
      },
      "q",
    );
  const pick = (o: any, oi: number) =>
    A.run(
      "pick-" + oi,
      async () => {
        const mock = o.visual && o.visual.kind === "mockup" && o.visual.file;
        if (mock && chosen !== o.visual.file)
          await studioWrite(st.app, "app", "choose", {
            file: o.visual.file,
            build: false,
          });
        const r = await answerQ(st.app, q, o.label, oi, st.say);
        return r;
      },
      "q",
    );
  const answer = () => {
    if (String(text || "").trim()) return send("send", text);
    const oi = opts.findIndex(
      (o) =>
        o &&
        o.visual &&
        o.visual.kind === "mockup" &&
        o.visual.file &&
        o.visual.file === chosen,
    );
    return oi >= 0 ? send("send", opts[oi].label, oi) : send("send", text);
  };
  const next = (() => {
    if (
      q.kind === "agent" &&
      !open.some(
        (x) =>
          x !== q &&
          x.kind === "agent" &&
          x.context &&
          q.context &&
          x.context.job === q.context.job,
      )
    )
      return (
        "Answering re-runs " +
        ((q.context && q.context.label) || "that job") +
        " with your answers."
      );
    return "Answering builds it in staging.";
  })();
  const grow = () => {
    const t = ta.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.max(92, Math.min(t.scrollHeight + 2, 360)) + "px";
  };
  useEffect(grow, [text]);
  const onFile = () => {
    const f = fileIn.current && fileIn.current.files && fileIn.current.files[0];
    if (!f) return;
    if (f.size > 5 << 20) {
      A.flash("q", "Image too large (5 MB at most)");
      return;
    }
    const rd = new FileReader();
    rd.onload = () =>
      A.run(
        "img",
        async () => {
          const j: any = await studioWrite(st.app, "app", "attach", {
            kind: "image",
            name: f.name,
            data: String(rd.result),
          });
          const im = (((j && j.view) || v).rec.attachments || [])
            .filter((x: any) => x.kind === "image")
            .pop();
          setImg(im ? { file: im.file, name: f.name } : null);
          st.say("Image attached: " + f.name);
          return j;
        },
        "q",
      );
    rd.readAsDataURL(f);
    if (fileIn.current) fileIn.current.value = "";
  };
  const refs = (q.refs || []).filter((r: any) => r && r.kind);
  return (
    <div className="sd-qcard" data-k={"qcard-" + q.id}>
      <div className="sd-hint">
        {"From " + qFrom(q) + (n > 1 ? " · " + (i + 1) + " of " + n : "")}
      </div>
      <p className="sd-qt" id={"sd-qt-" + q.id}>
        {q.text}
      </p>
      {refs.length ? (
        <div className="sd-refs">
          <span>Mentioned:</span>
          {refs.map((r: any, ri: number) => (
            <button
              key={ri}
              type="button"
              className="sd-lnk"
              data-k={"qr-" + ri}
              aria-label={"See it: " + r.name}
              onClick={() =>
                onPreview({
                  key: q.id + ":r" + ri,
                  i: null,
                  visual: r,
                  label: r.name,
                })
              }
            >
              {"See " + r.name}
            </button>
          ))}
        </div>
      ) : null}
      {visual ? (
        <div
          className="sd-vgrid"
          role="group"
          aria-label="Suggested answers: preview one, then choose it"
        >
          {opts.map((o, oi) => {
            if (!o.visual) return null;
            const vv = o.visual,
              key = q.id + ":" + oi,
              on = previewKey === key;
            const sub =
              vv.name &&
              !lc_(vv.name).includes(lc_(o.label)) &&
              !lc_(o.label).includes(lc_(vv.name))
                ? vv.name
                : vv.name &&
                    lc_(vv.name) !== lc_(o.label) &&
                    lc_(vv.name).includes(lc_(o.label))
                  ? vv.name.replace(/:.*$/, "")
                  : vv.kind === "swatch" && !vv.name
                    ? (vv.colors || []).join(" ")
                    : null;
            const mock = vv.kind === "mockup" && vv.file,
              ch = mock && chosen === vv.file;
            return (
              <div
                key={oi}
                className={
                  "sd-vcard" + (on ? " on" : "") + (ch ? " chosen" : "")
                }
              >
                <VThumb v={vv} />
                {vv.kind === "mockup" && (vv.colors || []).length
                  ? swatch(vv.colors, "sd-vpal")
                  : null}
                <div className="sd-vname">{o.label}</div>
                {sub ? <div className="sd-vsub">{sub}</div> : null}
                {on ? (
                  <span className="ap-chip sd-vcur">In the preview now</span>
                ) : null}
                <button
                  type="button"
                  className="sd-vbtn"
                  data-k={"qv-" + oi}
                  aria-pressed={on}
                  aria-label={
                    "Preview " +
                    o.label +
                    (vv.name && lc_(vv.name) !== lc_(o.label)
                      ? ", " + vv.name
                      : "") +
                    (vv.current ? ", in the preview now" : "")
                  }
                  onClick={() =>
                    onPreview({ key, i: oi, visual: vv, label: o.label })
                  }
                />
                <WBtn
                  can={st.canWrite}
                  busy={A.busy["pick-" + oi]}
                  className={"cp-btn sm sd-use" + (ch ? " on" : "")}
                  k={"qpick-" + oi}
                  title={
                    "Answer with this" +
                    (mock ? " and make it the desired UI" : "")
                  }
                  onClick={() => pick(o, oi)}
                >
                  {ch ? "✓ Chosen" : "Choose this"}
                  <span className="sr-only">
                    {": " +
                      o.label +
                      (mock ? " (it becomes the desired UI)" : "")}
                  </span>
                </WBtn>
              </div>
            );
          })}
        </div>
      ) : null}
      {opts.some((o) => !o.visual) ? (
        <div
          className="sd-row"
          role="group"
          aria-label={visual ? "Other answers" : "Suggested answers"}
        >
          {opts.map((o, oi) =>
            o.visual ? null : (
              <WBtn
                key={oi}
                can={st.canWrite}
                busy={A.busy["opt-" + oi]}
                className="cp-btn sm sd-opt"
                title={o.detail || null}
                onClick={() => send("opt-" + oi, o.label, oi)}
              >
                {o.label}
              </WBtn>
            ),
          )}
        </div>
      ) : null}
      <textarea
        ref={ta}
        className="sd-ta"
        data-k={"qa-text-" + q.id}
        rows={4}
        placeholder={
          opts.length ? "Or answer in your own words" : "Your answer"
        }
        aria-labelledby={"sd-qt-" + q.id}
        maxLength={2000}
        value={text}
        disabled={!st.canWrite}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            answer();
          }
        }}
      />
      <div className="sd-row sd-qsend">
        <WBtn
          can={st.canWrite}
          busy={A.busy.img}
          k={"qa-img-" + q.id}
          title="Attach an image to this answer"
          onClick={() => fileIn.current && fileIn.current.click()}
        >
          {img ? "Image: " + img.name : "Attach image"}
        </WBtn>
        <input
          ref={fileIn}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={onFile}
        />
        {n > 1 ? (
          <button type="button" className="sd-lnk" onClick={onLater}>
            Later
          </button>
        ) : null}
        <WBtn
          can={st.canWrite}
          busy={A.busy.nn}
          className="sd-lnk"
          title={
            q.kind === "board"
              ? "Withdraws it in the studio; the board question stays until it is answered there"
              : null
          }
          onClick={() =>
            A.run(
              "nn",
              () =>
                studioWrite(st.app, "app", "questions/" + q.id + "/withdraw", {
                  on: true,
                }),
              "q",
            )
          }
        >
          Not needed
        </WBtn>
        <span className="st-sp" />
        <span className="sd-hint sd-kbd">
          {(isMac() ? "⌘" : "Ctrl") + "+Enter"}
        </span>
        <WBtn
          can={st.canWrite}
          busy={A.busy.send}
          className="cp-btn sm sd-pri"
          k={"qa-send-" + q.id}
          onClick={answer}
        >
          Answer
        </WBtn>
      </div>
      {next ? <p className="sd-hint sd-m0">{next}</p> : null}
      <ErrLine text={A.err.q} onClear={() => A.clear("q")} />
    </div>
  );
}

/** The preview of a visual option or a mentioned thing (legacy draws it in the main preview; here it opens over the questions). */
function QPreview({
  v,
  pv,
  onBack,
  refetch,
}: {
  v: any;
  pv: {
    key: string;
    qid: string;
    i: number | null;
    visual: any;
    label: string;
  };
  onBack: () => void;
  refetch: () => void;
}) {
  const st = useStudio();
  const A = useActs(refetch);
  const q = ((v.rec && v.rec.questions) || []).find(
    (x: any) => x.id === pv.qid && x.state === "open",
  );
  const vv = pv.visual;
  const chosen = v.rec && v.rec.chosen ? v.rec.chosen.file : null;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (back.current) back.current.focus();
  }, [pv.key]);
  return (
    <section
      className="sd-qpv"
      aria-label={"Preview: " + (vv.name || pv.label)}
      data-k="qpv"
    >
      <div className="sd-row">
        <h4 className="sd-qh4 sd-m0">Preview</h4>
        <span className="ap-chip t-a">
          {pv.i == null
            ? "Mentioned in a question"
            : "An answer to the question"}
        </span>
        <span className="st-sp" />
        {pv.i != null && q ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.choose}
            className="cp-btn sm sd-pri"
            k="qpv-choose"
            onClick={() =>
              A.run("choose", async () => {
                if (vv.kind === "mockup" && vv.file && chosen !== vv.file)
                  await studioWrite(st.app, "app", "choose", {
                    file: vv.file,
                    build: false,
                  });
                const r = await answerQ(
                  st.app,
                  q,
                  pv.label,
                  pv.i as number,
                  st.say,
                );
                onBack();
                return r;
              })
            }
          >
            Choose this<span className="sr-only">{": " + pv.label}</span>
          </WBtn>
        ) : null}
        <button
          ref={back}
          type="button"
          className="cp-btn sm ghost"
          data-k="qpv-back"
          onClick={onBack}
        >
          Back
        </button>
      </div>
      <div className="sd-row">
        <b>{vv.name || pv.label}</b>
        {vv.name && !lc_(vv.name).includes(lc_(pv.label)) ? (
          <span className="sd-hint">{pv.label}</span>
        ) : null}
        {vv.current ? (
          <span className="ap-chip">In the preview now</span>
        ) : null}
      </div>
      {vv.kind === "mockup" ? (
        <div className="sd-qpvframe">
          <iframe
            src={studioFileSrc(st.app, "app", "file/" + vv.file)}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            title={vv.name || pv.label}
          />
        </div>
      ) : vv.kind === "swatch" ? (
        <div
          className="sd-bigsw"
          role="list"
          aria-label={"Palette of " + (vv.name || pv.label)}
        >
          {(vv.colors || [])
            .filter((c: string) => HEXC.test(c))
            .map((c: string, i: number) => (
              <div role="listitem" key={i}>
                <i style={{ background: c }} />
                <span>{c}</span>
              </div>
            ))}
        </div>
      ) : (
        <div className="sd-bigimg">
          <img
            src={
              vv.file ? studioFileSrc(st.app, "app", "file/" + vv.file) : vv.src
            }
            alt={vv.name || pv.label}
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      <ErrLine text={A.err.choose} onClear={() => A.clear("choose")} />
    </section>
  );
}

/** What an answer changed in staging: the answered round's staging change (source answers) queued at or after the answer. */
function changedBy(v: any, a: any) {
  const t = Date.parse(a.answeredAt || 0),
    chs = ((v.staging && v.staging.changes) || []).filter(
      (c: any) => c.source === "answers" && Date.parse(c.at || 0) >= t - 2000,
    );
  return (
    chs.sort((x: any, y: any) => Date.parse(x.at) - Date.parse(y.at))[0] || null
  );
}
function AnsweredList({ v }: { v: any }) {
  const answered = ((v.rec && v.rec.questions) || [])
    .filter((q: any) => q.state === "answered")
    .reverse();
  if (!answered.length) return null;
  return (
    <details className="sd-inq" data-k="qa-answered">
      <summary>{"Answered (" + answered.length + ")"}</summary>
      <ol className="sd-qhist" data-k="qa-history">
        {answered.slice(0, 40).map((a: any) => {
          const c = changedBy(v, a);
          return (
            <li key={a.id}>
              <span className="sd-tq">{a.text}</span>
              <span className="sd-ta2">
                <b>{a.answer}</b>
              </span>
              {c ? (
                <span className="sd-hint sd-qchg">
                  Staging: <b>{c.title}</b>
                  {" · " + c.label}
                </span>
              ) : null}
              {a.answeredVia === "studio" && a.board && a.board.ok === false ? (
                <span
                  className="sd-hint"
                  title={a.board.error || a.board.out || ""}
                >
                  (kept in the studio)
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
function NoteQuestion({ refetch }: { refetch: () => void }) {
  const st = useStudio();
  const A = useActs(refetch);
  const [t, setT] = useState("");
  return (
    <div className="sd-qadd">
      <input
        type="text"
        className="sd-in"
        aria-label="Note a question for later"
        placeholder="Note a question for later"
        data-k="q-add"
        maxLength={800}
        value={t}
        disabled={!st.canWrite}
        title={st.canWrite ? undefined : "read-only on this device"}
        onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          A.run("add", async () => {
            const x = t.trim();
            if (x.length < 4) throw new Error("Write the question first");
            const j = await studioWrite(st.app, "app", "questions", {
              text: x,
            });
            setT("");
            st.say("Question noted");
            return j;
          });
        }}
      />
      <ErrLine text={A.err.add} onClear={() => A.clear("add")} k="q-add-err" />
    </div>
  );
}
/** The app's cards' open questions (legacy opens each card's studio; the card studio is not native, so each names its card). */
function CardQuestions({ v }: { v: any }) {
  const cq: any[] = (v.app && v.app.cardQuestions) || [];
  if (!cq.length) return null;
  return (
    <div className="sd-qcard calm sd-cq">
      <p className="sd-qt">Open questions on its cards</p>
      <ul className="sd-list">
        {cq.map((c) => (
          <li key={c.fa} data-k={"cq-" + c.fa}>
            <b>{c.title}</b> <span className="sd-hint">{c.fa}</span>{" "}
            <span className="ap-chip t-a">
              {c.open + (c.open === 1 ? " question" : " questions")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
