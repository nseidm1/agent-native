/**
 * FA-19175: the agent jobs on the studio record, as the Details drawer shows them (card-studio.js jobHead, jobCard, researchView,
 * candView, conceptView, sourcesView, applyPicker, useBtn): each result with its state, time, cost and model; a mockup in a sandboxed
 * frame (Phone width, Make it the desired UI, Open full size); research results (reference cards, concepts, licence-guarded images
 * and clips, sources); the result's text; proposed parts (Build these in staging); and Stop, Apply to brief, Adopt decision, Ask a
 * follow-up, Pin, Try again, Discard / Restore. Every write is the studio's own (app jobs/<id>/..., apply, decision, ask, children,
 * choose, capture, attach, use, asset).
 */
import { useState } from "react";

import { studioFileSrc, studioWrite, usd, useStudio } from "../api";
import {
  ACTIVE,
  agoShort,
  durShort,
  ErrLine,
  JOB_TONE,
  JOB_WORD,
  Md,
  SECTIONS,
  Spin,
  useActs,
  WBtn,
} from "./common";

export type Ctx = {
  v: any;
  refetch: () => void;
  followUp: (j: any) => void;
  apply: Record<string, { sel: Record<string, boolean> | null; mode: string }>;
  setApply: (
    f: (
      a: Record<string, { sel: Record<string, boolean> | null; mode: string }>,
    ) => Record<string, { sel: Record<string, boolean> | null; mode: string }>,
  ) => void;
};

export const RESEARCH = new Set([
  "uxresearch",
  "ideation",
  "content",
  "video",
  "stock",
  "teardown",
]);
const NOTABLE: [string, string][] = [
  ["layout", "Layout"],
  ["hierarchy", "Hierarchy"],
  ["interaction", "Interaction"],
  ["motion", "Motion"],
  ["copy", "Copy"],
];

/** The record's own files (mockups, attachments, references, assets): app file/<f>. */
export const fileSrc = (app: string, f: string) =>
  studioFileSrc(app, "app", "file/" + f);

export function JobHead({ j }: { j: any }) {
  const live = ACTIVE(j);
  return (
    <div className="sd-jh">
      <b>{j.label}</b>
      <span className={"ap-chip " + (JOB_TONE[j.status] || "")}>
        {live ? <Spin /> : null}
        {JOB_WORD[j.status] || j.status}
      </span>
      {live && j.startedAt ? (
        <span className="sd-hint">
          {durShort(Date.now() - Date.parse(j.startedAt)) +
            " of " +
            j.maxMin +
            " min"}
        </span>
      ) : null}
      {!live && j.wallMs ? (
        <span className="sd-hint">{durShort(j.wallMs)}</span>
      ) : null}
      <span className="sd-hint">
        {(j.costUsd ? usd(j.costUsd) + " of " : "cap ") + "$" + j.maxUsd}
      </span>
      <span className="sd-hint">
        {String(j.model || "").replace(/^claude-/, "")}
      </span>
      {j.pinned ? <span className="ap-chip t-a">Pinned</span> : null}
      <span className="st-sp" />
      <time className="sd-hint" dateTime={j.at} title={j.at}>
        {agoShort(j.at) + " ago"}
      </time>
    </div>
  );
}

