/**
 * FA-19173: studio-pilot.js, natively - THE DEFINITION OF DONE AND THE AUTOPILOT. ONE ROW (the Build tile's detail holds it): "N of M
 * requirements verified" (a meter; opens the checklist), Build it / the autopilot's state and its Pause / Resume / Stop, Checkpoints (N)
 * (opens the checkpoints); a decision the autopilot waits on, its options as one-tap answers. THE CHECKLIST (a dialog): the requirements
 * grouped Failing / Could not be checked / Waiting / No check yet / Verified / Context, each with how it is checked and its verdict (Show
 * me), "Write the checks", "Verify staging now", "Not testable" with a reason. CHECKPOINTS (a dialog): Save a checkpoint, Try an
 * experiment (Keep it / Discard, a second press confirms), the list newest first with Roll back (a second press confirms). A status is
 * never set here: only a browser check passes an item. Reads: qa checklist, env autopilot / checkpoints; writes: env autopilot,
 * checkpoints, experiments, qa checklist/author, checklist/<rq id>, verify, app questions/<id>/answer.
 */
import { useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { studioFileSrc, useStudio } from "../api";
import { StudioModal } from "../Modal";
import { agoShort, errOf, pilotBusy, usePilotData, useStore, useWriter } from "./data";
import { Spin } from "./Menu";

// ---------- the pure halves (studio-pilot.js)
const n0 = (v: unknown) => Number(v) || 0;
export function checklistChip(p: any) {
  if (!p || !n0(p.total)) return null;
  const total = n0(p.total), ver = n0(p.verified), fail = n0(p.failing), blk = n0(p.blocked), pend = n0(p.pending), unw = n0(p.unwritten), ctx = n0(p.context);
  const of = Math.max(1, total - ctx), detail = [p.detail, p.note].filter(Boolean).join(" · ");
  return {
    text: p.text || ver + " of " + total + " requirements verified",
    pct: Math.round((100 * ver) / of),
    tone: fail ? "r" : ver >= of ? "g" : ver ? "a" : "",
    detail,
    title:
      detail ||
      [ver + " verified", fail ? fail + " failing" : null, blk ? blk + " could not be checked" : null, pend ? pend + " waiting for a browser check" : null, unw ? unw + " with no check written yet" : null, ctx ? ctx + " context (not testable)" : null]
        .filter(Boolean)
        .join(" · "),
  };
}
const GROUPS: [string, string][] = [
  ["fail", "Failing"],
  ["blocked", "Could not be checked"],
  ["pending", "Waiting for a browser check"],
  ["unwritten", "No check written yet"],
  ["pass", "Verified"],
  ["context", "Context (not testable)"],
];
const groupOf = (i: any) => (i.status === "fail" && i.verified && ["step", "run"].includes(i.verified.failedAt) ? "blocked" : i.status || "unwritten");
export function checklistGroups(items: any[]) {
  const live = (items || []).filter((i) => i && i.status !== "retired");
  return GROUPS.map(([k, label]) => ({ k, label, items: live.filter((i) => groupOf(i) === k) })).filter((g) => g.items.length);
}
export function howOf(sc: any) {
  if (!sc) return null;
  const st = (sc.steps || [])
    .map((s: any) => (s.click ? "click " + s.click : s.fill ? "fill " + s.fill[0] : s.select ? "pick in " + s.select[0] : s.goto ? "go to " + s.goto : s.waitFor ? 'wait for "' + s.waitFor + '"' : null))
    .filter(Boolean);
  const ex = (sc.expect || [])
    .map((e: any) => (e.text ? 'see "' + e.text + '"' : e.notText ? 'no "' + e.notText + '"' : e.visible ? e.visible + " visible" : e.hidden ? e.hidden + " hidden" : null))
    .filter(Boolean);
  return (sc.page ? "On " + sc.page + ": " : "") + (st.length ? st.join(", ") + "; " : "") + (ex.length ? "expect " + ex.join(", ") : "no expectation written");
}
type ApBtn = { action: string; label: string; pri: boolean };
export function autopilotView(ap: any): { state: string; text: string; tone: string; busy: boolean; buttons: ApBtn[]; decisions?: any[] } {
  if (!ap) return { state: "none", text: "Build it is not available yet", tone: "", buttons: [], busy: false };
  const st = ap.state || "off", dec = (ap.decisionsOpen || []).filter((d: any) => !d.answered);
  const B = (action: string, label: string, pri?: boolean) => ({ action, label, pri: Boolean(pri) });
  if (st === "running") return { state: st, text: ap.text || "Building", tone: "a", busy: true, decisions: dec, buttons: [B("pause", "Pause"), B("stop", "Stop")] };
  if (st === "paused") return { state: st, text: ap.text || "Paused", tone: "", busy: false, decisions: dec, buttons: [B("resume", "Resume", true), B("stop", "Stop")] };
  if (st === "waiting") return { state: st, text: ap.text || "Needs your decision", tone: "a", busy: false, decisions: dec, buttons: [B("resume", "Resume", !dec.length), B("stop", "Stop")] };
  if (st === "green") return { state: st, text: ap.text || "Green", tone: "g", busy: false, decisions: dec, buttons: [B("start", "Build it again")] };
  return { state: st, text: st === "stopped" ? "Autopilot stopped" : "Build every requirement, one at a time, verified", tone: "", busy: false, decisions: dec, buttons: [B("start", "Build it", true)] };
}
const KIND: Record<string, string> = { green: "green step", manual: "saved", experiment: "experiment start", "before-rollback": "before a rollback", kept: "kept experiment" };
export function checkpointRows(list: any) {
  const cps = ((list && list.checkpoints) || []).slice().sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
  return cps.map((c: any) => ({
    id: c.id,
    name: c.name || c.id,
    kind: KIND[c.kind] || c.kind || "saved",
    at: c.at,
    sha: String(c.sha || "").slice(0, 7),
    progress: c.checklist && c.checklist.progress ? (typeof c.checklist.progress === "string" ? c.checklist.progress : c.checklist.progress.text) : null,
  }));
}
export const openExperiment = (list: any) => ((list && list.experiments) || []).find((x: any) => x.state === "open") || null;
const START_TITLE = "Answer what it can by default, then build each requirement one at a time, verify it in a browser, fix once, checkpoint, next - until every requirement is green or it needs you";

/** The autopilot's own buttons (the Build menu lists exactly these), and its press: env autopilot {action}. */
export function usePilot() {
  const st = useStudio();
  const d = usePilotData();
  const write = useWriter();
  const busy = useStore(pilotBusy);
  const v = autopilotView(d.ap === undefined ? { state: "off" } : d.ap);
  const asking = Boolean(v.state === "waiting" && v.decisions && v.decisions.length);
  const buttons = asking ? [] : v.buttons.map((b) => ({ ...b, k: "pilot-" + b.action, title: b.action === "start" ? START_TITLE : null }));
  const press = async (action: string, onErr?: (m: string) => void) => {
    if (pilotBusy.get()) return;
    pilotBusy.set(action);
    try {
      await write("env", "autopilot", { action });
      st.say(action === "start" ? "Autopilot started" : "Autopilot " + action + "d");
    } catch (e) {
      if (onErr) onErr(errOf(e));
      else st.say(errOf(e), false);
    } finally {
      pilotBusy.set(null);
    }
  };
  return { d, v, asking, buttons, busy, press };
}

/** A transient error beside its control (the legacy act(): it fades after 8 s, or on a tap). */
function useFlash(): [string, (m: string) => void] {
  const [m, setM] = useState("");
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return [
    m,
    (x: string) => {
      setM(x);
      clearTimeout(t.current);
      if (x) t.current = setTimeout(() => setM(""), 8000);
    },
  ];
}
export function Err({ m, clear }: { m: string; clear?: () => void }) {
  return (
    <span className="sm-err" role="alert" title={m ? "Tap to dismiss" : undefined} onClick={clear}>
      {m}
    </span>
  );
}

/** studio-pilot.js's row: the requirements, Build it and its state, Checkpoints; a decision the autopilot waits on. */
export function PilotRow() {
  const st = useStudio();
  const { d, v, asking, buttons, busy, press } = usePilot();
  const write = useWriter();
  const [err, setErr] = useFlash();
  const [dErr, setDErr] = useFlash();
  const [deciding, setDeciding] = useState<number | null>(null);
  const c = d.cl ? checklistChip(d.cl.progress) : null;
  const rows = d.cps ? checkpointRows(d.cps) : [];
  const ex = openExperiment(d.cps);
  const ro = !st.canWrite;
  const dec = asking && v.decisions ? v.decisions[0] : null;
  const answer = async (label: string, i: number) => {
    if (deciding !== null) return;
    setDeciding(i);
    try {
      await write("app", "questions/" + encodeURIComponent(dec.question) + "/answer", { answer: label, option: i });
      await write("env", "autopilot", { action: "resume" }).catch(() => null);
      st.say("Answered: " + label + ". The autopilot goes on");
    } catch (e) {
      setDErr(errOf(e));
    } finally {
      setDeciding(null);
    }
  };
  return (
    <div className="sm-pilot" role="group" aria-label={st.name + ": requirements and autopilot"} data-k="pilot">
      <div className="sm-prow">
        <button
          type="button"
          className="cp-btn sm sm-cbtn"
          data-k="pilot-checklist"
          aria-haspopup="dialog"
          title={c ? c.title : d.clErr ? "The checklist could not be read: " + d.clErr : "No requirements yet: answers and asks become them"}
          onClick={() => st.open({ kind: "checklist" })}
        >
          <span className="sm-prog">
            {c ? (
              <span className={"sm-meter t-" + (c.tone || "n")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct} aria-label={c.text}>
                <i style={{ width: c.pct + "%" }} />
              </span>
            ) : null}
            <span className={c ? "sm-l" : undefined}>{c ? c.text : d.cl === null && !d.clErr ? "Requirements…" : d.clErr ? "Requirements unavailable" : "No requirements yet"}</span>
            {c ? (
              <span className="sm-s" aria-hidden="true">
                {(d.cl.progress.verified || 0) + "/" + d.cl.progress.total + " verified"}
              </span>
            ) : null}
          </span>
        </button>
        <span className="sm-ap" data-k="pilot-autopilot">
          {v.busy ? <Spin /> : null}
          {v.state !== "off" && v.state !== "none" && !asking ? (
            <span className="sm-apt" role="status">
              <b>{v.state === "running" ? "Autopilot: " : ""}</b>
              {v.text}
            </span>
          ) : null}
          {v.state === "none" ? (
            <button type="button" className="cp-btn sm" disabled title="The autopilot (envs) does not answer here yet">
              Build it
            </button>
          ) : null}
          {buttons.map((b) => (
            <button
              key={b.action}
              type="button"
              className={"cp-btn sm" + (b.pri ? " sm-pri" : "")}
              data-k={b.k}
              disabled={ro || busy === b.action}
              aria-busy={busy === b.action || undefined}
              title={ro ? READ_ONLY : b.title || undefined}
              onClick={() => press(b.action, setErr)}
            >
              {busy === b.action ? <Spin /> : null}
              {b.label}
            </button>
          ))}
          <Err m={err} clear={() => setErr("")} />
        </span>
        <button
          type="button"
          className="cp-btn sm"
          data-k="pilot-checkpoints"
          aria-haspopup="dialog"
          disabled={d.cps === null}
          title={d.cps === null ? "Checkpoints (envs) do not answer here yet" : "Named checkpoints of staging, rollback, experiments"}
          onClick={() => st.open({ kind: "checkpoints" })}
        >
          {ex ? <span className="sm-cut">{"Experiment: " + ex.name}</span> : "Checkpoints" + (rows.length ? " (" + rows.length + ")" : "")}
        </button>
      </div>
      {dec ? (
        <div className="sm-dec" role="group" aria-label="The autopilot needs your decision" data-k="pilot-decision">
          <b>{"Build it needs your decision" + (v.decisions!.length > 1 ? " (1 of " + v.decisions!.length + ")" : "") + ":"}</b>
          <span>{dec.text}</span>
          {(dec.options || []).slice(0, 6).map((label: string, i: number) => (
            <button key={i} type="button" className="cp-btn sm" data-k={"pilot-decide-" + i} disabled={ro || deciding !== null} title={ro ? READ_ONLY : undefined} onClick={() => answer(label, i)}>
              {deciding === i ? <Spin /> : null}
              {label}
            </button>
          ))}
          <button type="button" className="cp-btn sm danger" data-k="pilot-stop" disabled={ro || busy === "stop"} title={ro ? READ_ONLY : "Stop the autopilot (staging keeps what it built)"} onClick={() => press("stop", setDErr)}>
            {busy === "stop" ? <Spin /> : null}Stop
          </button>
          <Err m={dErr} clear={() => setDErr("")} />
        </div>
      ) : null}
    </div>
  );
}

// ---------- THE CHECKLIST (a dialog)
export function ChecklistLayer() {
  const st = useStudio();
  const d = usePilotData();
  const write = useWriter();
  const [err, setErr] = useFlash();
  const [pending, setPending] = useState<string | null>(null);
  const cl = d.cl;
  const c = cl ? checklistChip(cl.progress) : null;
  const ro = !st.canWrite;
  const run = async (k: string, fn: () => Promise<void>, onErr = setErr) => {
    if (pending) return;
    setPending(k);
    onErr("");
    try {
      await fn();
    } catch (e) {
      onErr(errOf(e));
    } finally {
      setPending(null);
    }
  };
  const unw = cl ? (cl.items || []).filter((i: any) => i.status === "unwritten").length : 0;
  return (
    <StudioModal open onClose={st.close} size="md" testid="pilot-checklist-dialog" title={"Requirements · " + st.name + (c ? " · " + c.text : "")}>
      {!cl ? (
        <p className={d.clErr ? "sm-err" : "sm-empty"} role={d.clErr ? "alert" : undefined}>
          {d.clErr ? "The checklist could not be read: " + d.clErr : "Loading…"}
        </p>
      ) : (
        <div className="sm-db" data-k="pilot-cl-dialog">
          <div className="sm-form">
            <button
              type="button"
              className={"cp-btn sm" + (unw ? " sm-pri" : "")}
              data-k="pilot-author"
              disabled={ro || !unw || pending === "author"}
              title={ro ? READ_ONLY : unw ? "One Haiku run writes a browser check (page, steps, expected) for each of the " + unw : "Every requirement has its check"}
              onClick={() =>
                run("author", async () => {
                  await write("qa", "checklist/author", {});
                  st.say("Writing the browser checks; they appear here as they are written");
                })
              }
            >
              {pending === "author" ? <Spin /> : null}
              {pending === "author" ? "Writing checks…" : "Write the checks" + (unw ? " (" + unw + ")" : "")}
            </button>
            <button
              type="button"
              className="cp-btn sm"
              data-k="pilot-verify"
              disabled={ro || pending === "verify"}
              title={ro ? READ_ONLY : "Check staging in a browser now: syntax, the page loads at phone and wide, then each requirement with a check"}
              onClick={() =>
                run("verify", async () => {
                  await write("qa", "verify", {});
                  st.say("Verifying staging in a browser (30-120 s)");
                })
              }
            >
              {pending === "verify" ? <Spin /> : null}Verify staging now
            </button>
            <Err m={err} clear={() => setErr("")} />
          </div>
          {c && c.detail ? (
            <p className="sm-empty" data-k="pilot-detail">
              {c.detail}
            </p>
          ) : null}
          {cl.author && cl.author.at ? (
            <p className="sm-empty" data-k="pilot-author-last">
              {"Checks last written " + agoShort(cl.author.at) + " ago (" + (cl.author.written || 0) + " written" + (cl.author.refused ? ", " + cl.author.refused + " refused" : "") + ")"}
            </p>
          ) : null}
          <p className="sm-empty">A requirement passes only when a browser check proves it on staging, never on the builder's say-so.</p>
          {checklistGroups(cl.items).length ? (
            checklistGroups(cl.items).map((g) => (
              <section key={g.k} aria-label={g.label} data-k={"pilot-group-" + g.k}>
                <h4 className="sm-h4">{g.label + " (" + g.items.length + ")"}</h4>
                <ul className="sm-list">
                  {g.items.map((it: any) => (
                    <ItemRow key={it.id} it={it} />
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <p className="sm-empty">No requirements yet: every answered question and every ask becomes one.</p>
          )}
        </div>
      )}
    </StudioModal>
  );
}
function ItemRow({ it }: { it: any }) {
  const st = useStudio();
  const write = useWriter();
  const [err, setErr] = useFlash();
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const how = howOf(it.scenario), ver = it.verified;
  const blk = it.status === "fail" && ver && ["step", "run"].includes(ver.failedAt);
  const shot = ver && ver.verify && ver.shot ? studioFileSrc(st.app, "qa", "verify/" + encodeURIComponent(ver.verify) + "/shot/" + String(ver.shot).split("/").map(encodeURIComponent).join("/")) : null;
  useEffect(() => {
    if (why !== null && inp.current && document.activeElement !== inp.current) {
      inp.current.focus();
      inp.current.select();
    }
  }, [why !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (busy || why === null) return;
    setErr("");
    if (why.trim().length < 3) return setErr("Say why in a few words");
    setBusy(true);
    try {
      await write("qa", "checklist/" + it.id, { verifiable: false, why: why.trim() });
      st.say("Marked context: " + String(it.text).slice(0, 60));
      setWhy(null);
    } catch (e) {
      setErr(errOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={"sm-it " + groupOf(it)} data-k={"pilot-item-" + it.id}>
      <div className="t">{it.text}</div>
      <div className="w">{how ? "Check: " + how : it.status === "context" ? "Not testable" + (it.why ? ": " + it.why : "") : "No check written yet"}</div>
      {ver ? (
        <div className="w">
          {(it.status === "pass" ? "Verified " : blk ? "Could not be checked " : "Checked ") + agoShort(ver.at) + " ago" + (ver.why ? " · " + ver.why : "") + (shot ? " · " : "")}
          {shot ? (
            <a href={shot} target="_blank" rel="noopener noreferrer" data-k={"pilot-shot-" + it.id}>
              Show me
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="r">
        {it.status === "unwritten" || it.status === "pending" ? (
          why === null ? (
            <button type="button" className="cp-btn sm" data-k={"pilot-ctx-" + it.id} disabled={!st.canWrite} title={st.canWrite ? "Mark it context: true of the app, but nothing a browser can check" : READ_ONLY} onClick={() => setWhy("a goal, not a visible behaviour")}>
              Not testable
            </button>
          ) : (
            <>
              <input
                ref={inp}
                className="sm-in"
                type="text"
                maxLength={200}
                value={why}
                aria-label="Why a browser cannot check it"
                data-k={"pilot-ctx-why-" + it.id}
                onChange={(e) => setWhy(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <button type="button" className="cp-btn sm sm-pri" data-k={"pilot-ctx-save-" + it.id} disabled={busy} onClick={save}>
                {busy ? <Spin /> : null}Save
              </button>
            </>
          )
        ) : null}
        <Err m={err} clear={() => setErr("")} />
      </div>
    </li>
  );
}

// ---------- CHECKPOINTS (a dialog)
export function CheckpointsLayer() {
  const st = useStudio();
  const d = usePilotData();
  const write = useWriter();
  const [err, setErr] = useFlash();
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [arm, setArm] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const armT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(armT.current), []);
  const ro = !st.canWrite;
  const ex = openExperiment(d.cps);
  const rows = checkpointRows(d.cps);
  const run = async (k: string, fn: () => Promise<void>, onErr: (m: string) => void = setErr) => {
    if (pending) return;
    setPending(k);
    onErr("");
    try {
      await fn();
    } catch (e) {
      onErr(errOf(e));
    } finally {
      setPending(null);
    }
  };
  // a second press confirms (5 s), as the legacy Discard and Roll back
  const armed = (k: string) => {
    if (arm === k) {
      clearTimeout(armT.current);
      setArm(null);
      return true;
    }
    setArm(k);
    clearTimeout(armT.current);
    armT.current = setTimeout(() => setArm((x) => (x === k ? null : x)), 5000);
    return false;
  };
  const save = () =>
    run("save", async () => {
      const j = await write<any>("env", "checkpoints", { name: name.trim() || undefined });
      setName("");
      st.say("Checkpoint saved" + (j && j.checkpoint ? ": " + j.checkpoint.name : ""));
    });
  return (
    <StudioModal open onClose={st.close} size="md" testid="pilot-cp-dialog" title={"Checkpoints · " + st.name}>
      {!d.cps ? (
        <p className="sm-empty">{d.cps === null ? "Checkpoints are not available yet." : "Loading…"}</p>
      ) : (
        <div className="sm-db" data-k="pilot-cp-body">
          {ex ? (
            <div className="sm-dec" role="group" aria-label="The open experiment">
              <b>Experiment open:</b>
              <span>{ex.name + " · since " + agoShort(ex.at || ex.startedAt) + " ago"}</span>
              <button
                type="button"
                className="cp-btn sm sm-pri"
                data-k="pilot-ex-keep"
                disabled={ro || pending === "keep"}
                title={ro ? READ_ONLY : undefined}
                onClick={() =>
                  run("keep", async () => {
                    await write("env", "experiments/" + ex.id + "/keep", {});
                    st.say("Kept: " + ex.name);
                  })
                }
              >
                {pending === "keep" ? <Spin /> : null}Keep it
              </button>
              <button
                type="button"
                className="cp-btn sm danger"
                data-k="pilot-ex-discard"
                disabled={ro || pending === "discard"}
                title={ro ? READ_ONLY : undefined}
                onClick={() => {
                  if (!armed("ex")) return;
                  void run("discard", async () => {
                    await write("env", "experiments/" + ex.id + "/discard", {});
                    st.say("Discarded: " + ex.name + "; staging is back where it started");
                  });
                }}
              >
                {pending === "discard" ? <Spin /> : null}
                {arm === "ex" ? "Discard: staging goes back to its start" : "Discard"}
              </button>
            </div>
          ) : null}
          <div className="sm-form">
            <input
              className="sm-in"
              type="text"
              maxLength={60}
              placeholder="Name, e.g. Before the new header"
              aria-label="Checkpoint or experiment name"
              data-k="pilot-cp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !ro) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            <button type="button" className="cp-btn sm sm-pri" data-k="pilot-cp-save" disabled={ro || pending === "save"} title={ro ? READ_ONLY : undefined} onClick={save}>
              {pending === "save" ? <Spin /> : null}Save checkpoint
            </button>
            <button
              type="button"
              className="cp-btn sm"
              data-k="pilot-ex-start"
              disabled={ro || Boolean(ex) || pending === "try"}
              title={ro ? READ_ONLY : ex ? "Keep or discard the open experiment first" : "Mark where staging is now, try something (a darker theme, a new layout), then keep it or discard it"}
              onClick={() =>
                run("try", async () => {
                  const nm = name.trim();
                  if (nm.length < 3) throw new Error("Name the experiment first (e.g. Try a darker theme)");
                  await write("env", "experiments", { name: nm });
                  setName("");
                  st.say("Experiment started: " + nm + ". Ask for it, then keep or discard it");
                })
              }
            >
              {pending === "try" ? <Spin /> : null}Try an experiment
            </button>
          </div>
          <Err m={err} clear={() => setErr("")} />
          {rows.length ? (
            <ul className="sm-list" data-k="pilot-cp-list">
              {rows.map((c: any, i: number) => (
                <li key={c.id} className={"sm-it" + (c.kind === "green step" ? " pass" : "")}>
                  <div className="t">{c.name}</div>
                  <div className="w">{[c.kind, agoShort(c.at) + " ago", c.sha, c.progress].filter(Boolean).join(" · ")}</div>
                  <div className="r">
                    <button
                      type="button"
                      className={"cp-btn sm" + (arm === c.id ? " danger" : "")}
                      data-k={"pilot-rollback-" + c.id}
                      aria-label={arm === c.id ? "Roll staging back to " + c.name + ": press again to confirm" : "Roll staging back to " + c.name}
                      disabled={ro || i === 0 || pending === "rb-" + c.id}
                      title={ro ? READ_ONLY : i === 0 ? "Staging is at the newest checkpoint or past it: roll back to an older one" : undefined}
                      onClick={() => {
                        if (!armed(c.id)) return;
                        void run(
                          "rb-" + c.id,
                          async () => {
                            await write("env", "checkpoints/" + c.id + "/rollback", {});
                            st.say("Rolling staging back to " + c.name + " (saved first as a checkpoint)");
                          },
                          (m) => setRowErr((x) => ({ ...x, [c.id]: m })),
                        );
                      }}
                    >
                      {pending === "rb-" + c.id ? <Spin /> : null}
                      {arm === c.id ? "Roll back: press again" : "Roll back"}
                    </button>
                    <Err m={rowErr[c.id] || ""} clear={() => setRowErr((x) => ({ ...x, [c.id]: "" }))} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sm-empty">No checkpoints yet: each green step of Build it saves one, or save one now.</p>
          )}
        </div>
      )}
    </StudioModal>
  );
}
