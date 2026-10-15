/**
 * FA-19173: studio-lifecycle.js's OPTIMIZER dialog (openLens / lensLoad / lensDraw / propCard), natively. The caps before it starts
 * (Cap $, Minutes; adjustable), Run the baseline / Re-run (what moved?), the step while it runs, the baseline scorecard with its bars,
 * the targets (measurable now in staging / in production), the ranked proposals (a build proposal ticked and Accepted becomes a
 * requirement, or Declined; a decision - pricing, tiers - answered with an option or your own words), the proposed KPI model (to
 * review in KPIs), the history with its sparkline, and what qa measured now. Read: app lens/<id> (4 s while it runs, else 10 s);
 * writes: lens/<id>/run | accept | decline | decide.
 */
import { useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { ago, useStudio } from "../api";
import { StudioModal } from "../Modal";
import { errOf, fmt, useLifecycle, useNarrow, useRead, useWriter } from "./data";
import { Spin } from "./Menu";
import { Err } from "./Pilot";

/** studio-lifecycle.js spark(): a trend line, or nothing under two points. */
export function Spark({ xs }: { xs: unknown[] }) {
  const v = (xs || []).map(Number).filter(Number.isFinite);
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v), W = 100, H = 22;
  const pts = v.map((x, i) => ((i * W) / (v.length - 1)).toFixed(1) + "," + (hi === lo ? H / 2 : H - 2 - ((x - lo) / (hi - lo)) * (H - 4)).toFixed(1)).join(" ");
  return (
    <span className="sm-spark" aria-hidden="true">
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" width="100%" height="22">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" points={pts} />
      </svg>
    </span>
  );
}

