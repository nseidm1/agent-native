/**
 * FA-19173: studio-env.js, natively - STAGING AND PRODUCTION. THE ROW (the Launch and Deploy tiles' details hold it): Staging <sha> ·
 * updated <ago>, Production (a link, only when a build is there), View staging app (through the cockpit's staging proxy, its address the
 * frame info's data), Make Production Ready (on when staging differs from production and no run is active; its CONFIRM shows the plan's
 * quote, ETA and cards, then Start posts env ready {}), Promote to production (off until the run is READY, its title says why; on, its
 * CONFIRM shows what production would get - the release plan - before env promote {} is ever sent; while a promotion runs it shows the
 * promotion's progress). While a run exists, its STATUS PANEL: the released bar, cards remaining, ETA and clock, pace, in flight,
 * blocked, spent so far, the release checklist, Cancel run (a second press confirms). The Launch menu opens the same confirms, and
 * Rollback's (env rollback: it asks for the phone's fingerprint). Nothing here is sent without its confirm.
 */
import { useEffect, useRef } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { useStudio } from "../api";
import { StudioModal } from "../Modal";
import { envUi, errOf, runActive, useEnv, useFrameInfo, useReadiness, useRead, useStore, useWriter } from "./data";
import { NA, clock, envAgo, envModel, etaText, n, okUrl, quoteLine, short, usd2 } from "./envModel";
import { Spin } from "./Menu";

/** The env row's state and its rules, for the row and the Launch menu (one poll). */
export function useEnvModel() {
  const st = useStudio();
  const q = useEnv();
  const ui = useStore(envUi);
  const m = String((q.error as any)?.message || "");
  const absent = q.isError && /404|no such app/i.test(m);
  const err = q.isError && !absent ? errOf(q.error) : null;
  const env = absent ? undefined : q.data;
  const r = useReadiness(env, err);
  const model = envModel(env, { absent, err, ...r, starting: ui.starting, promoting: ui.promoting, appName: st.name });
  return { env, absent, err, ...r, model, ui, loaded: q.isFetched || q.isError };
}

const STAGES = ["filed", "drafted", "landed", "released"];