/** card-studio.js useBtn: make a proposal the UI the app is built toward (choose), confirmed when it replaces another. */
export function UseBtn({
  v,
  file,
  name,
  label,
  refetch,
  onErr,
}: {
  v: any;
  file: string;
  name?: string;
  label?: string;
  refetch: () => void;
  onErr: (m: string) => void;
}) {
  const st = useStudio();
  const A = useActs(refetch);
  if (!v || !v.card || !v.card.app || !file) return null;
  const p = v.pin && v.pin.pinned,
    desired = v.pin && v.pin.desired;
  const on = Boolean(
    p && p.source && p.source.fa === v.card.fa && p.source.file === file,
  );
  const app = v.card.appName || v.card.app;
  return (
    <WBtn
      can={st.canWrite}
      busy={A.busy.use}
      className={"cp-btn sm sd-use" + (on ? " on" : "")}
      pressed={on}
      k={"use-" + file}
      title={
        on
          ? "This proposal is the desired UI of " +
            app +
            ": every build targets it"
          : "Make this proposal the UI " +
            app +
            " is built toward (the live site stays Current)"
      }
      onClick={() => {
        if (on) {
          st.say(
            (name || "This proposal") + " is already the desired UI of " + app,
          );
          return;
        }
        if (
          p &&
          desired &&
          !desired.same &&
          !window.confirm(
            'Make this the desired UI instead of "' +
              p.name +
              '"?\n\n"' +
              p.name +
              '" moves to the history (restorable).',
          )
        )
          return;
        A.run("use", async () => {
          try {
            const j: any = await studioWrite(st.app, "app", "choose", { file });
            const nm =
              (j && j.view && j.view.rec.chosen && j.view.rec.chosen.name) ||
              "It";
            st.say(
              nm +
                " is the desired UI of " +
                app +
                (j.built && j.built.staged
                  ? "; its build in staging is queued"
                  : j.built && j.built.error
                    ? "; its build was not queued: " + j.built.error
                    : "; Current is the live site"),
            );
            return j;
          } catch (e) {
            onErr(
              (e instanceof Error ? e.message : String(e)).replace(
                /^Action [\w-]+ failed:\s*/,
                "",
              ),
            );
            throw e;
          }
        });
      }}
    >
      {on ? "✓ The desired UI" : label || "Make it the desired UI"}
      {name ? <span className="sr-only">{": " + name}</span> : null}
    </WBtn>
  );
}

const Unverified = () => (
  <span
    className="ap-chip t-r"
    title="The agent named this link but its transcript never opened or saw it: check it before relying on it"
  >
    Unverified link
  </span>
);
const Ext = ({ u, t, cls }: { u: string; t?: string; cls?: string }) => (
  <a href={u} target="_blank" rel="noopener noreferrer" className={cls}>
    {t || u}
  </a>
);