export function LensLayer({ id }: { id: string }) {
  const st = useStudio();
  const lc = useLifecycle();
  const l = lc.data ? lc.data.lenses.find((x) => x.id === id) : null;
  const hot = l ? l.state === "measuring" || l.state === "running" : false;
  const q = useRead<any>(st.app, "app", "lens/" + id, { every: (d) => (d && d.state && (d.state.state === "measuring" || d.state.state === "running")) || hot ? 4000 : 10000 });
  const write = useWriter();
  const narrow = useNarrow();
  const [usd, setUsd] = useState<string | null>(null);
  const [min, setMin] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [runErr, setRunErr] = useState("");
  const [footErr, setFootErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState<Record<string, string>>({});
  const [decErr, setDecErr] = useState<Record<string, string>>({});
  const ro = !st.canWrite;
  const d = q.data;
  const title = (d ? d.lens.label : l ? l.label : "Optimizer") + " · " + st.name;
  const act = async (k: string, fn: () => Promise<void>, onErr: (m: string) => void) => {
    if (busy) return;
    setBusy(k);
    onErr("");
    try {
      await fn();
    } catch (e) {
      onErr(errOf(e));
    } finally {
      setBusy(null);
    }
  };
  if (!d)
    return (
      <StudioModal open onClose={st.close} size="lg" testid="lens-dialog" title={title}>
        {q.isError ? (
          <div className="sm-db">
            <p className="sm-err" role="alert">
              {"Could not read it: " + errOf(q.error)}
            </p>
            <button type="button" className="cp-btn sm" onClick={() => void q.refetch()}>
              Try again
            </button>
          </div>
        ) : (
          <p className="sm-row" role="status">
            <Spin /> {"Reading the " + (l ? l.label : "Optimizer") + "…"}
          </p>
        )}
      </StudioModal>
    );
  const L = d.lens,
    S = d.state;
  const running = S.state === "measuring" || S.state === "running";
  const run = d.runs.find((r: any) => r.status === "done" && r.ok);
  const bad = d.runs.find((r: any) => r.status === "done" && r.ok === false);
  const caps = (
    <div className="sm-caps" data-k="lens-caps">
      <label>
        Cap ${" "}
        <input type="number" min="0.25" max="20" step="0.25" inputMode="decimal" aria-label="Cap in dollars" data-k="lens-usd" value={usd ?? String(L.caps.maxUsd)} onChange={(e) => setUsd(e.target.value)} />
      </label>
      <label>
        Minutes{" "}
        <input type="number" min="2" max="120" step="1" inputMode="numeric" aria-label="Cap in minutes" data-k="lens-min" value={min ?? String(L.caps.maxMin)} onChange={(e) => setMin(e.target.value)} />
      </label>
      <button
        type="button"
        className="cp-btn sm sm-pri"
        data-k="lens-run"
        disabled={running || ro || busy === "run"}
        title={ro ? READ_ONLY : undefined}
        onClick={() =>
          act(
            "run",
            async () => {
              await write("app", "lens/" + id + "/run", { maxUsd: Number(usd ?? L.caps.maxUsd) || undefined, maxMin: Number(min ?? L.caps.maxMin) || undefined });
              st.say(L.label + " started: it measures the staging app first");
            },
            setRunErr,
          )
        }
      >
        {running || busy === "run" ? <Spin /> : null}
        {running ? S.step || "Running" : S.state === "never" ? "Run the baseline" : "Re-run (what moved?)"}
      </button>
      <Err m={runErr} clear={() => setRunErr("")} />
    </div>
  );
  const ms = d.measure || {};
  const waiting = run ? run.proposals.filter((p: any) => p.state === "waiting" && p.kind === "build") : [];
  const togg = (pid: string, on: boolean) =>
    setPick((s) => {
      const x = new Set(s);
      if (on) x.add(pid);
      else x.delete(pid);
      return x;
    });
  const decide = (p: any, option: string, k: string) =>
    act(
      k,
      async () => {
        await write("app", "lens/" + id + "/decide", { run: run.id, id: p.id, option });
        st.say("Decided: " + option);
      },
      (m) => setDecErr((x) => ({ ...x, [p.id]: m })),
    );
  return (
    <StudioModal open onClose={st.close} size="lg" testid="lens-dialog" title={title} extra={narrow ? undefined : caps}>
      <div className="sm-db" data-k="lens-body">
        {narrow ? caps : null}
        <p className="sm-hint">{L.does + ". Proposals never edit the app: accepted ones become requirements and build through the usual path; pricing and tiers are your decisions."}</p>
        {running ? (
          <div className="sm-row" role="status" data-k="lens-step">
            <Spin />
            <b>{S.step}</b>
            <span className="sm-hint">{"since " + ago(S.since) + " · 1 measure, 2 baseline, 3 targets, 4 proposals"}</span>
          </div>
        ) : null}
        {S.error ? (
          <p className="sm-err" role="alert">
            {"The last run failed: " + S.error}
          </p>
        ) : null}
        {!run ? (
          <p className="sm-hint" data-k="lens-empty">
            {running
              ? "The scorecard, targets and proposals appear here when the run ends."
              : bad
                ? "The last run's result had no scorecard (" + (bad.why || "") + "). Re-run it."
                : "Never run. Run the baseline: qa measures the staging app (accessibility, speed, states, key flows, screenshots at 1280 and 375), then the " +
                  L.label +
                  " scores each dimension from that evidence, sets targets with KPIs and ranks proposals."}
          </p>
        ) : (
          <>
            <section data-k="lens-scorecard">
              <h4 className="sm-h4">{"Baseline · " + run.baseline + "/100 · " + ago(run.endedAt)}</h4>
              <div className="sm-sc">
                {run.scorecard.map((s: any, i: number) => (
                  <div className="sm-scr" key={i}>
                    <span>{s.label}</span>
                    <b>{String(s.score)}</b>
                    <span className="e">
                      <span className={"sm-sbar " + (s.score >= 70 ? "" : s.score >= 45 ? "a" : "r")} role="img" aria-label={s.score + " of 100"}>
                        <i style={{ width: s.score + "%" }} />
                      </span>
                      <span className="sm-hint">{s.evidence}</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section data-k="lens-targets">
              <h4 className="sm-h4">Targets and KPIs</h4>
              {[
                ["now", "Measurable now in staging"],
                ["production", "Measurable in production"],
              ].map(([k, label]) => {
                const ts = run.targets.filter((t: any) => t.measurable === k);
                return (
                  <div key={k} className="sm-tg">
                    <b>{label}</b>
                    {ts.length ? (
                      <ul className="sm-ll">
                        {ts.map((t: any, i: number) => (
                          <li key={i}>
                            <span className="sm-ok n">{t.better === "down" ? "↓" : "↑"}</span>
                            <span>
                              <b>{t.kpi + ": "}</b>
                              {(t.now === null ? (t.measurable === "production" ? "no data until production + instrumentation" : "not measured") : fmt(t.now, t.unit)) + " → " + fmt(t.target, t.unit)}
                              {t.how ? <span className="sm-hint">{" · " + t.how}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="sm-hint">none</span>
                    )}
                  </div>
                );
              })}
            </section>
            <section data-k="lens-proposals">
              <h4 className="sm-h4">{"Proposals, ranked (" + run.proposals.length + ")"}</h4>
              {run.proposals.map((p: any) => {
                const wait = p.state === "waiting";
                const meta = (
                  <div className="sm-meta">
                    {p.kpi ? <span>{"moves " + p.kpi + (p.expect ? ": " + p.expect : "")}</span> : null}
                    <span>{"effort " + p.effort}</span>
                    <span>{"confidence " + p.confidence}</span>
                    {(p.depends || []).length ? <span>{"after " + p.depends.join(", ")}</span> : null}
                    {!wait ? <span className={"ap-chip " + (p.state === "accepted" || p.state === "decided" ? "t-g" : "t-d")}>{p.state + (p.chosen ? ": " + p.chosen : "")}</span> : null}
                  </div>
                );
                const why = (
                  <details>
                    <summary>Why</summary>
                    <p className="sm-hint">{p.why}</p>
                  </details>
                );
                if (p.kind === "decision")
                  return (
                    <div className="sm-prop decision" key={p.id} data-k={"lens-prop-" + p.id}>
                      <div className="t">
                        <span className="ap-chip sm-vio">Your decision</span>
                        <b>{p.rank + ". " + p.title}</b>
                      </div>
                      <span>{p.question}</span>
                      {p.change ? <span className="sm-hint">{p.change}</span> : null}
                      {meta}
                      {wait ? (
                        <div className="sm-row" role="group" aria-label="Your decision">
                          {(p.options || []).map((x: string, i: number) => (
                            <button key={i} type="button" className="cp-btn sm" data-k={"lens-opt-" + p.id + "-" + i} disabled={ro || Boolean(busy)} title={ro ? READ_ONLY : undefined} onClick={() => decide(p, x, "opt-" + p.id + "-" + i)}>
                              {busy === "opt-" + p.id + "-" + i ? <Spin /> : null}
                              {x}
                            </button>
                          ))}
                          <input
                            className="sm-in sm-own"
                            type="text"
                            maxLength={200}
                            placeholder="Or your own answer"
                            aria-label={"Your own answer to: " + p.question}
                            data-k={"lens-own-" + p.id}
                            disabled={ro}
                            value={own[p.id] || ""}
                            onChange={(e) => setOwn((x) => ({ ...x, [p.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              const v = (own[p.id] || "").trim();
                              if (e.key === "Enter" && v) {
                                e.preventDefault();
                                void decide(p, v, "own-" + p.id);
                              }
                            }}
                          />
                          <Err m={decErr[p.id] || ""} clear={() => setDecErr((x) => ({ ...x, [p.id]: "" }))} />
                        </div>
                      ) : null}
                      {why}
                    </div>
                  );
                return (
                  <div className="sm-prop" key={p.id} data-k={"lens-prop-" + p.id}>
                    <div className="t">
                      {wait ? <input type="checkbox" data-k={"lens-pick-" + p.id} checked={pick.has(p.id)} disabled={ro} aria-label={"Accept: " + p.title} onChange={(e) => togg(p.id, e.target.checked)} /> : null}
                      <b>{p.rank + ". " + p.title}</b>
                    </div>
                    <span>{p.change}</span>
                    {meta}
                    {why}
                  </div>
                );
              })}
              {waiting.length ? (
                <div className="sm-foot">
                  <button
                    type="button"
                    className="cp-btn sm sm-pri"
                    data-k="lens-accept"
                    disabled={!pick.size || ro || Boolean(busy)}
                    title={ro ? READ_ONLY : undefined}
                    onClick={() =>
                      act(
                        "accept",
                        async () => {
                          const j = await write<any>("app", "lens/" + id + "/accept", { run: run.id, ids: [...pick] });
                          setPick(new Set());
                          st.say(j.accepted.length + " accepted: they are requirements now" + (j.checklist && j.checklist.text ? " (" + j.checklist.text + ")" : ""));
                        },
                        setFootErr,
                      )
                    }
                  >
                    {busy === "accept" ? <Spin /> : null}
                    {"Accept " + (pick.size || "") + " → requirements"}
                  </button>
                  <button
                    type="button"
                    className="cp-btn sm"
                    data-k="lens-decline"
                    disabled={!pick.size || ro || Boolean(busy)}
                    title={ro ? READ_ONLY : undefined}
                    onClick={() =>
                      act(
                        "decline",
                        async () => {
                          const j = await write<any>("app", "lens/" + id + "/decline", { run: run.id, ids: [...pick] });
                          setPick(new Set());
                          st.say(j.declined.length + " declined");
                        },
                        setFootErr,
                      )
                    }
                  >
                    {busy === "decline" ? <Spin /> : null}Decline
                  </button>
                  <span className="sm-hint">Accepted proposals become requirements with their browser checks, and Build it builds them.</span>
                  <Err m={footErr} clear={() => setFootErr("")} />
                </div>
              ) : null}
            </section>
            {run.kpiModel ? (
              <section data-k="lens-kpimodel">
                <h4 className="sm-h4">Proposed KPI model</h4>
                <p className="sm-hint">{run.kpiModel.kpis.map((k: any) => k.name + (k.target !== null ? " → " + fmt(k.target, k.unit) : "")).join(" · ")}</p>
                <div className="sm-row">
                  <button type="button" className="cp-btn sm" data-k="lens-kpis" onClick={() => st.open({ kind: "kpis" })}>
                    Review and confirm in KPIs
                  </button>
                </div>
              </section>
            ) : null}
          </>
        )}
        {d.history.length ? (
          <section data-k="lens-history">
            <h4 className="sm-h4">{"History (" + d.history.length + " run" + (d.history.length === 1 ? "" : "s") + ")"}</h4>
            <Spark xs={d.history.map((x: any) => x.baseline)} />
            <ul className="sm-ll">
              {d.history
                .slice()
                .reverse()
                .slice(0, 8)
                .map((x: any, i: number) => (
                  <li key={i}>
                    <span className="sm-ok n">·</span>
                    <span>{String(x.at || "").slice(0, 16).replace("T", " ") + " baseline " + x.baseline + " · " + Object.entries(x.dims || {}).map(([k, v]) => k + " " + v).join(", ")}</span>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
        <section data-k="lens-measure">
          <h4 className="sm-h4">Measured now (qa)</h4>
          <p className="sm-hint">
            {ms.ok
              ? ms.text +
                " · accessibility violations " +
                (ms.latest.a11y ?? "n/a") +
                " · phone LCP " +
                (ms.latest.phoneLcpMs ?? "n/a") +
                " ms · states " +
                (ms.latest.states ?? "n/a") +
                " · flows " +
                (ms.latest.flows ?? "n/a") +
                " · " +
                (ms.history || []).length +
                " measurement" +
                ((ms.history || []).length === 1 ? "" : "s")
              : ms.text}
          </p>
        </section>
      </div>
    </StudioModal>
  );
}
