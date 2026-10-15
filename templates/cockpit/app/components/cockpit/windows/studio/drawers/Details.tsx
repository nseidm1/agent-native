/**
 * FA-19175: the studio's DETAILS drawer for an app (card-studio.js drawer / setTab / renderDHead and the app editor's tabs,
 * APP_TABS): Work (the staging changes with Undo / Retry / Stop, the promotion's cards being filed, its cards, the error log),
 * Brief (the nine sections, edit / save, the version history with Restore, links and images, decisions), Agents (Ask an agent:
 * a message or an action with its model and caps; the results), Messages (the conversation), Files (the asset library,
 * decisions, links and images) and Activity. Its header: Agent work $, Staging -> production, the estimate. Reads: app '' (the
 * record), app staged, app errors, app frame/_/info, studio actions; writes: the studio's own (ask, brief, restore, decision,
 * attach, staged/<id>/..., jobs/<id>/..., apply, choose ...).
 */
import { useEffect, useRef, useState } from "react";

import {
  studioRead,
  studioWrite,
  useStudio,
  useStudioRead,
  usd,
  when,
} from "../api";
import { StudioDrawer } from "../Modal";
import {
  ACTIVE,
  durShort,
  ErrLine,
  focusSoon,
  useReturnFocus,
  Md,
  SECTIONS,
  Spin,
  useActs,
  useAppView,
  WBtn,
} from "./common";
import { ApplyPicker, type Ctx, fileSrc, JobCard } from "./Jobs";

const TABS: [string, string][] = [
  ["work", "Work"],
  ["brief", "Brief"],
  ["agents", "Agents"],
  ["convo", "Messages"],
  ["files", "Files"],
  ["activity", "Activity"],
];
const GROUPS: [string, string][] = [
  ["product", "Product"],
  ["design", "Design"],
  ["research", "Research (web)"],
  ["content", "Content and media"],
];
type ApplyMap = Ctx["apply"];

const estShort = (q: any) => {
  const m = (x: number) =>
    x < 10 ? x.toFixed(1).replace(/\.0$/, "") : String(Math.round(x));
  return (
    "≈ $" +
    m(q.usd[0]) +
    "-" +
    m(q.usd[2]) +
    " · " +
    Math.round(q.min[0]) +
    "-" +
    Math.round(q.min[2]) +
    " min"
  );
};
const estTitle = (q: any, what: string) =>
  "Estimate for " +
  what +
  ": " +
  q.text +
  ((q.notes || []).length ? ". " + q.notes.join(". ") : "") +
  ((q.classes || []).length
    ? ". Classes: " +
      q.classes
        .map((c: any) => c.key)
        .filter((x: string, i: number, a: string[]) => a.indexOf(x) === i)
        .join(", ")
    : "") +
  ". Kept with the request when you commit; compared with the actual when it is released.";