export function EnvRow() {
  const st = useStudio();
  const E = useEnvModel();
  const info = useFrameInfo();
  const write = useWriter();
  const { env, model, ui, rd } = E;
  const sg = (env && env.staging) || null,
    pr = (env && env.production) || null,
    pm = (env && env.promotion) || null;
  const ro = !st.canWrite;
  // updated: the last staging change (the studio's own list), else the build time
  const last = (st.s.changes || []).find((c) => c.at);
  const at = last ? last.at : sg && sg.built ? sg.built : null;
  // the cockpit's same-origin staging proxy (frame info's staging.base, data): it works wherever the cockpit does
  const viaCockpit = info && info.staging && info.staging.base ? String(info.staging.base) : null;
  const panel = useRef<HTMLElement>(null);
  const live = Boolean(pm && ["running", "publishing", "published", "failed", "stopped"].includes(pm.state));
  const running = Boolean(pm && ["running", "publishing"].includes(pm.state));
  const showProm = live && (ui.open || running);
  useEffect(() => {
    if (ui.open) panel.current?.focus({ preventScroll: false });
  }, [ui.open]);
  const cancelT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(cancelT.current), []);
  const cancelRun = async () => {
    if (!envUi.get().cancelArm) {
      envUi.set((x) => ({ ...x, cancelArm: true }));
      clearTimeout(cancelT.current);
      cancelT.current = setTimeout(() => envUi.set((x) => ({ ...x, cancelArm: false })), 8000);
      return;
    }
    clearTimeout(cancelT.current);
    envUi.set((x) => ({ ...x, cancelArm: false, cancelling: true }));
    try {
      const j = await write<any>("env", "ready/cancel", {});
      st.say("The production-ready run of " + st.name + " is cancelled" + (j && j.off ? ": " + n(j.off.length, "open card") + " left the work list" : ""));
    } catch (e) {
      st.say("Could not cancel the run: " + errOf(e), false);
    } finally {
      envUi.set((x) => ({ ...x, cancelling: false }));
    }
  };
  const showStatus = rd && ["planning", "cards", "failed"].includes(rd.state);
  return (
    <div className="sm-env" data-k="env-row">
      <div className="sm-erow" role="region" aria-label={st.name + " environments"}>
        <span className="sm-envl" data-k="env-staging">
          <span className="sm-lbl">Staging</span>
          {sg && sg.sha ? <span className="sm-sha">{short(sg.sha)}</span> : null}
          {at ? (
            <span className="sm-note" title={last ? "The last staging change" : "Built"}>
              {"· updated " + envAgo(at)}
            </span>
          ) : null}
        </span>
        {pr && pr.sha && okUrl(pr.url) ? (
          <a className="sm-prod" href={pr.url!} target="_blank" rel="noopener noreferrer" data-k="env-prod-url" title={"Production: " + pr.url}>
            {"Production" + (pr.sha ? " " + short(pr.sha) : "") + (pr.at ? " · " + envAgo(pr.at) : "") + " ↗"}
          </a>
        ) : null}
        <span className="st-sp" />
        {model.view.on && viaCockpit ? (
          <a className="cp-btn sm sm-pri" data-k="env-view-staging" href={viaCockpit} target="_blank" rel="noopener noreferrer" title={model.view.title}>
            View staging app ↗
          </a>
        ) : (
          <button type="button" className="cp-btn sm sm-pri" data-k="env-view-staging" disabled title={model.why || "Reading the staging address…"} aria-describedby={model.why ? "sm-env-why" : undefined}>
            {sg && sg.building ? <Spin /> : null}View staging app
          </button>
        )}
        <button
          type="button"
          className="cp-btn sm sm-pri"
          data-k="env-ready"
          aria-haspopup="dialog"
          aria-expanded={ui.confirm === "ready"}
          disabled={model.ready.off || ro}
          title={ro ? READ_ONLY : model.ready.title}
          onClick={() => openConfirm(st, "ready")}
        >
          {ui.starting ? <Spin /> : null}
          {model.ready.label}
        </button>
        <button
          type="button"
          className="cp-btn sm"
          data-k="env-promote"
          aria-haspopup={model.live ? undefined : "dialog"}
          aria-expanded={model.live ? ui.open : ui.confirm === "promote"}
          aria-controls={model.live ? "sm-env-panel" : undefined}
          disabled={model.promote.off || (ro && !model.live)}
          title={ro && !model.live ? READ_ONLY : model.promote.title}
          onClick={() => (model.live ? envUi.set((x) => ({ ...x, open: !x.open, confirm: null })) : openConfirm(st, "promote"))}
        >
          {ui.promoting ? <Spin /> : null}
          {model.promote.label}
        </button>
      </div>
      {model.why ? (
        <p className="sm-note" id="sm-env-why">
          {model.why}
        </p>
      ) : E.rdAbsent ? (
        <p className="sm-note" data-k="env-ready-na">
          {NA}
        </p>
      ) : null}
      {showProm ? (
        <section className="sm-panel" id="sm-env-panel" tabIndex={-1} ref={panel} aria-labelledby="sm-ph" data-k="env-promotion">
          <h3 id="sm-ph">{"Promotion to production" + (pm.state === "published" ? ": published" : pm.state === "failed" ? ": stopped on an error" : "")}</h3>
          <Progress pm={pm} />
          <div className="sm-actions">
            <button type="button" className="cp-btn sm" onClick={() => envUi.set((x) => ({ ...x, open: false }))}>
              Close
            </button>
          </div>
        </section>
      ) : null}
      {showStatus ? (
        <section className="sm-panel" data-k="env-ready-status" aria-labelledby="sm-rh">
          <h3 id="sm-rh">{rd.state === "failed" ? "Make Production Ready stopped" : rd.state === "planning" ? "Making " + st.name + " production ready: planning" : "Making " + st.name + " production ready"}</h3>
          <div
            className="sm-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={rd.total || 0}
            aria-valuenow={rd.released || 0}
            aria-valuetext={(rd.released || 0) + " of " + (rd.total || 0) + " cards released"}
            aria-label="Cards released"
          >
            <i style={{ width: (rd.total ? Math.round(((rd.released || 0) / rd.total) * 100) : 0) + "%" }} />
          </div>
          <div className="sm-kv" role="status">
            <span>
              <b>{n(rd.remaining || 0, "card") + " remain"}</b>
              <span className="sm-note">{" · " + (rd.released || 0) + " of " + (rd.total || 0) + " released" + (rd.landed > (rd.released || 0) ? ", " + (rd.landed - (rd.released || 0)) + " landed" : "")}</span>
            </span>
            <span data-k="env-ready-eta">
              {rd.eta && rd.eta.minLow != null ? (
                <>
                  <b>{"ETA " + etaText(rd.eta)}</b>
                  <span className="sm-note">{" · ready around " + clock(rd.eta.at)}</span>
                </>
              ) : (
                <span className="sm-note">{"ETA pending" + (rd.eta && rd.eta.why ? ": " + rd.eta.why : "")}</span>
              )}
            </span>
            {rd.pace && rd.pace.medianCardMin != null ? (
              <span className="sm-note" data-k="env-ready-pace">
                {"Pace: " + rd.pace.medianCardMin + " min a card, " + rd.pace.slots + " at once" + (rd.pace.cardsPer10 != null ? " (" + rd.pace.cardsPer10 + " per 10 min)" : "")}
              </span>
            ) : null}
            <span className="sm-note" data-k="env-ready-spent">
              {"Spent so far: " + usd2(rd.spentUsd || 0) + (rd.quote && rd.quote.usd != null ? " of ~$" + rd.quote.usd + " quoted" : "")}
            </span>
          </div>
          {rd.stagingMovedBy ? <p className="sm-note">{n(rd.stagingMovedBy, "staging change") + " since this run started"}</p> : null}
          {(rd.inFlight || []).length ? (
            <div>
              <b>In flight</b>
              <ul className="sm-elist">
                {rd.inFlight.map((c: any, i: number) => (
                  <li key={i}>
                    <span className="sm-sha">{c.fa}</span>
                    <span className="sm-pip on">{c.stage || "filed"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(rd.blocked || []).length ? (
            <div>
              <b>Blocked</b>
              <ul className="sm-elist">
                {rd.blocked.map((c: any, i: number) => (
                  <li key={i}>
                    <span className="sm-sha">{c.fa}</span>
                    <span className="sm-pip r">{c.why || "blocked"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(rd.checklist || []).length ? (
            <div data-k="env-ready-checklist">
              <b>Release checklist</b>
              <ul className="sm-elist">
                {rd.checklist.map((c: any) => (
                  <li key={c.id} data-k={"env-ready-checklist-" + c.id} data-ok={String(Boolean(c.ok))}>
                    <span className={"sm-pip" + (c.ok ? " on" : " r")}>{(c.ok ? "✓ " : "○ ") + (c.label || c.id)}</span>
                    <span className="sm-note">{" " + (c.why || "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {rd.state === "failed" && rd.why ? (
            <p className="sm-note" role="alert">
              {rd.why}
            </p>
          ) : null}
          {runActive(rd) ? (
            <div className="sm-actions">
              <button type="button" className={"cp-btn sm" + (ui.cancelArm ? " danger" : "")} data-k="env-ready-cancel" disabled={ui.cancelling || ro} title={ro ? READ_ONLY : undefined} onClick={cancelRun}>
                {ui.cancelling ? <Spin /> : null}
                {ui.cancelArm ? "Confirm: cancel the run (" + n(rd.remaining, "open card") + " leave the lane)" : "Cancel run"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Progress({ pm }: { pm: any }) {
  const cards = pm.cards || [],
    pub = pm.publish || {};
  const step = (c: any) => (c.stage === "failed" ? -1 : STAGES.indexOf(c.stage) + 1);
  const total = cards.length * STAGES.length + 1,
    done = cards.reduce((k: number, c: any) => k + Math.max(0, step(c)), 0) + (pub.state === "done" ? 1 : 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="sm-prog-g">
      <div className="sm-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Promotion progress">
        <i style={{ width: pct + "%" }} />
      </div>
      {cards.length ? <div className="sm-note">{done + " of " + total + " steps"}</div> : null}
      {cards.map((c: any, ci: number) => (
        <div className="sm-crow" key={ci}>
          <span>
            <b>{c.title}</b>
            {c.fa ? <span className="sm-note">{" " + c.fa}</span> : null}
            {c.why ? <span className="sm-note">{" · " + c.why}</span> : null}
          </span>
          <span className="sm-pips" aria-label={c.title + ": " + (c.stage || "planned")}>
            {STAGES.map((k, i) => (
              <span key={k} className={"sm-pip " + (c.stage === "failed" && i === 0 ? "r" : i < step(c) ? "ok" : i === step(c) && pm.state === "running" ? "on" : "")} aria-hidden="true">
                {k}
              </span>
            ))}
          </span>
        </div>
      ))}
      <div className="sm-crow">
        <b>{"Publish to the mirror" + (pub.sha ? " at " + short(pub.sha) : "")}</b>
        <span className={"sm-pip " + (pub.state === "done" ? "ok" : pub.state === "failed" ? "r" : ["running", "needs-fingerprint"].includes(pub.state) ? "on" : "")}>
          {pub.state === "done" ? "published" : pub.state === "needs-fingerprint" ? "waiting for your fingerprint" : pub.state || "after the release candidate"}
        </span>
      </div>
      {pm.why ? (
        <p className="sm-note" role="status">
          {pm.why}
        </p>
      ) : null}
    </div>
  );
}

/** Open one of the env confirms (one studio layer at a time: whatever else is open closes). */
export function openConfirm(st: { layer: unknown; close: () => void }, k: "ready" | "promote" | "rollback") {
  if (st.layer) st.close();
  envUi.set((x) => ({ ...x, confirm: k, open: false }));
}
const closeConfirm = () => envUi.set((x) => ({ ...x, confirm: null }));

/** The env confirms, over the studio (MenuLayers renders this): Make Production Ready, Promote to production, Rollback. */
export function EnvConfirms() {
  const st = useStudio();
  const ui = useStore(envUi);
  // a studio layer opened over it closes it (one at a time)
  useEffect(() => {
    if (st.layer && envUi.get().confirm) closeConfirm();
  }, [st.layer]);
  // a confirm never outlives its studio
  useEffect(() => () => closeConfirm(), [st.app]);
  if (ui.confirm === "ready") return <ReadyConfirm />;
  if (ui.confirm === "promote") return <PromoteConfirm />;
  if (ui.confirm === "rollback") return <RollbackConfirm />;
  return null;
}

function ReadyConfirm() {
  const st = useStudio();
  const E = useEnvModel();
  const write = useWriter();
  const p = E.rp,
    cards = (p && p.cards) || [];
  const ro = !st.canWrite;
  const start = async () => {
    if (envUi.get().starting) return;
    envUi.set((x) => ({ ...x, starting: true }));
    try {
      const j = await write<any>("env", "ready", {});
      envUi.set((x) => ({ ...x, confirm: null }));
      st.say("Make Production Ready started: " + n((j && j.ready && j.ready.total) || 0, "card") + " through the production lane");
    } catch (e) {
      st.say("Could not make " + st.name + " production ready: " + errOf(e), false);
    } finally {
      envUi.set((x) => ({ ...x, starting: false }));
    }
  };
  const can = Boolean(p && !runActive(E.rd) && !E.model.ready.off);
  return (
    <StudioModal
      open
      onClose={closeConfirm}
      size="md"
      testid="env-ready-confirm"
      title={"Make " + st.name + " production ready"}
      footer={
        <div className="sm-actions">
          <button type="button" className="cp-btn sm-pri" data-k="env-ready-start" disabled={!can || E.ui.starting || ro} title={ro ? READ_ONLY : can ? undefined : E.model.ready.title} onClick={start}>
            {E.ui.starting ? <Spin /> : null}
            {"Start (" + n(cards.length, "card") + ")"}
          </button>
          <button type="button" className="cp-btn ghost" data-k="env-ready-notnow" onClick={closeConfirm}>
            Not now
          </button>
        </div>
      }
    >
      {!p ? (
        <p className="sm-row" role="status">
          <Spin /> Comparing staging with production…
        </p>
      ) : (
        <div className="sm-db" data-k="env-ready-panel">
          <p data-k="env-ready-quote">
            <b>{quoteLine(p)}</b>
          </p>
          {p.eta && p.eta.at ? (
            <p className="sm-note">{"Ready around " + clock(p.eta.at) + " at today’s pace" + (p.eta.basis ? " (" + p.eta.basis + ")" : "")}</p>
          ) : p.eta && p.eta.why ? (
            <p className="sm-note">{p.eta.why}</p>
          ) : null}
          {p.quote && p.quote.text ? <p className="sm-note">{"Estimate: " + p.quote.text}</p> : null}
          {!can && E.model.ready.title ? (
            <p className="sm-note" role="status">
              {E.model.ready.title}
            </p>
          ) : null}
          {cards.length ? (
            <ol className="sm-cards" data-k="env-ready-cards">
              {cards.map((c: any, i: number) => (
                <li key={i}>
                  <b>{c.title || ""}</b>
                  {c.large ? <span className="sm-pip">large</span> : null}
                  {c.lines ? <span className="sm-note">{" · " + c.lines + " lines"}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {p.unsaved ? <p className="sm-note">{n(p.unsaved, "unsaved staging edit") + (p.unsaved === 1 ? " is" : " are") + " saved first."}</p> : null}
          <p className="sm-note">
            Each card runs the full production lane (drafter and two auditors, full suites, never a direct edit). Promote to production turns on when every card is released and master holds the staged bytes.
          </p>
        </div>
      )}
    </StudioModal>
  );
}

function PromoteConfirm() {
  const st = useStudio();
  const E = useEnvModel();
  const write = useWriter();
  const ro = !st.canWrite;
  // what production would get: the release plan (env promote, a read) and the launch scorecard (Promote says what is missing)
  const plan = useRead<any>(st.app, "env", "promote", { stale: 30_000 });
  const sc = useRead<any>(st.app, "app", "launch", { stale: 30_000 });
  const pl = plan.data && plan.data.plan;
  const go = async () => {
    if (envUi.get().promoting) return;
    envUi.set((x) => ({ ...x, promoting: true }));
    try {
      await write<any>("env", "promote", {});
      envUi.set((x) => ({ ...x, confirm: null, open: true }));
      st.say("Promotion started: the release candidate, its checks, then your fingerprint");
    } catch (e) {
      st.say("Could not promote " + st.name + ": " + errOf(e), false);
    } finally {
      envUi.set((x) => ({ ...x, promoting: false }));
    }
  };
  const off = E.model.promote.off || E.model.live;
  return (
    <StudioModal
      open
      onClose={closeConfirm}
      size="md"
      testid="env-promote-confirm"
      title={"Promote " + st.name + " to production"}
      footer={
        <div className="sm-actions">
          <button type="button" className="cp-btn sm-pri" data-k="env-promote-go" disabled={off || E.ui.promoting || ro} title={ro ? READ_ONLY : off ? E.model.promote.title : undefined} onClick={go}>
            {E.ui.promoting ? <Spin /> : null}Promote to production
          </button>
          <button type="button" className="cp-btn ghost" data-k="env-promote-notnow" onClick={closeConfirm}>
            Not now
          </button>
        </div>
      }
    >
      <div className="sm-db" data-k="env-promote-panel">
        <p>
          <b>{E.model.promote.title}</b>
        </p>
        <p className="sm-note" data-k="env-promote-launch">
          {sc.data ? (
            <>
              <b>{"Launch readiness " + sc.data.pct + "%"}</b>
              {sc.data.red && sc.data.red.length
                ? " · missing: " + sc.data.red.slice(0, 4).map((r: any) => r.label).join(", ") + (sc.data.red.length > 4 ? " (+" + (sc.data.red.length - 4) + " more)" : "")
                : " · every item green"}
            </>
          ) : sc.isError ? (
            "The launch scorecard could not be read: " + errOf(sc.error)
          ) : (
            "Reading the launch scorecard…"
          )}
        </p>
        {pl ? (
          <section data-k="env-promote-plan">
            <h4 className="sm-h4">What production gets</h4>
            {pl.summary && pl.summary.text ? <p>{pl.summary.text}</p> : null}
            {pl.quote && pl.quote.text ? <p className="sm-note">{"Estimate: " + pl.quote.text}</p> : null}
            {(pl.cards || []).length ? (
              <ol className="sm-cards">
                {pl.cards.slice(0, 40).map((c: any, i: number) => (
                  <li key={i}>
                    <b>{c.title || c.subject || ""}</b>
                    {c.commit ? <span className="sm-note">{" · " + c.commit}</span> : null}
                    {(c.files || []).length ? <span className="sm-note">{" · " + n(c.files.length, "file")}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            {pl.gate ? <p className="sm-note">{pl.gate}</p> : null}
            {pl.note ? <p className="sm-note">{pl.note}</p> : null}
          </section>
        ) : plan.isError ? (
          <p className="sm-note">{"The release plan could not be read: " + errOf(plan.error)}</p>
        ) : (
          <p className="sm-row" role="status">
            <Spin /> Reading the release plan…
          </p>
        )}
        <p className="sm-note">Promote builds the release candidate from master, checks it, then the publish waits for your fingerprint on that exact sha; pressing Promote again attaches to this deploy, never starts another.</p>
      </div>
    </StudioModal>
  );
}

function RollbackConfirm() {
  const st = useStudio();
  const E = useEnvModel();
  const write = useWriter();
  const ro = !st.canWrite;
  const pr = (E.env && E.env.production) || null;
  const go = async () => {
    if (envUi.get().rolling) return;
    envUi.set((x) => ({ ...x, rolling: true }));
    try {
      await write("env", "rollback", {});
      envUi.set((x) => ({ ...x, confirm: null }));
      st.say("Rollback requested: confirm it on your phone");
    } catch (e) {
      st.say("Rollback: " + errOf(e), false);
    } finally {
      envUi.set((x) => ({ ...x, rolling: false }));
    }
  };
  const can = Boolean(pr && pr.canRollback);
  return (
    <StudioModal
      open
      onClose={closeConfirm}
      size="md"
      testid="env-rollback-confirm"
      title={"Roll back " + st.name}
      footer={
        <div className="sm-actions">
          <button type="button" className="cp-btn danger" data-k="env-rollback-go" disabled={!can || E.ui.rolling || ro} title={ro ? READ_ONLY : can ? undefined : "No earlier production build to roll back to"} onClick={go}>
            {E.ui.rolling ? <Spin /> : null}Roll back
          </button>
          <button type="button" className="cp-btn ghost" data-k="env-rollback-notnow" onClick={closeConfirm}>
            Not now
          </button>
        </div>
      }
    >
      <p data-k="env-rollback-q">
        {"Put the previous production build of " + st.name + " back" + (pr && pr.rollbackTo ? " (" + String(pr.rollbackTo).slice(0, 7) + ")" : "") + "? It asks for your phone's fingerprint first."}
      </p>
    </StudioModal>
  );
}