export function JobCard({ j, ctx }: { j: any; ctx: Ctx }) {
  const st = useStudio();
  const { v, refetch } = ctx;
  const A = useActs(refetch);
  const [phone, setPhone] = useState(false);
  const [all, setAll] = useState(false);
  const live = ACTIVE(j);
  const text =
    j.mockup || RESEARCH.has(j.action)
      ? String(j.result || "")
          .replace(/```html[\s\S]*?```/gi, "")
          .replace(
            /```json[\s\S]*?```/gi,
            j.refs || j.concepts || j.candidates || j.clips ? "" : "$&",
          )
          .replace(
            /^#{1,3}\s+Sources\s*$[\s\S]*?(?=^#{1,3}\s|$(?![\s\S]))/im,
            j.sources ? "" : "$&",
          )
      : j.result;
  const long = String(text || "").length > 1400;
  const be =
    v.estimate && (v.estimate.stagingBreakdown || v.estimate.breakdown);
  const sent = (j.staged || []).length > 0,
    noApp = !v.card.app;
  return (
    <article
      className={"sd-job" + (j.pinned ? " pinned" : "")}
      aria-label={j.label + " " + (JOB_WORD[j.status] || "")}
      data-k={"job-" + j.id}
    >
      <JobHead j={j} />
      {j.message ? <div className="sd-jq">{"Asked: " + j.message}</div> : null}
      <div className={"sd-jb" + (all ? " all" : "")}>
        {live ? (
          <div className="sd-hint" role="status">
            {j.status === "queued"
              ? "Starting the agent…"
              : j.phase
                ? "Now: " + j.phase + "…"
                : "The agent is working; the result appears here when it finishes."}
          </div>
        ) : null}
        {j.status === "failed" || j.status === "stopped" ? (
          <div className={j.status === "failed" ? "sd-err" : "sd-hint"}>
            {j.error || (j.status === "stopped" ? "Stopped." : "Failed.")}
          </div>
        ) : null}
        {j.status === "done" ? (
          <>
            {j.mockup ? (
              <>
                <div className="sd-row">
                  <div className="sd-hint">Mockup (sandboxed, no network)</div>
                  <span className="st-sp" />
                  <button
                    type="button"
                    className="cp-btn sm ghost"
                    aria-pressed={phone}
                    onClick={() => setPhone(!phone)}
                  >
                    {phone ? "Wide" : "Phone width"}
                  </button>
                  <UseBtn
                    v={v}
                    file={j.mockup}
                    name={j.label}
                    refetch={refetch}
                    onErr={(m) => A.flash("job", m)}
                  />
                  <a
                    className="cp-btn sm ghost"
                    href={fileSrc(st.app, j.mockup)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open full size
                  </a>
                </div>
                <div className={"sd-frame" + (phone ? " phone" : "")}>
                  <iframe
                    src={fileSrc(st.app, j.mockup)}
                    sandbox="allow-scripts"
                    title={"Mockup from " + j.label}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </>
            ) : null}
            {j.refs || j.concepts || j.candidates || j.clips ? (
              <ResearchView j={j} ctx={ctx} onErr={(m) => A.flash("job", m)} />
            ) : null}
            <Md src={text} className={long && !all ? "long" : ""} />
            {long ? (
              <button
                type="button"
                className="cp-btn sm ghost sd-mt6"
                aria-expanded={all}
                onClick={() => setAll(!all)}
              >
                {all ? "Show less" : "Show all"}
              </button>
            ) : null}
            {j.note ? <div className="sd-hint">{j.note}</div> : null}
            {(j.sources || []).length ? <SourcesView src={j.sources} /> : null}
            {(j.children || []).length ? (
              <>
                <h4 className="sd-h4 sd-mt10">Proposed parts</h4>
                <ol className="sd-kids">
                  {j.children.map((c: any, i: number) => (
                    <li key={i}>
                      <strong>{c.title}</strong>
                      {" - " +
                        c.outcome +
                        ((c.dependsOn || []).length
                          ? " (after " + c.dependsOn.join(", ") + ")"
                          : "")}
                    </li>
                  ))}
                </ol>
                {be && be.job === j.id && be.usd ? (
                  <p className="sd-hint" data-k="estimate-breakdown">
                    {"Estimate: " +
                      be.text +
                      ((be.notes || []).length
                        ? ". " + be.notes.join(". ")
                        : "")}
                  </p>
                ) : null}
                <div className="sd-row">
                  <WBtn
                    can={st.canWrite}
                    busy={A.busy.kids}
                    disabled={sent || noApp}
                    className="cp-btn sm sd-pri"
                    title={
                      noApp
                        ? "This card belongs to no app, so it has no staging copy"
                        : "Each part becomes a staging change, in order; each has its own bar"
                    }
                    onClick={() =>
                      A.run(
                        "kids",
                        async () => {
                          const r: any = await studioWrite(
                            st.app,
                            "app",
                            "children",
                            { job: j.id, dry: false },
                          );
                          st.say(
                            ((r && r.staged) || []).length +
                              " staging changes queued, in order",
                          );
                          return r;
                        },
                        "job",
                      )
                    }
                  >
                    {sent ? "Sent to staging" : "Build these in staging"}
                  </WBtn>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <ErrLine text={A.err.job} onClear={() => A.clear("job")} />
      {ctx.apply[j.id] ? (
        <ApplyPicker j={j} ctx={ctx} onErr={(m) => A.flash("job", m)} />
      ) : null}
      <div className="sd-jf">
        {live ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.stop}
            className="cp-btn sm danger"
            onClick={() =>
              A.run(
                "stop",
                () => studioWrite(st.app, "app", "jobs/" + j.id + "/stop", {}),
                "job",
              )
            }
          >
            Stop
          </WBtn>
        ) : null}
        {j.status === "done" ? (
          <>
            <button
              type="button"
              className="cp-btn sm"
              aria-expanded={Boolean(ctx.apply[j.id])}
              onClick={() =>
                ctx.setApply((a) => {
                  if (a[j.id]) {
                    const { [j.id]: _, ...r } = a;
                    return r;
                  }
                  return { ...a, [j.id]: { sel: null, mode: "replace" } };
                })
              }
            >
              Apply to brief
            </button>
            {j.decision ? (
              <WBtn
                can={st.canWrite}
                busy={A.busy.adopt}
                onClick={() =>
                  A.run(
                    "adopt",
                    () =>
                      studioWrite(st.app, "app", "decision", {
                        text: j.decision.text,
                        why: j.decision.why,
                        from: j.id,
                      }),
                    "job",
                  )
                }
              >
                Adopt decision
              </WBtn>
            ) : null}
            <button
              type="button"
              className="cp-btn sm"
              onClick={() => ctx.followUp(j)}
            >
              Ask a follow-up
            </button>
            <WBtn
              can={st.canWrite}
              busy={A.busy.pin}
              pressed={Boolean(j.pinned)}
              onClick={() =>
                A.run(
                  "pin",
                  () =>
                    studioWrite(st.app, "app", "jobs/" + j.id + "/pin", {
                      on: !j.pinned,
                    }),
                  "job",
                )
              }
            >
              {j.pinned ? "Unpin" : "Pin"}
            </WBtn>
          </>
        ) : null}
        {j.status === "failed" || j.status === "stopped" ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.again}
            onClick={() =>
              A.run(
                "again",
                () =>
                  studioWrite(st.app, "app", "ask", {
                    action: j.action,
                    message: j.message,
                    model: /opus/.test(j.model)
                      ? "opus"
                      : /haiku/.test(j.model)
                        ? "haiku"
                        : "sonnet",
                    maxUsd: j.maxUsd,
                    maxMin: j.maxMin,
                  }),
                "job",
              )
            }
          >
            Try again
          </WBtn>
        ) : null}
        {!live ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.discard}
            onClick={() =>
              A.run(
                "discard",
                () =>
                  studioWrite(st.app, "app", "jobs/" + j.id + "/discard", {
                    on: !j.discarded,
                  }),
                "job",
              )
            }
          >
            {j.discarded ? "Restore" : "Discard"}
          </WBtn>
        ) : null}
      </div>
    </article>
  );
}