export function DetailsDrawer() {
  const st = useStudio();
  const on = st.layer?.kind === "details";
  const want = st.layer?.kind === "details" ? st.layer.tab : undefined;
  const [tab, setTab] = useState<string>("work");
  const [sel, setSel] = useState("message");
  const [follow, setFollow] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [msg, setMsg] = useState("");
  const [apply, setApply] = useState<ApplyMap>({});
  const [edit, setEdit] = useState<Record<string, string>>({});
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on) setTab(want && TABS.some(([t]) => t === want) ? want : "work");
  }, [on, want]);
  // the drawer focuses its tab on open (legacy drawer(true))
  useEffect(() => {
    if (on)
      focusSoon(["[data-testid=studio-details] .sd-tab[aria-selected=true]"]);
  }, [on]);
  useReturnFocus(on, "[data-testid=studio] [data-k=details]");
  const vq = useAppView(on);
  const v = vq.data;
  const refetch = () => vq.refetch();
  const pick = (k: string) => {
    setSel(k);
    setTimeout(() => {
      const t = document.querySelector<HTMLTextAreaElement>(
        '[data-testid=studio-details] [data-k="msg"]',
      );
      if (t) t.focus();
    }, 0);
  };
  const followUp = (j: any) => {
    setFollow({ id: j.id, label: j.label });
    setSel("message");
    setTab("agents");
    setMsg("About your " + j.label + " result: ");
    setTimeout(() => {
      const t = document.querySelector<HTMLTextAreaElement>(
        '[data-testid=studio-details] [data-k="msg"]',
      );
      if (t) {
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }
    }, 0);
  };
  const ctx: Ctx = { v, refetch, followUp, apply, setApply };
  const rec = v && v.rec;
  const counts: Record<string, [number, number | string]> = v
    ? {
        agents: [
          v.running || 0,
          rec.jobs.filter((j: any) => j.action !== "message" && !j.discarded)
            .length,
        ],
        convo: [0, rec.jobs.filter((j: any) => j.action === "message").length],
        files: [
          0,
          rec.attachments.length +
            rec.decisions.length +
            (rec.assets || []).length,
        ],
        work: v.app
          ? [
              (v.app.activity || []).filter((a: any) => a.busy).length,
              (v.app.work.cards || []).length,
            ]
          : [0, 0],
      }
    : {};
  const estK =
    v && v.estimate && v.estimate.staging && v.estimate.staging.usd
      ? "staging"
      : "apply";
  const eq = v && v.estimate && v.estimate[estK];
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const i = TABS.findIndex(([t]) => t === tab);
    const n =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? TABS.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setTab(TABS[n][0]);
    e.preventDefault();
    setTimeout(() => {
      const b =
        tabsRef.current &&
        tabsRef.current.querySelector<HTMLButtonElement>(
          "[data-t=" + TABS[n][0] + "]",
        );
      if (b) b.focus();
    }, 0);
  };
  return (
    <StudioDrawer
      open={on}
      onClose={st.close}
      title="Details"
      testid="studio-details"
      extra={
        v ? (
          <span className="sd-dchips" data-k="dhead">
            <span
              className={"ap-chip" + (v.costUsd > 0 ? "" : " t-d")}
              title="Spent by studio jobs on this app"
            >
              {"Agent work " + usd(v.costUsd)}
            </span>
            <span
              className="ap-chip t-a"
              title="Studio changes build in staging; Promote to production files production cards"
            >
              Staging → production
            </span>
            {eq && eq.withheld ? (
              <span
                className="ap-chip"
                data-k={"estimate-" + estK}
                title={eq.text}
                aria-label={eq.text}
              >
                estimate withheld
              </span>
            ) : eq && eq.usd ? (
              <span
                className="ap-chip"
                data-k={"estimate-" + estK}
                title={estTitle(
                  eq,
                  estK === "staging"
                    ? "a change to this app's staging copy"
                    : "a change to this app",
                )}
              >
                {estShort(eq)}
              </span>
            ) : null}
          </span>
        ) : null
      }
    >
      <div
        className="sd-tabs"
        role="tablist"
        aria-label="Card details"
        ref={tabsRef}
        onKeyDown={onKey}
      >
        {TABS.map(([k, label]) => {
          const c = counts[k],
            live = Boolean(c && Number(c[0]) > 0),
            show = Boolean(c && (c[1] || live));
          return (
            <button
              key={k}
              type="button"
              role="tab"
              className="sd-tab"
              id={"sd-t-" + k}
              data-t={k}
              aria-selected={tab === k}
              aria-controls={"sd-p-" + k}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
            >
              {label}
              {show ? (
                <span className={"n" + (live ? " live" : "")}>
                  {live ? c[0] + (k === "work" ? " busy" : " running") : c[1]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        className="sd-pane"
        role="tabpanel"
        id={"sd-p-" + tab}
        aria-labelledby={"sd-t-" + tab}
        data-k={"pane-" + tab}
      >
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
        ) : tab === "work" ? (
          <WorkPane v={v} refetch={refetch} />
        ) : tab === "brief" ? (
          <BriefPane
            v={v}
            refetch={refetch}
            edit={edit}
            setEdit={setEdit}
            onAgent={() => {
              setTab("agents");
              pick("brief");
            }}
            onFiles={() => setTab("files")}
          />
        ) : tab === "agents" ? (
          <AgentsPane
            ctx={ctx}
            sel={sel}
            setSel={pick}
            follow={follow}
            setFollow={setFollow}
            msg={msg}
            setMsg={setMsg}
            onSent={(wasMsg) => (wasMsg ? setTab("convo") : undefined)}
          />
        ) : tab === "convo" ? (
          <ConvoPane
            ctx={ctx}
            onNew={() => {
              setSel("message");
              setFollow(null);
              setTab("agents");
              pick("message");
            }}
            onApply={(j) => {
              setApply((a) => ({
                ...a,
                [j.id]: { sel: null, mode: "append" },
              }));
              setTab("agents");
            }}
          />
        ) : tab === "files" ? (
          <FilesPane v={v} refetch={refetch} />
        ) : (
          <ActivityPane v={v} />
        )}
      </div>
    </StudioDrawer>
  );
}

// ---------- WORK: the staging changes, the promotion's filing, its cards, the error log
const STG_STEP = ["queued", "building", "saved", "live"];
const FILED = ["filed", "drafted", "landed", "released"];
function WorkPane({ v, refetch }: { v: any; refetch: () => void }) {
  const st = useStudio();
  const running = Boolean(v.staging && (v.staging.running || 0) > 0);
  const sq = useStudioRead<any>(st.app, "app", "staged", {
    every: running ? 3000 : 15000,
  });
  const envQ = useStudioRead<any>(st.app, "env", "", { every: 10000 });
  const fi = useStudioRead<any>(st.app, "app", "frame/_/info");
  const stg = sq.data || v.staging;
  const all: any[] = (stg && stg.changes) || [];
  const base =
    fi.data && fi.data.staging && fi.data.staging.running !== false
      ? fi.data.staging.base
      : null;
  const pm = envQ.data && envQ.data.promotion;
  const pf = (() => {
    if (!pm || pm.state !== "running") return null;
    const cards = pm.cards || [],
      n = cards.filter((c: any) => FILED.includes(c.stage) || c.fa).length;
    return n >= cards.length && cards.length ? null : { cards, n };
  })();
  const cards: any[] = (v.app && v.app.work && v.app.work.cards) || [];
  const TONE: Record<string, string> = {
    "in-progress": "",
    reopened: "t-a",
    released: "t-g",
  };
  const done = () => {
    refetch();
    sq.refetch();
  };
  return (
    <>
      <section
        className="sd-box"
        data-k="stg-history"
        aria-label="Staging changes"
      >
        <h3 className="sd-h3">{"Staging changes (" + all.length + ")"}</h3>
        {stg && stg.error ? (
          <div className="sd-err" role="alert">
            {"Staging changes could not be read: " + stg.error}
          </div>
        ) : all.length ? (
          <ul className="sd-stglist">
            {all.map((c) => (
              <StgRow
                key={c.id}
                c={c}
                base={v.card.app ? base : null}
                onDone={done}
              />
            ))}
          </ul>
        ) : (
          <p className="sd-empty">
            No staging changes yet: Agent, Ask me Questions and the design
            buttons make them.
          </p>
        )}
      </section>
      {pf ? (
        <div className="sd-box" data-k="being-filed">
          <h3 className="sd-h3">
            {"Promote to production: breaking " +
              pf.cards.length +
              " staging change" +
              (pf.cards.length === 1 ? "" : "s") +
              " into cards"}
          </h3>
          <div
            className="sd-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={pf.cards.length}
            aria-valuenow={pf.n}
            aria-label={pf.n + " of " + pf.cards.length + " cards filed"}
          >
            <i
              style={{
                width:
                  Math.round((100 * pf.n) / Math.max(1, pf.cards.length)) + "%",
              }}
            />
          </div>
          <p className="sd-hint">
            {pf.n + " of " + pf.cards.length + " cards filed"}
          </p>
          <ul className="sd-work">
            {pf.cards.map((c: any, i: number) => {
              const dn = FILED.includes(c.stage) || Boolean(c.fa),
                bad = c.stage === "failed";
              return (
                <li key={i}>
                  {dn ? (
                    <span aria-hidden="true">✓</span>
                  ) : bad ? (
                    <span className="ap-chip t-r">stuck</span>
                  ) : (
                    <Spin />
                  )}
                  <span className="sd-wt">
                    <b>{c.title}</b>
                    {c.fa ? (
                      <span className="sd-hint">{" " + c.fa}</span>
                    ) : null}
                    {c.why ? (
                      <span className="sd-hint">{" · " + c.why}</span>
                    ) : null}
                  </span>
                  <span className={"ap-chip" + (dn ? " t-g" : "")}>
                    {c.judge ? "judge: " + c.judge : c.stage || "planned"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="sd-box" data-k="its-cards">
        <h3 className="sd-h3">{"Its cards (" + cards.length + ")"}</h3>
        <p className="sd-hint sd-m0">
          The lane works these behind the scenes; Promote to production makes
          new ones from staging.
        </p>
        {cards.length ? (
          <ul className="sd-work">
            {cards.map((c) => (
              <li key={c.fa}>
                <span className={"ap-chip " + (TONE[c.col] || "")}>
                  {c.colWord}
                </span>
                <span className="sd-wt">
                  <b>{c.title}</b>
                  <span className="sd-hint">
                    {" " + c.fa + (c.stage ? " · " + c.stage : "")}
                  </span>
                </span>
                {c.draft ? (
                  <span className="ap-chip t-g">draft ready</span>
                ) : null}
                {c.openQuestions ? (
                  <span className="ap-chip t-a">
                    {c.openQuestions + " open"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="sd-empty">No cards yet.</p>
        )}
      </div>
      {v.app && v.app.errors ? <ErrorLog n={v.app.errors} /> : null}
    </>
  );
}
function StgRow({
  c,
  base,
  onDone,
}: {
  c: any;
  base: string | null;
  onDone: () => void;
}) {
  const st = useStudio();
  const A = useActs(onDone);
  const active = ["queued", "running"].includes(c.state);
  const chip =
    c.state === "done"
      ? c.undone
        ? "undone"
        : c.folded
          ? "live · folded"
          : STG_STEP[c.step] || "live"
      : c.state === "running"
        ? "building"
        : c.state;
  const tone =
    c.state === "done"
      ? "t-g"
      : ["failed", "stopped"].includes(c.state)
        ? "t-r"
        : "t-a";
  const words =
    "Step " +
    ((c.step || 0) + 1) +
    " of 4 · " +
    c.label +
    (c.elapsedMs
      ? " · " + durShort(c.elapsedMs) + " of about " + durShort(c.expectedMs)
      : "") +
    (c.also && c.also.length ? " · also built: " + c.also.join("; ") : "");
  const w = (k: string, path: string, said?: string) =>
    A.run(
      k,
      async () => {
        const j = await studioWrite(
          st.app,
          "app",
          "staged/" + c.id + "/" + path,
          {},
        );
        if (said) st.say(said);
        return j;
      },
      "row",
    );
  return (
    <li className={"sd-stg1 " + c.state} data-k={"staged-" + c.id}>
      <div className="sd-row">
        {active ? <Spin /> : null}
        <span className="t">{c.title}</span>
        <span className={"ap-chip " + tone}>{chip}</span>
        {c.costUsd ? (
          <span className="sd-hint">{"$" + Number(c.costUsd).toFixed(2)}</span>
        ) : null}
        <span className="st-sp" />
        {c.state === "done" && c.url && base ? (
          <a
            className="sd-lnk"
            href={base}
            target="_blank"
            rel="noopener noreferrer"
            title={"Served from " + c.url}
          >
            Open staging
          </a>
        ) : null}
        {c.state === "done" && !c.undone && !c.folded && c.source !== "undo" ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.undo}
            label={"Undo " + c.title}
            onClick={() =>
              w(
                "undo",
                "undo",
                'Undo of "' + c.title + '" is queued for the staging copy',
              )
            }
          >
            Undo
          </WBtn>
        ) : null}
        {["failed", "stopped"].includes(c.state) &&
        !c.retried &&
        c.source !== "undo" ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.retry}
            label={"Retry " + c.title}
            onClick={() =>
              w(
                "retry",
                "retry",
                '"' + c.title + '" is queued for the staging copy again',
              )
            }
          >
            Retry
          </WBtn>
        ) : null}
        {active ? (
          <WBtn
            can={st.canWrite}
            busy={A.busy.stop}
            className="cp-btn sm danger"
            label={"Stop " + c.title}
            onClick={() => w("stop", "stop")}
          >
            Stop
          </WBtn>
        ) : null}
      </div>
      {active ? (
        <div
          className="sd-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={c.pct}
          aria-valuetext={c.label}
          aria-label={"Staging change: " + c.title}
        >
          <i style={{ width: (c.pct || 0) + "%" }} />
        </div>
      ) : null}
      <details className="sd-w">
        <summary>{words}</summary>
        <div>{c.why || c.label}</div>
      </details>
      <ErrLine text={A.err.row} onClear={() => A.clear("row")} />
    </li>
  );
}
/** THE ERROR LOG: refused filings, opened on demand (history, not state: nothing here re-files). */
function ErrorLog({ n }: { n: number }) {
  const st = useStudio();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details
      className="sd-box"
      data-k="error-log"
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open || rows || busy)
          return;
        setBusy(true);
        studioRead<any>(st.app, "app", "errors")
          .then((j) => setRows(j.errors || []))
          .catch((x) =>
            setErr(
              (x instanceof Error ? x.message : String(x)).replace(
                /^Action [\w-]+ failed:\s*/,
                "",
              ),
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <summary>{"Error log (" + n + ")"}</summary>
      {busy ? (
        <div className="sd-row" role="status">
          <Spin /> Loading…
        </div>
      ) : rows ? (
        <ul className="sd-work">
          {rows.map((e, i) => (
            <li key={i}>
              <span className="sd-wt">
                <b>{e.title}</b>
                <span className="sd-hint">
                  {" · " + when(e.at) + " · " + e.why}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrLine text={err} onClear={() => setErr("")} />
    </details>
  );
}

// ---------- BRIEF
function BriefPane({
  v,
  refetch,
  edit,
  setEdit,
  onAgent,
  onFiles,
}: {
  v: any;
  refetch: () => void;
  edit: Record<string, string>;
  setEdit: (f: (e: Record<string, string>) => Record<string, string>) => void;
  onAgent: () => void;
  onFiles: () => void;
}) {
  const st = useStudio();
  const A = useActs(refetch);
  const [hist, setHist] = useState(false);
  const rec = v.rec,
    n = rec.versions.length,
    filled = SECTIONS.filter(
      ([k]) => String(rec.brief[k] || "").trim().length >= 12,
    ).length;
  const drop = (k: string) =>
    setEdit((e) => {
      const { [k]: _, ...rest } = e;
      return rest;
    });
  // Esc in a section being edited cancels that edit only (legacy), before the drawer's own Esc (a capture listener on the document) sees it
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const k =
        e.key === "Escape" &&
        t &&
        t.matches &&
        t.matches('[data-testid=studio-details] textarea[data-k^="ta-"]')
          ? String(t.getAttribute("data-k")).slice(3)
          : null;
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      drop(k);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  });
  const save = (k: string, title: string) =>
    A.run(
      "save-" + k,
      async () => {
        const j = await studioWrite(st.app, "app", "brief", {
          sections: { [k]: edit[k] },
          why: "edit " + title,
        });
        drop(k);
        return j;
      },
      "sec-" + k,
    );
  const atts = rec.attachments || [];
  const links = atts.filter((a: any) => a.kind === "link"),
    imgs = atts.filter((a: any) => a.kind === "image" || a.kind === "video");
  return (
    <div className="sd-box" data-k="brief">
      <div className="sd-row">
        <h3 className="sd-h3 sd-m0">Feature brief</h3>
        <span className="sd-hint">{filled + " of 9 sections"}</span>
        <span className="st-sp" />
        {n ? (
          <button
            type="button"
            className="cp-btn sm ghost"
            aria-expanded={hist}
            onClick={() => setHist(!hist)}
          >
            {"Edited " + n + " time" + (n === 1 ? "" : "s")}
          </button>
        ) : (
          <span className="sd-hint">Not edited yet</span>
        )}
        <button type="button" className="cp-btn sm" onClick={onAgent}>
          Write it with an agent
        </button>
      </div>
      {hist && n ? (
        <div className="sd-box sd-inner">
          <h3 className="sd-h3">Version history (newest first)</h3>
          <ol className="sd-ver" reversed>
            {[...rec.versions]
              .reverse()
              .slice(0, 30)
              .map((x: any) => (
                <li key={x.id + x.at}>
                  {when(x.at) +
                    " · " +
                    x.why +
                    " · " +
                    SECTIONS.filter(([k]) =>
                      String((x.brief || {})[k] || "").trim(),
                    ).length +
                    " sections "}
                  <WBtn
                    can={st.canWrite}
                    busy={A.busy["restore-" + x.id]}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Restore the version of " +
                            when(x.at) +
                            "? The current one is kept in the history.",
                        )
                      )
                        A.run(
                          "restore-" + x.id,
                          () =>
                            studioWrite(st.app, "app", "restore", {
                              id: x.id,
                              at: x.at,
                            }),
                          "hist",
                        );
                    }}
                  >
                    Restore
                  </WBtn>
                </li>
              ))}
          </ol>
          <ErrLine text={A.err.hist} onClear={() => A.clear("hist")} />
        </div>
      ) : null}
      {SECTIONS.map(([k, title, hint]) => {
        const val = String(rec.brief[k] || "");
        const editing = edit[k] !== undefined;
        return (
          <div className="sd-sec" key={k}>
            <div className="sd-sh">
              <h4 id={"sd-s-" + k}>{title}</h4>
              {!editing ? (
                <WBtn
                  can={st.canWrite}
                  k={"edit-" + k}
                  label={"Edit " + title}
                  className="cp-btn sm ghost"
                  onClick={() => {
                    setEdit((e) => ({ ...e, [k]: val }));
                    setTimeout(() => {
                      const t = document.querySelector<HTMLTextAreaElement>(
                        '[data-testid=studio-details] [data-k="ta-' + k + '"]',
                      );
                      if (t) t.focus();
                    }, 0);
                  }}
                >
                  {val ? "Edit" : "Write"}
                </WBtn>
              ) : null}
            </div>
            {editing ? (
              <>
                <textarea
                  className="sd-ta"
                  rows={Math.min(18, Math.max(4, val.split("\n").length + 2))}
                  aria-labelledby={"sd-s-" + k}
                  placeholder={hint}
                  data-k={"ta-" + k}
                  value={edit[k]}
                  onChange={(e) => {
                    const x = e.target.value;
                    setEdit((s) => ({ ...s, [k]: x }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      save(k, title);
                  }}
                />
                <div className="sd-row sd-mt6">
                  <WBtn
                    can={st.canWrite}
                    busy={A.busy["save-" + k]}
                    className="cp-btn sm sd-pri"
                    onClick={() => save(k, title)}
                  >
                    Save
                  </WBtn>
                  <button
                    type="button"
                    className="cp-btn sm ghost"
                    onClick={() => drop(k)}
                  >
                    Cancel
                  </button>
                  <span className="sd-hint">⌘/Ctrl + Enter saves</span>
                </div>
                <ErrLine
                  text={A.err["sec-" + k]}
                  onClear={() => A.clear("sec-" + k)}
                />
              </>
            ) : val.trim() ? (
              <Md src={val} />
            ) : (
              <div className="sd-empty">{hint}</div>
            )}
            {k === "design" && (rec.assets || []).length ? (
              <LibSummary as={rec.assets} onOpen={onFiles} />
            ) : null}
          </div>
        );
      })}
      {atts.length ? (
        <div className="sd-sec">
          <div className="sd-sh">
            <h4>Links and images</h4>
          </div>
          {links.length ? (
            <ul className="sd-md sd-ul">
              {links.map((a: any) => (
                <li key={a.id}>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.title || a.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {imgs.length ? <Gallery imgs={imgs} /> : null}
        </div>
      ) : null}
      {rec.decisions.length ? (
        <div className="sd-sec" data-k="brief-decisions">
          <div className="sd-sh">
            <h4>Decisions</h4>
          </div>
          <ul className="sd-md sd-ul">
            {rec.decisions.map((d: any) => (
              <li key={d.id}>
                <strong>{d.text}</strong>
                {d.why ? " - " + d.why : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
function Gallery({
  imgs,
  onRemove,
  busy,
  can,
}: {
  imgs: any[];
  onRemove?: (a: any) => void;
  busy?: Record<string, boolean>;
  can?: boolean;
}) {
  const st = useStudio();
  return (
    <div className="sd-gal">
      {imgs.map((a) => (
        <figure key={a.id}>
          <a
            href={fileSrc(st.app, a.file)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {a.kind === "video" ? (
              a.frames && a.frames.length ? (
                <img
                  src={fileSrc(st.app, a.frames[0])}
                  alt={
                    (a.title || "Attached video") + " (video, first key frame)"
                  }
                  loading="lazy"
                />
              ) : (
                <video
                  src={fileSrc(st.app, a.file)}
                  preload="metadata"
                  muted
                  aria-label={a.title || "Attached video"}
                />
              )
            ) : (
              <img
                src={fileSrc(st.app, a.file)}
                alt={a.title || "Attached image"}
                loading="lazy"
              />
            )}
          </a>
          <figcaption>
            {onRemove ? (
              <WBtn
                can={Boolean(can)}
                busy={busy && busy["rm-" + a.id]}
                className="cp-btn sm ghost sd-xs"
                label={"Remove image " + a.title}
                onClick={() => onRemove(a)}
              >
                Remove
              </WBtn>
            ) : null}
            {" " + (a.title || "")}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
function LibSummary({ as, onOpen }: { as: any[]; onOpen: () => void }) {
  const n = (k: string) => as.filter((a) => a.kind === k).length;
  const parts = (
    [
      ["image", "image"],
      ["clip", "clip"],
      ["palette", "palette"],
      ["fonts", "font set"],
      ["icons", "icon set"],
    ] as [string, string][]
  )
    .filter(([k]) => n(k))
    .map(([k, l]) => n(k) + " " + l + (n(k) > 1 ? "s" : ""))
    .join(", ");
  return (
    <div className="sd-hint sd-mt6">
      {"Asset library: " + parts + " · "}
      <button type="button" className="cp-btn sm ghost sd-xs" onClick={onOpen}>
        Open the library
      </button>
      {as
        .filter((a) => a.kind === "palette")
        .slice(0, 2)
        .map((a, i) => (
          <span key={i} className="sd-sws sd-inl" aria-hidden="true">
            {(a.palette || []).map((p: any, j: number) => (
              <i key={j} style={{ background: p.hex }} />
            ))}
          </span>
        ))}
    </div>
  );
}

// ---------- AGENTS: Ask an agent (the composer) and the results
function AgentsPane({
  ctx,
  sel,
  setSel,
  follow,
  setFollow,
  msg,
  setMsg,
  onSent,
}: {
  ctx: Ctx;
  sel: string;
  setSel: (k: string) => void;
  follow: { id: string; label: string } | null;
  setFollow: (f: { id: string; label: string } | null) => void;
  msg: string;
  setMsg: (m: string) => void;
  onSent: (wasMsg: boolean) => void;
}) {
  const st = useStudio();
  const { v } = ctx;
  const aq = useStudioRead<any>(st.app, "studio", "actions");
  const acts: any[] = (aq.data && aq.data.actions) || [];
  const [caps, setCaps] = useState<
    Record<string, { model: string; maxUsd: number; maxMin: number }>
  >({});
  const [showGone, setShowGone] = useState(false);
  const A = useActs(ctx.refetch);
  const capsOf = (k: string) => {
    const a = acts.find((x) => x.k === k) || {
      model: "sonnet",
      maxUsd: 2,
      maxMin: 20,
    };
    return caps[k] || { model: a.model, maxUsd: a.maxUsd, maxMin: a.maxMin };
  };
  const cur = acts.find((a) => a.k === sel) || {
    k: "message",
    label: "Message",
    does: "",
  };
  const cap = capsOf(sel);
  const setCap = (f: string, val: unknown) =>
    setCaps((c) => ({ ...c, [sel]: { ...capsOf(sel), [f]: val } }));
  const full = (v.running || 0) >= (v.maxRunning || 3);
  const send = () =>
    A.run("send", async () => {
      const message = msg.trim();
      if (sel === "message" && message.length < 2)
        throw new Error("Write a message first, or pick an action below");
      const j = await studioWrite(st.app, "app", "ask", {
        action: sel,
        message,
        model: cap.model,
        maxUsd: Number(cap.maxUsd),
        maxMin: Number(cap.maxMin),
        followOf: follow ? follow.id : undefined,
      });
      const wasMsg = sel === "message";
      setMsg("");
      setFollow(null);
      setSel("message");
      st.say(
        (wasMsg ? "Message sent" : cur.label + " started") +
          "; the result appears " +
          (wasMsg ? "in Conversation" : "below"),
      );
      onSent(wasMsg);
      return j;
    });
  const all = v.rec.jobs
    .filter((j: any) => j.action !== "message")
    .slice()
    .reverse();
  const shown = all.filter((j: any) => !j.discarded),
    gone = all.filter((j: any) => j.discarded);
  const replies = Object.keys(ctx.apply)
    .map((id) =>
      v.rec.jobs.find((j: any) => j.id === id && j.action === "message"),
    )
    .filter(Boolean);
  return (
    <>
      <div className="sd-box" data-k="composer">
        <label htmlFor="sd-msg">
          <h3 className="sd-h3">Ask an agent</h3>
        </label>
        {follow ? (
          <div className="sd-mb6">
            <span className="sd-follow">
              {"Following up on " + follow.label}
              <button
                type="button"
                aria-label="Cancel the follow-up"
                onClick={() => setFollow(null)}
              >
                ×
              </button>
            </span>
          </div>
        ) : null}
        <textarea
          id="sd-msg"
          className="sd-ta"
          rows={3}
          data-k="msg"
          placeholder={
            sel === "message"
              ? "Message an agent about this card: ask anything, or say what to research or change"
              : "Optional: extra instructions for " + cur.label
          }
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (st.canWrite && !full) send();
            }
          }}
        />
        <div className="sd-row sd-mt6">
          {sel !== "message" ? (
            <span className="ap-chip t-g sd-selchip">
              <b>{cur.label}</b>
              <button
                type="button"
                aria-label="Back to a plain message"
                onClick={() => setSel("message")}
              >
                ×
              </button>
            </span>
          ) : null}
          <label className="sd-f">
            Model
            <select
              className="sd-in"
              aria-label="Model"
              data-k="model"
              value={cap.model}
              onChange={(e) => setCap("model", e.target.value)}
            >
              {["haiku", "sonnet", "opus"].map((m) => (
                <option key={m} value={m}>
                  {m[0].toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="sd-f">
            Cap $
            <input
              className="sd-in sd-num"
              type="number"
              min="0.25"
              max="20"
              step="0.25"
              inputMode="decimal"
              data-k="usd"
              value={String(cap.maxUsd)}
              onChange={(e) => setCap("maxUsd", Number(e.target.value))}
            />
          </label>
          <label className="sd-f">
            min
            <input
              className="sd-in sd-num"
              type="number"
              min="2"
              max="120"
              step="1"
              inputMode="numeric"
              data-k="min"
              value={String(cap.maxMin)}
              onChange={(e) => setCap("maxMin", Number(e.target.value))}
            />
          </label>
          <span className="st-sp" />
          <WBtn
            can={st.canWrite}
            busy={A.busy.send}
            disabled={full}
            className="cp-btn sm sd-pri"
            k="send"
            onClick={send}
          >
            {sel === "message"
              ? follow
                ? "Send follow-up"
                : "Send message"
              : "Run " + cur.label}
          </WBtn>
        </div>
        {full ? (
          <div className="sd-hint sd-mt4">
            {v.maxRunning +
              " jobs are running on this card (the most at once); wait or stop one"}
          </div>
        ) : cur.k !== "message" ? (
          <div className="sd-hint sd-mt4">
            {cur.does + (cur.web ? " · uses web search" : "")}
          </div>
        ) : null}
        <ErrLine
          text={A.err.send}
          onClear={() => A.clear("send")}
          k="send-err"
        />
        <h3 className="sd-h3 sd-mt12">Or run an action</h3>
        {GROUPS.map(([g, gl]) => {
          const as = acts.filter(
            (a) => a.k !== "message" && (a.group || "product") === g,
          );
          if (!as.length) return null;
          return (
            <div key={g}>
              <div className="sd-grp" id={"sd-g-" + g}>
                {gl}
              </div>
              <div
                className="sd-acts"
                role="group"
                aria-labelledby={"sd-g-" + g}
              >
                {as.map((a) => {
                  const c = capsOf(a.k);
                  return (
                    <button
                      key={a.k}
                      type="button"
                      className="sd-act"
                      aria-pressed={sel === a.k}
                      data-k={"act-" + a.k}
                      onClick={() => setSel(sel === a.k ? "message" : a.k)}
                    >
                      <b>{a.label}</b>
                      <span>{a.does}</span>
                      <i>
                        {c.model +
                          " · $" +
                          c.maxUsd +
                          " · " +
                          c.maxMin +
                          " min" +
                          (a.web ? " · web" : "")}
                      </i>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!acts.length ? (
          <div className="sd-hint" role="status">
            {aq.error ? (
              "The actions could not be read: " +
              String((aq.error as Error).message || "").replace(
                /^Action [\w-]+ failed:\s*/,
                "",
              )
            ) : (
              <>
                <Spin /> Loading actions…
              </>
            )}
          </div>
        ) : null}
      </div>
      {replies.map((j: any) => (
        <div className="sd-job" key={"ap-" + j.id}>
          <ApplyPicker
            j={j}
            ctx={ctx}
            title={"Apply the reply of " + when(j.at)}
          />
        </div>
      ))}
      <div className="sd-box" data-k="results">
        <h3 className="sd-h3">Results</h3>
        {!all.length ? (
          <div className="sd-empty">
            No agent work yet. Pick an action above: research, a brief, a mockup
            ... each result lands here.
          </div>
        ) : null}
        {shown.map((j: any) => (
          <JobCard key={j.id} j={j} ctx={ctx} />
        ))}
        {gone.length ? (
          <>
            <button
              type="button"
              className="cp-btn sm ghost sd-mt6"
              aria-expanded={showGone}
              onClick={() => setShowGone(!showGone)}
            >
              {(showGone ? "Hide " : "Show ") + gone.length + " discarded"}
            </button>
            {showGone
              ? gone.map((j: any) => <JobCard key={j.id} j={j} ctx={ctx} />)
              : null}
          </>
        ) : null}
      </div>
    </>
  );
}

// ---------- MESSAGES
function ConvoPane({
  ctx,
  onNew,
  onApply,
}: {
  ctx: Ctx;
  onNew: () => void;
  onApply: (j: any) => void;
}) {
  const st = useStudio();
  const A = useActs(ctx.refetch);
  const rec = ctx.v.rec,
    msgs = rec.jobs.filter((j: any) => j.action === "message");
  return (
    <div className="sd-box" data-k="convo">
      <div className="sd-row sd-mb8">
        <h3 className="sd-h3 sd-m0">Conversation</h3>
        <span className="st-sp" />
        <button type="button" className="cp-btn sm" onClick={onNew}>
          New message
        </button>
      </div>
      <div
        className="sd-thread"
        role="log"
        aria-label="Conversation with agents about this card"
      >
        {!msgs.length ? (
          <div className="sd-empty">
            No messages yet. Write to an agent in the Agents tab ("Ask an
            agent"); its reply lands here.
          </div>
        ) : null}
        {msgs.map((j: any) => {
          const re = j.followOf
            ? rec.jobs.find((x: any) => x.id === j.followOf)
            : null;
          const live = ACTIVE(j);
          return (
            <div key={j.id}>
              <div className="sd-msg me">
                <div className="who">
                  {"You · " +
                    when(j.at) +
                    (j.ask ? " · " + j.label : "") +
                    (re ? " · re: " + re.label : "")}
                </div>
                {j.message}
              </div>
              <div className="sd-msg ag">
                <div className="who">
                  {live ? <Spin /> : null}
                  {"Agent (" +
                    String(j.model || "").replace(/^claude-/, "") +
                    ") · " +
                    (
                      {
                        queued: "Queued",
                        working: "Working",
                        done: "Done",
                        failed: "Failed",
                        stopped: "Stopped",
                      } as Record<string, string>
                    )[j.status]}
                  {live && j.startedAt
                    ? " " + durShort(Date.now() - Date.parse(j.startedAt))
                    : j.wallMs
                      ? " " + durShort(j.wallMs)
                      : ""}
                  {j.costUsd ? " " + usd(j.costUsd) : ""}
                </div>
                {j.status === "done" ? (
                  <>
                    <Md src={j.result} />
                    <div className="sd-row sd-mt6">
                      <button
                        type="button"
                        className="cp-btn sm"
                        onClick={() => onApply(j)}
                      >
                        Apply to brief
                      </button>
                      <button
                        type="button"
                        className="cp-btn sm"
                        onClick={() => ctx.followUp(j)}
                      >
                        Reply
                      </button>
                    </div>
                  </>
                ) : live ? (
                  <>
                    <div className="sd-hint">Thinking…</div>
                    <WBtn
                      can={st.canWrite}
                      busy={A.busy["stop-" + j.id]}
                      className="cp-btn sm danger"
                      onClick={() =>
                        A.run(
                          "stop-" + j.id,
                          () =>
                            studioWrite(
                              st.app,
                              "app",
                              "jobs/" + j.id + "/stop",
                              {},
                            ),
                          "m-" + j.id,
                        )
                      }
                    >
                      Stop
                    </WBtn>
                  </>
                ) : (
                  <div className="sd-err">{j.error || j.status}</div>
                )}
              </div>
              <ErrLine
                text={A.err["m-" + j.id]}
                onClear={() => A.clear("m-" + j.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- FILES: the asset library, decisions, links and images
const assetLabel = (a: any) =>
  a.kind === "palette"
    ? a.concept + " palette"
    : a.kind === "fonts"
      ? (a.fonts || []).map((f: any) => f.family).join(" + ")
      : a.kind === "icons"
        ? a.set + " icons"
        : a.title || a.file || "asset";
function FilesPane({ v, refetch }: { v: any; refetch: () => void }) {
  const st = useStudio();
  const A = useActs(refetch);
  const rec = v.rec;
  const as: any[] = rec.assets || [];
  const app = v.card.app,
    appName = v.card.appName || app;
  const [dt, setDt] = useState("");
  const [dw, setDw] = useState("");
  const [lu, setLu] = useState("");
  const [lt, setLt] = useState("");
  const fi = useRef<HTMLInputElement>(null);
  const [others, setOthers] = useState(false);
  const adopt = rec.jobs.filter(
    (j: any) =>
      j.decision &&
      j.status === "done" &&
      !rec.decisions.some((d: any) => d.from === j.id),
  );
  const links = rec.attachments.filter((a: any) => a.kind === "link"),
    imgs = rec.attachments.filter(
      (a: any) => a.kind === "image" || a.kind === "video",
    );
  return (
    <>
      <div className="sd-box" data-k="library">
        <div className="sd-row">
          <h3 className="sd-h3 sd-m0">{"Asset library (" + as.length + ")"}</h3>
          <span className="st-sp" />
          {as.length ? (
            <a
              className="cp-btn sm ghost"
              href={fileSrc(st.app, "assets/ASSETS.md")}
              target="_blank"
              rel="noopener noreferrer"
            >
              Credits (ASSETS.md)
            </a>
          ) : null}
          {app ? (
            <button
              type="button"
              className="cp-btn sm ghost"
              aria-expanded={others}
              onClick={() => setOthers(!others)}
            >
              {others ? "Hide other cards" : "All of " + appName}
            </button>
          ) : null}
        </div>
        <p className="sd-hint sd-m4-8">
          Only licence-cleared assets (CC0, Public Domain, Unsplash, Pexels,
          Pixabay, CC BY / BY-SA with attribution). Images arrive only through
          "Use this"; each has a licence record and a line in ASSETS.md for the
          app's credits page. Later cards of the same app see this library.
        </p>
        {as.length ? (
          <div className="sd-lib">
            {as
              .slice()
              .reverse()
              .map((a) => (
                <figure key={a.id}>
                  {a.kind === "image" && a.file ? (
                    <img
                      src={fileSrc(st.app, "assets/" + a.file)}
                      alt={a.title || "Asset"}
                      loading="lazy"
                    />
                  ) : null}
                  {a.kind === "palette" ? (
                    <div className="sd-sws">
                      {(a.palette || []).map((p: any, i: number) => (
                        <div className="sd-swc" key={i}>
                          <i style={{ background: p.hex }} aria-hidden="true" />
                          {p.hex}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <figcaption>
                    <b>{assetLabel(a)}</b>
                    <br />
                    {(a.kind === "clip" ? "Video (linked) · " : "") +
                      a.license +
                      (a.attribution ? " · " + a.attribution : "")}
                    {a.pageUrl ? (
                      <>
                        <br />
                        <a
                          href={a.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Source page
                        </a>
                      </>
                    ) : null}
                  </figcaption>
                  <WBtn
                    can={st.canWrite}
                    busy={A.busy["asset-" + a.id]}
                    className="cp-btn sm ghost"
                    label={"Remove " + assetLabel(a) + " from the library"}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Remove " +
                            assetLabel(a) +
                            " from the asset library (its file and licence record are deleted)?",
                        )
                      )
                        A.run(
                          "asset-" + a.id,
                          () =>
                            studioWrite(
                              st.app,
                              "app",
                              "asset/" + a.id + "/remove",
                              {},
                            ),
                          "lib",
                        );
                    }}
                  >
                    Remove
                  </WBtn>
                </figure>
              ))}
          </div>
        ) : (
          <div className="sd-empty">
            Nothing yet. Run Stock photos, Video plan or Ideation, then "Use
            this" or "Save palette".
          </div>
        )}
        {others ? (
          <>
            <h3 className="sd-h3 sd-mt10">
              {"From other cards of " + appName}
            </h3>
            <div className="sd-empty">
              The app's other cards' assets are not on the cockpit client yet.
            </div>
          </>
        ) : null}
        <ErrLine text={A.err.lib} onClear={() => A.clear("lib")} />
      </div>
      <div className="sd-box" data-k="decisions">
        <h3 className="sd-h3">Decisions</h3>
        {rec.decisions.length ? (
          <ul className="sd-dlist">
            {rec.decisions.map((d: any) => (
              <li key={d.id}>
                <div className="tx">
                  <strong>{d.text}</strong>
                  {d.why ? <div className="sd-hint">{d.why}</div> : null}
                  <div className="sd-hint">
                    {when(d.at) +
                      (d.from
                        ? " · adopted from a Recommendations result"
                        : "")}
                  </div>
                </div>
                <WBtn
                  can={st.canWrite}
                  busy={A.busy["dec-" + d.id]}
                  className="cp-btn sm ghost"
                  label={"Remove decision " + d.text}
                  onClick={() =>
                    A.run(
                      "dec-" + d.id,
                      () =>
                        studioWrite(
                          st.app,
                          "app",
                          "decision/" + d.id + "/remove",
                          {},
                        ),
                      "e1",
                    )
                  }
                >
                  Remove
                </WBtn>
              </li>
            ))}
          </ul>
        ) : (
          <div className="sd-empty">
            No decisions yet. Record what was chosen and why, or adopt one from
            a Recommendations result.
          </div>
        )}
        {adopt.length ? (
          <div className="sd-row sd-mt8">
            {adopt.map((j: any) => (
              <WBtn
                key={j.id}
                can={st.canWrite}
                busy={A.busy["adopt-" + j.id]}
                onClick={() =>
                  A.run(
                    "adopt-" + j.id,
                    () =>
                      studioWrite(st.app, "app", "decision", {
                        text: j.decision.text,
                        why: j.decision.why,
                        from: j.id,
                      }),
                    "e1",
                  )
                }
              >
                {"Adopt: " + String(j.decision.text).slice(0, 60)}
              </WBtn>
            ))}
          </div>
        ) : null}
        <form
          className="sd-row sd-mt8"
          onSubmit={(e) => {
            e.preventDefault();
            A.run(
              "dec",
              async () => {
                const j = await studioWrite(st.app, "app", "decision", {
                  text: dt,
                  why: dw,
                });
                setDt("");
                setDw("");
                return j;
              },
              "e1",
            );
          }}
        >
          <input
            className="sd-in sd-g1"
            type="text"
            placeholder="What was decided"
            aria-label="Decision"
            data-k="dec-t"
            value={dt}
            disabled={!st.canWrite}
            onChange={(e) => setDt(e.target.value)}
          />
          <input
            className="sd-in sd-g2"
            type="text"
            placeholder="Why (optional)"
            aria-label="Why"
            data-k="dec-w"
            value={dw}
            disabled={!st.canWrite}
            onChange={(e) => setDw(e.target.value)}
          />
          <WBtn
            can={st.canWrite}
            busy={A.busy.dec}
            type="submit"
            className="cp-btn sm sd-pri"
          >
            Add decision
          </WBtn>
        </form>
        <ErrLine text={A.err.e1} onClear={() => A.clear("e1")} />
      </div>
      <div className="sd-box" data-k="links">
        <h3 className="sd-h3">Links and images</h3>
        {links.length ? (
          <ul className="sd-dlist">
            {links.map((a: any) => (
              <li key={a.id}>
                <div className="tx">
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.title}
                  </a>
                  <div className="sd-hint">{a.url}</div>
                </div>
                <WBtn
                  can={st.canWrite}
                  busy={A.busy["rm-" + a.id]}
                  className="cp-btn sm ghost"
                  label={"Remove link " + a.title}
                  onClick={() =>
                    A.run(
                      "rm-" + a.id,
                      () =>
                        studioWrite(
                          st.app,
                          "app",
                          "attach/" + a.id + "/remove",
                          {},
                        ),
                      "e2",
                    )
                  }
                >
                  Remove
                </WBtn>
              </li>
            ))}
          </ul>
        ) : null}
        {imgs.length ? (
          <Gallery
            imgs={imgs}
            can={st.canWrite}
            busy={A.busy}
            onRemove={(a) =>
              A.run(
                "rm-" + a.id,
                () =>
                  studioWrite(st.app, "app", "attach/" + a.id + "/remove", {}),
                "e2",
              )
            }
          />
        ) : null}
        {!rec.attachments.length ? (
          <div className="sd-empty">
            No links or images yet: references, competitor pages, sketches,
            screenshots.
          </div>
        ) : null}
        <form
          className="sd-row sd-mt8"
          onSubmit={(e) => {
            e.preventDefault();
            A.run(
              "lnk",
              async () => {
                const j = await studioWrite(st.app, "app", "attach", {
                  kind: "link",
                  url: lu.trim(),
                  title: lt,
                });
                setLu("");
                setLt("");
                return j;
              },
              "e2",
            );
          }}
        >
          <input
            className="sd-in sd-g2"
            type="url"
            placeholder="https://…"
            aria-label="Link address"
            data-k="lnk-u"
            value={lu}
            disabled={!st.canWrite}
            onChange={(e) => setLu(e.target.value)}
          />
          <input
            className="sd-in sd-g1"
            type="text"
            placeholder="Title (optional)"
            aria-label="Link title"
            data-k="lnk-t"
            value={lt}
            disabled={!st.canWrite}
            onChange={(e) => setLt(e.target.value)}
          />
          <WBtn
            can={st.canWrite}
            busy={A.busy.lnk}
            type="submit"
            className="cp-btn sm sd-pri"
          >
            Add link
          </WBtn>
        </form>
        <ErrLine text={A.err.e2} onClear={() => A.clear("e2")} />
        <div className="sd-row sd-mt8">
          <input
            ref={fi}
            className="sd-file"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            aria-label="Add an image"
            data-k="img"
            disabled={!st.canWrite}
          />
          <WBtn
            can={st.canWrite}
            busy={A.busy.up}
            onClick={() =>
              A.run(
                "up",
                async () => {
                  const f =
                    fi.current && fi.current.files && fi.current.files[0];
                  if (!f) throw new Error("Choose an image first");
                  if (f.size > 5 << 20)
                    throw new Error("Image too large (5 MB at most)");
                  const data = await new Promise<string>((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(String(r.result));
                    r.onerror = () => rej(new Error("Could not read the file"));
                    r.readAsDataURL(f);
                  });
                  const j = await studioWrite(st.app, "app", "attach", {
                    kind: "image",
                    name: f.name,
                    data,
                  });
                  if (fi.current) fi.current.value = "";
                  return j;
                },
                "e3",
              )
            }
          >
            Upload image
          </WBtn>
        </div>
        <ErrLine text={A.err.e3} onClear={() => A.clear("e3")} k="up-err" />
      </div>
    </>
  );
}

// ---------- ACTIVITY
function ActivityPane({ v }: { v: any }) {
  const a = v.rec.activity.slice().reverse();
  return (
    <div className="sd-box" data-k="activity">
      <h3 className="sd-h3">{"Activity (" + a.length + ")"}</h3>
      {a.length ? (
        <ul className="sd-dlist sd-actlog">
          {a.slice(0, 200).map((x: any, i: number) => (
            <li key={i}>
              <time dateTime={x.at} title={x.at}>
                {when(x.at)}
              </time>
              <div className="tx">
                {x.what}
                <span className="sd-hint">{" · " + x.by}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sd-empty">Nothing yet.</div>
      )}
    </div>
  );
}
