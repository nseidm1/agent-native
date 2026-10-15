/**
 * FA-19173: NEW DESIGN / ENHANCE EXISTING DESIGN (card-studio.js ND: ndOpen, ndStart, ndShow, ndStaging, ndRender). One studio job
 * (studio-newdesign.mjs) per kind: its determinate bar follows the job's STEP markers; the result opens as a REVIEW: the proposal (a
 * mockup per main screen, its palette, type, components, rules and what changed) beside the live staging app, with Apply (the desired
 * UI and its staging build in one click), Refine (one line of feedback -> the next version) and Discard.
 * ONE DELIBERATE CHANGE FROM LEGACY: opening it never starts the paid job. Legacy started it on open; here the job, its model, its cap
 * and the estimate for applying it are NAMED FIRST, with an optional brief, and nothing is spent until Start (app ask {action: kind}).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, studioFileSrc, studioRead, studioWrite, dur, narrowNow, usd, useStudio, when } from "../api";
import { StudioModal } from "../Modal";
import { ACTIVE, ND_KINDS, ND_STEPS, type NdKind, estApp, estimateOf, md, ndJob, ndProgress, useCaps, useFlash, useLive, usePutView, useView } from "./data";

const HEXC = /^#[0-9a-f]{6}$/i;
const ndClean = (t: unknown) =>
  String(t || "")
    .replace(/```(?:html|json)[\s\S]*?```/gi, "")
    .replace(/^#{2,4}\s*Screen:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const Spin = () => <i className="ap-spin" aria-hidden="true" />;
const MODEL = (m: string) => (/haiku/i.test(m) ? "Haiku" : /opus/i.test(m) ? "Opus" : /sonnet/i.test(m) ? "Sonnet" : m);

function useNarrow() {
  const [n, setN] = useState(() => narrowNow());
  useEffect(() => {
    const m = window.matchMedia("(max-width: 759px)");
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

export function NewDesignDialog({ which }: { which: NdKind }) {
  const st = useStudio();
  const { app, name, canWrite } = st;
  const K = ND_KINDS[which],
    KL = K.label,
    enh = which === "enhancedesign";
  const vq = useView(app);
  const v = vq.data;
  const [starting, setStarting] = useState(false);
  const [startedId, setStartedId] = useState<string | null>(null);
  const liveQ = useLive(app, Boolean(v && v.running) || starting || Boolean(startedId));
  const j0 = v ? ndJob(v, liveQ.data, which) : null;
  // the dialog opens on the job running or awaiting review; else on the start pane (the cost first, nothing spent)
  const [mode, setMode] = useState<"start" | "job" | null>(null);
  useEffect(() => {
    if (mode === null && v) setMode(j0 && (ACTIVE(j0) || (j0.status === "done" && !j0.reviewed)) ? "job" : "start");
  }, [v, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr, clearErr] = useFlash();
  const [brief, setBrief] = useState("");
  const [refine, setRefine] = useState("");
  const [sel, setSel] = useState(0);
  const [side, setSide] = useState<"prop" | "stg">("prop");
  const [busy, setBusy] = useState<string | null>(null);
  const { caps, err: capsErr } = useCaps(app, which);
  const putView = usePutView(app);
  const wide = !useNarrow();
  const refineRef = useRef<HTMLInputElement>(null);
  const full = Boolean(v && v.running >= v.maxRunning);
  const est = v ? estimateOf(v, estApp(v), estApp(v) === "staging" ? "a change to this app's staging copy" : "a change to this app") : null;

  async function start(message: string, followOf?: string) {
    if (starting) return;
    setStarting(true);
    clearErr();
    try {
      const x = await studioWrite<any>(app, "app", "ask", { action: which, message: message || "", followOf: followOf || undefined, ...(caps || {}) });
      putView(x);
      setStartedId(x && x.id ? String(x.id) : null);
      setMode("job");
      setSel(0);
      st.say(followOf ? "Refining the design: the next version is being made" : KL + " started: its progress shows in the dialog");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setStarting(false);
    }
  }
  async function act(k: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(k);
    clearErr();
    try {
      await fn();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  // the job this dialog shows: the one just started once the record has it, else the kind's current proposal
  const j = mode === "job" ? (startedId && j0 && j0.id !== startedId ? null : j0) : null;
  const p = j ? ndProgress(j) : null;
  const title = ((j && j.label) || KL) + " · " + name;
  const capLine = caps ? MODEL(caps.model) + " · cap " + usd(caps.maxUsd) + " / " + caps.maxMin + " min" : capsErr ? "Could not read the job's cap: " + capsErr : "Reading the job's cap…";

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (!v || mode === null) {
    body = (
      <p className="sg-msg" role="status">
        <Spin /> Reading the studio…
      </p>
    );
  } else if (mode === "start" && !starting) {
    // THE COST IS NAMED BEFORE ANYTHING IS SPENT
    const why = !canWrite ? READ_ONLY : full ? v.maxRunning + " jobs are running (the most at once)" : !caps ? (capsErr ? "Could not read the job's cap: " + capsErr : "Reading the job's cap…") : undefined;
    body = (
      <section className="sg-start" aria-label={"Start " + KL} data-k="nd-start">
        <p className="sg-lead">{K.does}.</p>
        <div className="sg-cost" role="note" data-k="nd-cost">
          <div className="sg-cost-h">What it costs, before anything is spent</div>
          <div className="sg-cost-r">
            <span className="sg-cost-k">This job</span>
            <b data-k="nd-caps">{capLine}</b>
            <span className="sg-dim">a paid agent job; it stops at its cap</span>
          </div>
          <div className="sg-cost-r">
            <span className="sg-cost-k">The imagery</span>
            <b>$0</b>
            <span className="sg-dim">drawn on the Halo</span>
          </div>
          <div className="sg-cost-r">
            <span className="sg-cost-k">Applying it</span>
            {est ? (
              <span className="ap-chip" data-k={"estimate-" + estApp(v)} title={est.title} aria-label={est.title}>
                {est.text}
              </span>
            ) : (
              <b>No estimate yet</b>
            )}
            <span className="sg-dim">a staging change, only when you press Apply on the review</span>
          </div>
        </div>
        <ol className="sg-steps" aria-label={"The steps of " + KL}>
          {ND_STEPS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ol>
        <label className="sg-lab" htmlFor="sg-nd-brief">
          Brief for the agent (optional)
        </label>
        <textarea
          id="sg-nd-brief"
          className="cp-in area sg-ta"
          rows={4}
          maxLength={4000}
          value={brief}
          data-k="nd-brief"
          onChange={(e) => setBrief(e.target.value)}
          placeholder={enh ? "What to improve first, for example: calmer header, bigger numbers, clearer empty states" : "A direction for the new style, for example: warmer, editorial, photography-led"}
        />
        <p className="sg-dim">{enh ? "It keeps the current design language and applies the design rules to it" : "It starts from the app's purpose and your decisions, with a new style from the design knowledge"}; nothing changes in the app until you Apply.</p>
      </section>
    );
    footer = (
      <>
        <button type="button" className="cp-btn sg-pri" data-k="nd-go" disabled={Boolean(why) || starting} title={why} onClick={() => start(brief.trim())}>
          {starting ? <Spin /> : null}Start {KL}
        </button>
        <button type="button" className="cp-btn ghost" data-k="nd-cancel" onClick={() => st.close()}>
          Cancel
        </button>
        <span className="sg-sp" />
        <span className="sg-dim">{capLine}</span>
      </>
    );
  } else if (!j) {
    body = (
      <p className="sg-msg" role="status">
        <Spin /> Starting {KL}…
      </p>
    );
  } else if (ACTIVE(j) && p) {
    body = (
      <section className="sg-prog" aria-label={"Progress of " + KL}>
        <div className="sg-row">
          <Spin />
          <b>{p.step ? "Step " + p.step + " of " + ND_STEPS.length + ": " + p.label : p.label}</b>
          <span className="sg-sp" />
          <span className="sg-pct">{p.pct}%</span>
        </div>
        <div className="sg-meter big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-valuetext={p.pct + "%, " + p.label} aria-label={KL + " progress"} data-k="nd-progress">
          <i style={{ width: p.pct + "%" }} />
        </div>
        <ol className="sg-steps">
          {ND_STEPS.map((l, i) => (
            <li key={l} className={i + 1 < p.step ? "done" : i + 1 === p.step ? "on" : undefined} aria-current={i + 1 === p.step ? "step" : undefined}>
              <span aria-hidden="true">{i + 1 < p.step ? "✓ " : ""}</span>
              {l}
            </li>
          ))}
        </ol>
        {j.phase ? <p className="sg-dim">Now: {j.phase}</p> : null}
        <div className="sg-row">
          <span className="sg-dim">
            {MODEL(j.model || "sonnet")} · cap ${j.maxUsd} / {j.maxMin} min · {enh ? "it keeps the current design language and applies the design rules to it" : "it starts from the app's purpose and your decisions, with a new style from the design knowledge"}; the imagery is drawn on the Halo; nothing changes in the app until you Apply
          </span>
          <span className="sg-sp" />
          <button type="button" className="cp-btn sm danger" data-k="nd-stop" disabled={!canWrite || busy === "stop"} title={canWrite ? undefined : READ_ONLY} onClick={() => act("stop", () => studioWrite(app, "app", "jobs/" + j.id + "/stop", {}).then(putView))}>
            {busy === "stop" ? <Spin /> : null}Stop
          </button>
        </div>
      </section>
    );
  } else if (j.status !== "done") {
    body = (
      <div className="sg-msg" role="alert">
        <b>
          {j.label} {j.status === "stopped" ? "was stopped" : "failed"}
        </b>
        {j.error ? <p>{j.error}</p> : null}
        <div className="sg-row">
          <button type="button" className="cp-btn sg-pri" data-k="nd-again" disabled={!canWrite || full || starting} title={!canWrite ? READ_ONLY : full ? v.maxRunning + " jobs are running (the most at once)" : undefined} onClick={() => start("")}>
            {starting ? <Spin /> : null}Try again
          </button>
          <span className="sg-dim">{capLine}</span>
        </div>
      </div>
    );
  } else {
    body = <Review j={j} sel={sel} setSel={setSel} side={side} setSide={setSide} wide={wide} enh={enh} />;
    const applied = j.reviewed && j.reviewed.state === "applied";
    footer = (
      <>
        <button
          type="button"
          className="cp-btn sg-pri"
          data-k="nd-apply"
          disabled={!canWrite || busy === "apply"}
          title={canWrite ? "Make it the desired UI of " + name + " and build it in staging now" : READ_ONLY}
          onClick={() =>
            act("apply", async () => {
              const x = await studioWrite(app, "app", "newdesign/apply", { job: j.id });
              putView(x);
              st.say(j.label + " is the desired UI; its staging build is queued");
              st.close();
            })
          }
        >
          {busy === "apply" ? <Spin /> : null}
          {applied ? "Apply again" : "Apply"}
        </button>
        <input
          ref={refineRef}
          type="text"
          className="cp-in sg-refine"
          maxLength={400}
          placeholder={'Refine: one line of feedback, e.g. "calmer header, bigger numbers"'}
          aria-label="Refine the design: your feedback"
          data-k="nd-refine-text"
          value={refine}
          disabled={!canWrite}
          onChange={(e) => setRefine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget.parentElement?.querySelector("[data-k=nd-refine]") as HTMLButtonElement | null)?.click();
            }
          }}
        />
        <button
          type="button"
          className="cp-btn"
          data-k="nd-refine"
          disabled={!canWrite || full || starting}
          title={!canWrite ? READ_ONLY : full ? v.maxRunning + " jobs are running (the most at once)" : "The next version, from your line: " + capLine}
          onClick={() => {
            const t = refine.trim();
            if (t.length < 2) {
              setErr("Write one line of feedback first");
              refineRef.current?.focus();
              return;
            }
            setRefine("");
            void start(t, j.id);
          }}
        >
          {starting ? <Spin /> : null}Refine
        </button>
        <button
          type="button"
          className="cp-btn ghost"
          data-k="nd-discard"
          disabled={!canWrite || busy === "discard"}
          title={canWrite ? undefined : READ_ONLY}
          onClick={() =>
            act("discard", async () => {
              const x = await studioWrite(app, "app", "jobs/" + j.id + "/discard", {});
              putView(x);
              st.say(j.label + " discarded");
              st.close();
            })
          }
        >
          {busy === "discard" ? <Spin /> : null}Discard
        </button>
        {applied ? (
          <span className="sg-dim" role="status">
            Applied {when(j.reviewed.at)}: building in staging
          </span>
        ) : null}
        <span className="sg-dim sg-cost-tail">
          {usd(j.costUsd)} · {dur(j.wallMs)}
        </span>
      </>
    );
  }
  return (
    <StudioModal open onClose={st.close} title={title} size={j && j.status === "done" ? "xl" : "lg"} testid="sg-nd" footer={footer ? <div className="sg-foot">{footer}</div> : undefined}>
      <div className="sg-nd" data-k="nd-dialog" data-kind={which}>
        {err ? (
          <p className="sg-err" role="alert" title="Tap to dismiss" onClick={clearErr}>
            {err}
          </p>
        ) : null}
        {body}
      </div>
    </StudioModal>
  );
}

/** The live staging app beside the proposal (studio-live.mjs info: its frame base, or why there is none). */
function StagingNow() {
  const st = useStudio();
  const [s, setS] = useState<{ loading?: boolean; info?: any; error?: string }>({ loading: true });
  useEffect(() => {
    let on = true;
    studioRead<any>(st.app, "app", "frame/_/info")
      .then((info) => on && setS({ info }))
      .catch((e) => on && setS({ error: errText(e) }));
    return () => {
      on = false;
    };
  }, [st.app]);
  const i = s.info,
    stg = i && i.staging;
  if (s.loading)
    return (
      <div className="sg-msg" role="status">
        <Spin /> Opening the staging app…
      </div>
    );
  if (s.error || !(i && i.platform === "web" && stg && stg.exists && stg.base))
    return (
      <div className="sg-msg" role="status">
        {s.error ? "Could not reach the staging app: " + s.error : i && i.platform && i.platform !== "web" ? st.name + " is not a web app: it has no live frame here" : st.name + " has no staging copy yet" + (stg && stg.why ? ": " + stg.why : "")}
      </div>
    );
  return <iframe src={stg.base} title={st.name + ", the staging app now"} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="same-origin" data-k="nd-staging-frame" />;
}