function secOf(hd: string): string | null {
  if (/judge/i.test(hd)) return "judge";
  if (/change\s*line/i.test(hd)) return "change";
  const rx: [string, RegExp][] = [
    ["stories", /stor(y|ies)/i],
    ["acceptance", /acceptance|criteria/i],
    ["metrics", /metric|success|measure/i],
    ["deps", /depend/i],
    ["risks", /risk|question/i],
    ["design", /design|layout|ux\b|ui\b/i],
    ["scope", /scope/i],
    ["users", /who|audience|persona|job.to.be.done|jtbd/i],
    ["problem", /problem|goal/i],
  ];
  for (const [k, r] of rx) if (r.test(hd)) return k;
  return null;
}
const found = (j: any) => {
  const keys: Record<string, boolean> = {};
  const parts = String(j.result || "").split(/^#{1,3}\s+(.+)$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const k = secOf(parts[i]);
    if (k && String(parts[i + 1] || "").trim()) keys[k] = true;
  }
  if (j.change) keys.change = true;
  if (j.judge) keys.judge = true;
  return keys;
};
/** card-studio.js applyPicker: apply a result to the brief's sections (replace or append). */
export function ApplyPicker({
  j,
  ctx,
  onErr,
  title,
}: {
  j: any;
  ctx: Ctx;
  onErr?: (m: string) => void;
  title?: string;
}) {
  const st = useStudio();
  const A = useActs(ctx.refetch);
  const f = found(j);
  const cur = ctx.apply[j.id] || { sel: null, mode: "replace" };
  const sel = cur.sel || (Object.keys(f).length ? { ...f } : {});
  const set = (
    patch: Partial<{ sel: Record<string, boolean>; mode: string }>,
  ) =>
    ctx.setApply((a) => ({
      ...a,
      [j.id]: { ...(a[j.id] || { sel: null, mode: "replace" }), sel, ...patch },
    }));
  const close = () =>
    ctx.setApply((a) => {
      const { [j.id]: _, ...r } = a;
      return r;
    });
  const opts: [string, string][] = [
    ...SECTIONS.map(([k, t]) => [k, t] as [string, string]),
    ["change", "CHANGE line"],
    ["judge", "Judge outline"],
  ];
  return (
    <div className="sd-pick" data-k={"apply-" + j.id}>
      {title ? (
        <div className="sd-jh">
          <b>{title}</b>
        </div>
      ) : null}
      <fieldset>
        <legend>
          Apply this result to (sections the result has are marked; a single
          pick takes the whole result if it has no matching heading):
        </legend>
        {opts.map(([k, t]) => (
          <label key={k}>
            <input
              type="checkbox"
              checked={Boolean(sel[k])}
              data-k={"ap-" + j.id + "-" + k}
              onChange={(e) => set({ sel: { ...sel, [k]: e.target.checked } })}
            />
            {t}
            {f[k] ? <em>in result</em> : null}
          </label>
        ))}
      </fieldset>
      <div className="sd-row">
        <select
          className="sd-in"
          aria-label="Replace or append"
          value={cur.mode}
          onChange={(e) => set({ mode: e.target.value })}
        >
          <option value="replace">Replace the section</option>
          <option value="append">Append to it</option>
        </select>
        <span className="st-sp" />
        <button type="button" className="cp-btn sm ghost" onClick={close}>
          Cancel
        </button>
        <WBtn
          can={st.canWrite}
          busy={A.busy.apply}
          className="cp-btn sm sd-pri"
          onClick={() =>
            A.run("apply", async () => {
              const keys = Object.keys(sel).filter((k) => sel[k]);
              if (!keys.length) throw new Error("Pick at least one section");
              const r: any = await studioWrite(st.app, "app", "apply", {
                job: j.id,
                sections: keys,
                mode: cur.mode,
              });
              close();
              st.say(
                "Applied to " +
                  keys.length +
                  " section" +
                  (keys.length > 1 ? "s" : "") +
                  (r && r.skipped && r.skipped.length
                    ? "; nothing found for " + r.skipped.join(", ")
                    : ""),
              );
              return r;
            })
          }
        >
          Apply
        </WBtn>
      </div>
      <ErrLine text={A.err.apply} onClear={() => A.clear("apply")} />
    </div>
  );
}

function ResearchView({
  j,
  ctx,
  onErr,
}: {
  j: any;
  ctx: Ctx;
  onErr: (m: string) => void;
}) {
  const st = useStudio();
  const A = useActs(ctx.refetch);
  const rec = ctx.v.rec;
  const used = new Set((rec.assets || []).map((a: any) => a.pageUrl));
  const run = (k: string, fn: () => Promise<unknown>) =>
    A.run(k, async () => {
      try {
        return await fn();
      } catch (e) {
        onErr(
          (e instanceof Error ? e.message : String(e)).replace(
            /^Action [\w-]+ failed:\s*/,
            "",
          ),
        );
        throw e;
      }
    });
  return (
    <div className="sd-research">
      {(j.refs || []).length ? (
        <>
          <h4 className="sd-h4">{"Reference cards (" + j.refs.length + ")"}</h4>
          <div className="sd-refcards">
            {j.refs.map((r: any) => (
              <article
                className="sd-ref"
                key={r.i}
                aria-label={"Reference: " + (r.title || r.site)}
              >
                {r.shot ? (
                  <a
                    className="sd-shot"
                    href={fileSrc(st.app, r.shot)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={fileSrc(st.app, r.shot)}
                      alt={
                        "Screenshot of " +
                        (r.title || r.url) +
                        " (reference only)"
                      }
                      loading="lazy"
                    />
                  </a>
                ) : null}
                <Ext u={r.url} t={r.title || r.url} cls="t" />
                <div className="sd-hint">{r.site}</div>
                {Object.keys(r.notable || {}).length ? (
                  <dl>
                    {NOTABLE.filter(([k]) => r.notable[k]).map(([k, l]) => (
                      <div key={k}>
                        <dt>{l}</dt>
                        <dd>{r.notable[k]}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {(r.tags || []).length ? (
                  <div className="sd-tags" aria-label="Pattern tags">
                    {r.tags.map((t: string) => (
                      <span className="sd-tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="sd-row">
                  {r.seen ? null : <Unverified />}
                  <WBtn
                    can={st.canWrite}
                    busy={A.busy["cap" + r.i]}
                    onClick={() =>
                      run("cap" + r.i, async () => {
                        const x = await studioWrite(st.app, "app", "capture", {
                          job: j.id,
                          i: r.i,
                        });
                        st.say("Screenshot captured");
                        return x;
                      })
                    }
                  >
                    {r.shot ? "Capture again" : "Capture screenshot"}
                  </WBtn>
                  {rec.attachments.some((a: any) => a.url === r.url) ? (
                    <span className="sd-hint">In links</span>
                  ) : (
                    <WBtn
                      can={st.canWrite}
                      busy={A.busy["lnk" + r.i]}
                      onClick={() =>
                        run("lnk" + r.i, () =>
                          studioWrite(st.app, "app", "attach", {
                            kind: "link",
                            url: r.url,
                            title: String(r.title || r.site).slice(0, 120),
                          }),
                        )
                      }
                    >
                      Add to links
                    </WBtn>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {(j.concepts || []).length ? (
        <>
          <h4 className="sd-h4">{"Concepts (" + j.concepts.length + ")"}</h4>
          <div className="sd-cons">
            {j.concepts.map((c: any) => (
              <Concept
                key={c.i}
                j={j}
                c={c}
                ctx={ctx}
                run={run}
                busy={A.busy}
              />
            ))}
          </div>
        </>
      ) : null}
      {j.candidates ? (
        <Cands
          j={j}
          list={j.candidates}
          kind="image"
          title="Images"
          used={used}
          run={run}
          busy={A.busy}
        />
      ) : null}
      {j.clips ? (
        <Cands
          j={j}
          list={j.clips}
          kind="clip"
          title="Stock clips"
          used={used}
          run={run}
          busy={A.busy}
        />
      ) : null}
    </div>
  );
}
function Cands({
  j,
  list,
  kind,
  title,
  used,
  run,
  busy,
}: {
  j: any;
  list: any[];
  kind: string;
  title: string;
  used: Set<unknown>;
  run: (k: string, fn: () => Promise<unknown>) => void;
  busy: Record<string, boolean>;
}) {
  const ok = list.filter((c) => c.ok && !c.unpicked),
    more = list.filter((c) => c.ok && c.unpicked),
    no = list.filter((c) => !c.ok);
  return (
    <>
      <h4 className="sd-h4">
        {title +
          " (" +
          ok.length +
          " picked and cleared" +
          (more.length ? ", " + more.length + " more from the APIs" : "") +
          (no.length ? ", " + no.length + " rejected" : "") +
          ")"}
      </h4>
      {ok.length ? (
        <div className="sd-cands">
          {ok.map((c) => (
            <Cand
              key={c.i}
              j={j}
              c={c}
              kind={kind}
              used={used}
              run={run}
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <div className="sd-empty">
          The agent picked nothing that passed the licence guard.
        </div>
      )}
      {more.length ? (
        <details className="sd-rej">
          <summary>
            {"Other API results the agent did not pick (" +
              more.length +
              ", licence-cleared)"}
          </summary>
          <div className="sd-cands">
            {more.map((c) => (
              <Cand
                key={c.i}
                j={j}
                c={c}
                kind={kind}
                used={used}
                run={run}
                busy={busy}
              />
            ))}
          </div>
        </details>
      ) : null}
      {no.length ? (
        <details className="sd-rej">
          <summary>
            {"Rejected by the licence guard (" + no.length + ")"}
          </summary>
          <ul className="sd-src">
            {no.map((c, i) => (
              <li key={i}>
                {c.pageUrl ? (
                  <Ext u={c.pageUrl} t={c.title || c.pageUrl} />
                ) : (
                  c.title || "untitled"
                )}
                {" - " + (c.license || "unknown") + ": " + c.why}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
function Cand({
  j,
  c,
  kind,
  used,
  run,
  busy,
}: {
  j: any;
  c: any;
  kind: string;
  used: Set<unknown>;
  run: (k: string, fn: () => Promise<unknown>) => void;
  busy: Record<string, boolean>;
}) {
  const st = useStudio();
  const isUsed = used.has(c.pageUrl);
  return (
    <article
      className="sd-cand"
      aria-label={
        (kind === "clip" ? "Clip: " : "Image: ") + (c.title || "untitled")
      }
    >
      {c.thumb ? (
        <a
          className="th"
          href={c.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src={c.thumb}
            alt={c.title || "Candidate image"}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </a>
      ) : null}
      <Ext u={c.pageUrl} t={c.title || c.pageUrl} cls="t" />
      <div className="sd-row">
        <span className="ap-chip t-g" title={c.licenseUrl || undefined}>
          {c.license}
        </span>
        <span className="sd-hint">
          {(c.viaApi ? "via " : "") +
            (c.source || "") +
            (c.duration ? " · " + c.duration : "")}
        </span>
        {c.seen ? null : <Unverified />}
        {c.basis === "agent" ? (
          <span
            className="ap-chip t-a"
            title="Only the agent states this licence; check the page before using it"
          >
            Licence: agent's word
          </span>
        ) : (
          <span className="sd-hint">
            {c.basis === "api" ? "licence from the API" : "site licence"}
          </span>
        )}
      </div>
      <div className="at">{c.attribution}</div>
      {c.use ? <div className="sd-hint">{"For: " + c.use}</div> : null}
      <div className="sd-row">
        {isUsed ? (
          <span className="ap-chip">In the library</span>
        ) : (
          <WBtn
            can={st.canWrite}
            busy={busy["use" + kind + c.i]}
            className="cp-btn sm sd-pri"
            onClick={() => {
              const agent = c.basis === "agent";
              if (
                agent &&
                !window.confirm(
                  "Only the agent states that this is " +
                    c.license +
                    " by " +
                    c.author +
                    ". Open its page and check the licence and author first. Did you check it?",
                )
              )
                return;
              run("use" + kind + c.i, async () => {
                const x = await studioWrite(st.app, "app", "use", {
                  job: j.id,
                  kind,
                  i: c.i,
                  confirm: agent || undefined,
                });
                st.say((c.title || "Asset") + " added to the asset library");
                return x;
              });
            }}
          >
            {(c.basis === "agent" ? "Checked: " : "") +
              (kind === "clip" ? "Use this (record)" : "Use this")}
          </WBtn>
        )}
      </div>
    </article>
  );
}
function Concept({
  j,
  c,
  ctx,
  run,
  busy,
}: {
  j: any;
  c: any;
  ctx: Ctx;
  run: (k: string, fn: () => Promise<unknown>) => void;
  busy: Record<string, boolean>;
}) {
  const st = useStudio();
  const [show, setShow] = useState(false);
  const lib = ctx.v.rec.assets || [],
    has = (part: string) =>
      lib.some(
        (a: any) => a.job === j.id && a.concept === c.name && a.kind === part,
      );
  const save = (part: string, label: string, can: boolean) =>
    has(part) ? (
      <span className="ap-chip" key={part}>
        {label + " saved"}
      </span>
    ) : (
      <WBtn
        key={part}
        can={st.canWrite}
        busy={busy["asset" + c.i + part]}
        disabled={!can}
        title={can ? null : "Not licence-cleared"}
        onClick={() =>
          run("asset" + c.i + part, () =>
            studioWrite(st.app, "app", "asset", {
              job: j.id,
              concept: c.i,
              part,
            }),
          )
        }
      >
        {"Save " + label.toLowerCase()}
      </WBtn>
    );
  return (
    <article className="sd-con" aria-label={"Concept: " + c.name}>
      <div>
        <b>{c.name}</b>
        {c.pitch ? " - " + c.pitch : ""}
      </div>
      {(c.palette || []).length ? (
        <div className="sd-sws" role="list" aria-label="Palette">
          {c.palette.map((p: any, i: number) => (
            <div className="sd-swc" role="listitem" key={i}>
              <i style={{ background: p.hex }} aria-hidden="true" />
              {p.hex}
              <span>{p.role}</span>
            </div>
          ))}
        </div>
      ) : null}
      {(c.checks || []).length ? (
        <div className="sd-cc" aria-label="Contrast checks">
          {c.checks.map((x: any, i: number) => (
            <span
              key={i}
              className={
                "ap-chip " + (x.aa ? "t-g" : x.aaLarge ? "t-a" : "t-r")
              }
              title={x.fg + " on " + x.bg}
            >
              {x.fgRole +
                " on " +
                x.bgRole +
                " " +
                x.ratio +
                ":1 " +
                (x.aa ? "AA" : x.aaLarge ? "AA large only" : "fails AA")}
            </span>
          ))}
        </div>
      ) : null}
      {(c.fonts || []).length ? (
        <div className="sd-hint">
          Type:{" "}
          {c.fonts.map((f: any, i: number) => (
            <span key={i}>
              {i ? " + " : ""}
              <span
                style={
                  f.license ? undefined : { textDecoration: "line-through" }
                }
                title={
                  f.license ||
                  "licence not free or not recorded (" +
                    (f.claimed || "none") +
                    ")"
                }
              >
                {f.family + (f.role ? " (" + f.role + ")" : "")}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {c.icons ? (
        <div className="sd-hint">
          {"Icons: " +
            c.icons.set +
            (c.icons.license
              ? " (" + c.icons.license + ")"
              : " (not a known open-licensed set)")}
        </div>
      ) : null}
      <div className="sd-row">
        {save("palette", "Palette", (c.palette || []).length > 0)}
        {save(
          "fonts",
          "Fonts",
          (c.fonts || []).some((f: any) => f.license),
        )}
        {save("icons", "Icons", Boolean(c.icons && c.icons.license))}
        {c.mockup ? (
          <button
            type="button"
            className="cp-btn sm ghost"
            aria-expanded={show}
            onClick={() => setShow(!show)}
          >
            {show ? "Hide mockup" : "Show mockup"}
          </button>
        ) : null}
        {c.mockup ? (
          <UseBtn
            v={ctx.v}
            file={c.mockup}
            name={"Concept: " + c.name}
            refetch={ctx.refetch}
            onErr={() => undefined}
          />
        ) : null}
        {c.mockup ? (
          <a
            className="cp-btn sm ghost"
            href={fileSrc(st.app, c.mockup)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full size
          </a>
        ) : null}
      </div>
      {c.mockup && show ? (
        <div className="sd-frame">
          <iframe
            src={fileSrc(st.app, c.mockup)}
            sandbox="allow-scripts"
            title={"Mockup of concept " + c.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ height: 440 }}
          />
        </div>
      ) : null}
    </article>
  );
}
function SourcesView({ src }: { src: any[] }) {
  const un = src.filter((x) => !x.seen).length;
  return (
    <div>
      <h4 className="sd-h4 sd-mt10">
        {"Sources (" + src.length + (un ? ", " + un + " unverified" : "") + ")"}
      </h4>
      <ul className="sd-src">
        {src.map((x, i) => (
          <li key={i}>
            <Ext u={x.url} />
            {" · retrieved " + x.retrieved}
            {x.seen ? null : (
              <>
                {" "}
                <Unverified />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