function Box({ t, children, k }: { t: string; children: React.ReactNode; k?: string }) {
  return (
    <div className="sg-box" data-k={k}>
      <h4>{t}</h4>
      {children}
    </div>
  );
}

function Review({ j, sel: sel0, setSel, side, setSide, wide, enh }: { j: any; sel: number; setSel: (n: number) => void; side: "prop" | "stg"; setSide: (s: "prop" | "stg") => void; wide: boolean; enh: boolean }) {
  const st = useStudio();
  const { app, canWrite } = st;
  const putView = usePutView(app);
  const [err, setErr, clearErr] = useFlash();
  const [drawBusy, setDrawBusy] = useState(false);
  const frameUrl = (f: string, seq?: number) => studioFileSrc(app, "app", "file/" + f) + (seq ? "?seq=" + seq : "");
  const sc = useMemo(() => (j.screens && j.screens.length ? j.screens : [{ n: 1, name: "Main screen", mockup: j.mockup }]).filter((s: any) => s.mockup), [j]);
  const sel = Math.min(sel0, Math.max(0, sc.length - 1));
  const pr = j.proposal || {},
    kb = j.kb || {};
  const pal = (pr.palette && pr.palette.length ? pr.palette : kb.palette ? ["primary", "accent", "background"].filter((k) => kb.palette[k]).map((k) => ({ role: k, hex: kb.palette[k] })) : []).filter((c: any) => HEXC.test(c.hex));
  const type = pr.type && (pr.type.heading || pr.type.body) ? pr.type : kb.type;
  const rules: string[] = pr.rules && pr.rules.length ? pr.rules : kb.rules || [];
  const im = j.imagery || null,
    imgs: any[] = im && im.made ? im.made : [],
    rd = j.imageryRedo || null,
    run = rd && rd.run,
    drawing = Boolean(run && ["queued", "working"].includes(run.status));
  const qc = j.qwen || null;
  const chg =
    pr.changes && pr.changes.length ? (
      <ul>
        {pr.changes.map((c: any, i: number) => (
          <li key={i}>
            <b>{c.what}</b>
            {c.why ? " - " + c.why : ""}
            {c.rule ? <span className="ap-chip t-d sg-rule">{c.rule}</span> : null}
          </li>
        ))}
      </ul>
    ) : (
      <p className="sg-dim">Under Full proposal below.</p>
    );
  return (
    <>
      {wide ? null : (
        <div className="sg-seg" role="group" aria-label="Show">
          {(
            [
              ["prop", "Proposal"],
              ["stg", "Staging now"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={side === k} data-k={"nd-side-" + k} onClick={() => setSide(k)}>
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="sg-grid">
        <section className={"sg-pane" + (!wide && side !== "prop" ? " off" : "")} aria-label="The proposal">
          <div className="sg-ph">
            <b>Proposal</b>
            {sc.length > 1 ? (
              <div className="sg-seg" role="group" aria-label="Screens of the proposal">
                {sc.map((s: any, i: number) => (
                  <button key={i} type="button" aria-pressed={i === sel} data-k={"nd-screen-" + (i + 1)} onClick={() => setSel(i)}>
                    {s.name}
                  </button>
                ))}
              </div>
            ) : sc[0] ? (
              <span className="sg-dim">{sc[0].name}</span>
            ) : null}
          </div>
          <div className="sg-fw">
            {sc[sel] ? (
              <iframe key={sc[sel].mockup} src={frameUrl(sc[sel].mockup, (j.imagery && j.imagery.redraws) || 0)} sandbox="allow-scripts" referrerPolicy="no-referrer" title={"Proposal: " + sc[sel].name} data-k="nd-proposal-frame" />
            ) : (
              <div className="sg-msg">This version has no screen mockups: Refine asks for them.</div>
            )}
          </div>
        </section>
        <section className={"sg-pane" + (!wide && side !== "stg" ? " off" : "")} aria-label="The staging app now">
          <div className="sg-ph">
            <b>Staging now</b>
            <span className="sg-dim">live, as it is</span>
          </div>
          <div className="sg-fw">
            <StagingNow />
          </div>
        </section>
      </div>
      <div className="sg-info">
        <Box t={enh ? "Improvements (the rule behind each)" : "What changed vs staging"}>{chg}</Box>
        {!enh && pr.direction ? (
          <Box t="Why a new direction">
            <p>{pr.direction}</p>
          </Box>
        ) : null}
        <Box t="Imagery" k="nd-imagery">
          {im ? (
            <p className="sg-dim" role="status" data-k="nd-imagery-note">
              {(rd && rd.note) || im.note}
            </p>
          ) : (
            <p className="sg-dim">This version predates generated imagery.</p>
          )}
          {drawing ? (
            <p className="sg-dim" role="status" aria-live="polite" data-k="nd-draw-progress">
              <Spin /> {run.status === "queued" ? "Starting the drawing" : run.phase || "Drawing on the Halo"}
              {run.auto ? " (automatic retry: the Halo has the memory now)" : ""}
              {run.at ? " · since " + when(run.at) : ""}
            </p>
          ) : run && run.status !== "done" ? (
            <p className="sg-dim" role="status" data-k="nd-draw-progress">
              Draw the images {run.status === "skipped" ? "skipped again" : "failed"}: {String(run.why || "no reason given").slice(0, 300)}
            </p>
          ) : run && run.status === "done" ? (
            <p className="sg-dim" role="status" data-k="nd-draw-progress">
              Drawn again on the Halo: {run.made} of {run.asked}
              {run.endedAt ? " · " + when(run.endedAt) : ""}
            </p>
          ) : null}
          {rd && rd.can ? (
            <div className="sg-row">
              <button
                type="button"
                className="cp-btn sm"
                data-k="nd-draw-images"
                disabled={!canWrite || drawBusy}
                title={canWrite ? "Re-runs only the image step on the Halo for this proposal's " + ((j.proposal && j.proposal.imagery) || []).length + " images: no paid model call" : READ_ONLY}
                onClick={async () => {
                  setDrawBusy(true);
                  clearErr();
                  try {
                    const x = await studioWrite(app, "app", "newdesign/draw", { job: j.id });
                    putView(x);
                    st.say("Drawing the images on the Halo");
                  } catch (e) {
                    setErr(errText(e));
                  } finally {
                    setDrawBusy(false);
                  }
                }}
              >
                {drawBusy ? <Spin /> : null}Draw the images
              </button>
            </div>
          ) : null}
          {err ? (
            <p className="sg-err" role="alert" onClick={clearErr}>
              {err}
            </p>
          ) : null}
          {imgs.length ? (
            <div className="sg-imgs">
              {imgs.map((i: any) => (
                <figure key={i.file}>
                  <img src={frameUrl(i.file)} alt={i.alt || i.name} loading="lazy" width={i.w || undefined} height={i.h || undefined} />
                  <figcaption>
                    {i.name}
                    {i.screen ? " · " + i.screen : ""}
                    {i.ms ? " · " + (i.ms / 1000).toFixed(1) + " s" : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </Box>
        <Box t="Palette">
          {pal.length ? (
            <div className="sg-swatch">
              {pal.map((c: any, i: number) => (
                <span key={i}>
                  <i style={{ background: c.hex }} aria-hidden="true" />
                  {(c.role ? c.role + " " : "") + c.hex}
                </span>
              ))}
            </div>
          ) : (
            <p className="sg-dim">Not stated.</p>
          )}
        </Box>
        <Box t="Type">
          <p>{type ? [type.heading && "Headings: " + type.heading, type.body && "Body: " + type.body].filter(Boolean).join(" · ") : "Not stated."}</p>
          {kb.style ? (
            <p className="sg-dim">
              Design knowledge: {kb.style}
              {kb.product ? " for " + kb.product : ""}
            </p>
          ) : null}
        </Box>
        {pr.components && pr.components.length ? (
          <Box t="Components">
            <div className="sg-chips">
              {pr.components.map((c: string, i: number) => (
                <span key={i} className="ap-chip t-d">
                  {c}
                </span>
              ))}
            </div>
          </Box>
        ) : null}
        <Box t="Rules applied">
          {rules.length ? (
            <ul>
              {rules.slice(0, 12).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <p className="sg-dim">Not stated.</p>
          )}
        </Box>
      </div>
      {qc ? (
        <section className="sg-box sg-qwen" data-k="nd-qwen" aria-label="Qwen3.8 critique" aria-busy={qc.status === "working"}>
          <h4>Second opinion · Qwen3.8 on the Halo (free, advice only)</h4>
          {qc.status === "working" ? (
            <p className="sg-dim" role="status">
              <Spin />
              <span data-k="nd-qwen-phase"> {qc.phase || "Qwen3.8 is reading the screens…"}</span>
            </p>
          ) : qc.status === "done" ? (
            <>
              <p className="sg-dim">
                {qc.note || ""}
                {qc.ms ? " · " + Math.round(qc.ms / 1000) + " s" : ""}
              </p>
              <div className="sg-md" dangerouslySetInnerHTML={{ __html: md(qc.text || "") }} />
            </>
          ) : (
            <p className="sg-dim" role="status">
              {(qc.status === "skipped" ? "No second opinion: " : "The second opinion failed: ") + (qc.why || "unknown")}
            </p>
          )}
        </section>
      ) : null}
      <details className="sg-full">
        <summary>Full proposal (summary, references, notes)</summary>
        <div className="sg-md" dangerouslySetInnerHTML={{ __html: md(ndClean(j.result)) }} />
      </details>
    </>
  );
}
