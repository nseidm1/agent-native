/**
 * FA-19173: THE STUDIO'S QA PANEL (qa-panel.js, whole): launch QA agents in a selectable quantity on the app's STAGING copy.
 *   RUN QA: a quantity (1..the cockpit's cap), a focus, the judge model, the quote BEFORE starting (qa quote, a GET) -> qa run (paid).
 *   LIVE: one card per agent (persona, scenario, step, done/total, its last screenshot), cost so far vs the quote, Stop one / Stop all.
 *   FINDINGS: merged across agents; choose some and Fix in staging (one staging change) or Report; Dismiss teaches the dedupe.
 *   REQUIREMENTS: the definition of done, each item's state, why, screenshot and browser check; Verify staging, Write missing checks.
 *   COVERAGE on the app map, and the mock wallets of a crypto app. Nothing here files a card.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, studioFileSrc, studioRead, studioWrite, useStudio } from "../api";
import { type Gate, qaFile } from "./data";

const money = (x: unknown) => "$" + (Number(x) || 0).toFixed(2);
const OPEN = ["new", "regressed", "dismissed-like"];
const LIVE = ["running", "starting", "prepared"];
// nothing built in the app map (every screen a mock): no quote to ask for, Run QA off and says why
export const nothingBuilt = (ov: any) => !!ov && Array.isArray(ov.screens) && !ov.screens.some((s: any) => s.kind === "built") && !(ov.mocks && ov.mocks.scenarios);
// the scenarios a quote covers, named
export const covers = (q: any, max = 6) => {
  const all = [...new Set((q.agents || []).flatMap((a: any) => a.scenarios || []))] as string[];
  return all.slice(0, max).join(", ") + (all.length > max ? " and " + (all.length - max) + " more" : "");
};
// a requirement's state as the panel names it (a failure on a step is the check not reaching its screen, never 'failing')
const RQ = (i: any): [string, string] =>
  i.status === "pass" ? ["verified", "passing"] : i.status === "fail" ? (i.verified && ["step", "run"].includes(i.verified.failedAt) ? ["could not check", "fixing"] : ["failing", "failing"]) : i.status === "pending" ? ["not checked yet", "untested"] : i.status === "unwritten" ? ["no check yet", "untested"] : [i.status, "mock"];
const RQ_ORDER = ["failing", "could not check", "not checked yet", "no check yet", "verified"];
const MODELS = ["sonnet", "haiku", "opus", "pi"];

export function QaPanel({ gate, say }: { gate: Gate | null; say: (t: string, ok?: boolean) => void }) {
  const st = useStudio();
  const { app, canWrite } = st;
  const [ov, setOv] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [cl, setCl] = useState<any>(null);
  const [vfs, setVfs] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [S, setS] = useState({ n: 3, focus: "all", model: "sonnet", judge: true, autoFix: false });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dismiss, setDismiss] = useState<{ sig: string; why: string } | null>(null);
  const dead = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ovRef = useRef<any>(null);

  const refresh = useCallback(async () => {
    if (dead.current) return;
    let v: any = null;
    try {
      const o = await studioRead<any>(app, "qa", "");
      const lr = o.runs.find((r: any) => LIVE.includes(r.status)) || o.runs[0];
      v = lr ? await studioRead<any>(app, "qa", "runs/" + lr.id).catch(() => null) : null;
      const c = await studioRead<any>(app, "qa", "checklist").catch(() => null);
      const f = await studioRead<any>(app, "qa", "verify").catch(() => null);
      if (dead.current) return;
      ovRef.current = o;
      setOv(o);
      setView(v);
      setCl(c);
      setVfs(f);
      setFailed(null);
    } catch (e) {
      if (!dead.current) setFailed(errText(e));
    }
    if (dead.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, v && LIVE.includes(v.status) ? 2500 : 12000);
  }, [app]);
  const requote = useCallback(
    async (s: { n: number; model: string; focus: string }) => {
      const o = ovRef.current;
      if (nothingBuilt(o)) return setQuote({ error: "No built screen in the app map yet: QA agents drive built screens (mocks are not in staging)" });
      try {
        // the client carries quote with n and model only: the focus is not in the quote (it is in the run)
        setQuote(await studioRead<any>(app, "qa", "quote", { n: s.n, model: s.model }));
      } catch (e) {
        setQuote({ error: errText(e) });
      }
    },
    [app],
  );
  useEffect(() => {
    dead.current = false;
    refresh().then(() => requote(S));
    return () => {
      dead.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (path: string, body: Record<string, unknown> = {}) => studioWrite<any>(app, "qa", path, body);
  async function start() {
    setBusy(true);
    try {
      const r = await post("run", { n: S.n, focus: S.focus, model: S.model, judge: S.judge, autoFix: S.autoFix });
      say("QA run " + r.run + " started: " + r.n + " agents, " + (r.quote && r.quote.text));
    } catch (e) {
      say("QA run refused: " + errText(e), false);
    }
    setBusy(false);
    void refresh();
  }
  async function stop(agent: string | null) {
    try {
      const r = await post("runs/" + view.id + "/stop", agent ? { agent } : {});
      say("Stopped " + ((r.stopped || []).join(", ") || "nothing (already ended)"));
    } catch (e) {
      say("Stop refused: " + errText(e), false);
    }
    void refresh();
  }
  async function acts(path: "fix" | "report") {
    setBusy(true);
    const sigs = [...pick];
    try {
      const r = await post("findings/" + path, { sigs });
      setPick(new Set());
      say(path === "fix" ? "Sent to staging as one change (" + (r.change && r.change.id) + "): the staging app reloads when it lands" : r.reported + " reported");
    } catch (e) {
      say((path === "fix" ? "Fix in staging refused: " : "Report refused: ") + errText(e), false);
    }
    setBusy(false);
    void refresh();
  }
  async function doDismiss(sig: string, why: string) {
    try {
      await post("findings/" + sig + "/dismiss", { why });
      setDismiss(null);
    } catch (e) {
      say("Dismiss refused: " + errText(e), false);
    }
    void refresh();
  }
  async function saveCheck(i: any) {
    let sc: unknown;
    try {
      sc = JSON.parse(drafts[i.id] != null ? drafts[i.id] : JSON.stringify(i.scenario));
    } catch {
      say("That check is not JSON: nothing saved", false);
      return;
    }
    try {
      const r = await post("checklist/" + i.id, { scenario: sc });
      if (r.refused && r.refused.length) say("Check refused: " + r.refused[0].errors.join("; "), false);
      else {
        setDrafts((d) => {
          const x = { ...d };
          delete x[i.id];
          return x;
        });
        say("Check saved: it runs at the next verify");
      }
    } catch (e) {
      say("Check refused: " + errText(e), false);
    }
    void refresh();
  }
  async function verifyNow() {
    try {
      await post("verify", {});
      say("Verifying staging in a browser: the result shows here in about a minute");
    } catch (e) {
      say("Verify refused: " + errText(e), false);
    }
    void refresh();
  }
  async function authorNow() {
    try {
      await post("checklist/author", {});
      say("Writing the missing browser checks (one small model run)");
    } catch (e) {
      say("Refused: " + errText(e), false);
    }
    void refresh();
  }

  if (failed && !ov)
    return (
      <div className="sg-qa">
        <p className="sg-err" role="alert">
          QA panel: {failed}
        </p>
      </div>
    );
  if (!ov)
    return (
      <p className="sg-msg" role="status">
        <i className="ap-spin" aria-hidden="true" /> Loading the QA agents…
      </p>
    );
  const RO = canWrite ? undefined : READ_ONLY;
  // ---------- launch
  const live = Boolean(view && LIVE.includes(view.status));
  const off = nothingBuilt(ov);
  const set = (p: Partial<typeof S>, re = false) => {
    const n = { ...S, ...p };
    setS(n);
    if (re) void requote(n);
  };
  const runWhy = !canWrite ? READ_ONLY : gate ? gate.why : undefined;
  const st0 = ov.staging;
  const launch = (
    <section className="sg-sec" aria-labelledby="sg-qa-h" data-k="qa-launch">
      <div className="sg-row">
        <h3 id="sg-qa-h">QA agents</h3>
        {st0 && st0.running ? (
          <span className="sg-chip running" title={st0.url}>
            on staging {st0.sha || ""}
          </span>
        ) : (
          <span className="sg-chip">{st0 ? "staging is not running: QA starts it" : "no staging copy yet"}</span>
        )}
      </div>
      {ov.dry ? <p className="sg-dim">{ov.profile.status}</p> : null}
      <div className="sg-row sg-qaform">
        <label>
          Agents
          <input type="number" className="cp-in sg-num" min={1} max={ov.cap} value={S.n} aria-label="How many QA agents" data-k="qa-n" disabled={off} onChange={(e) => set({ n: Math.max(1, Math.min(ov.cap, Number(e.target.value) || 1)) }, true)} />
          <span className="sg-dim">of {ov.cap}</span>
        </label>
        <label>
          Focus
          <select className="cp-in sg-sel" aria-label="Focus" data-k="qa-focus" disabled={off} value={S.focus} onChange={(e) => set({ focus: e.target.value }, true)}>
            <option value="all">All flows</option>
            {ov.focus.screens.length ? (
              <optgroup label="A screen">
                {ov.focus.screens.map((s: any) => (
                  <option key={s.id} value={"screen:" + s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {ov.focus.features.length ? (
              <optgroup label="A feature">
                {ov.focus.features.map((f: string) => (
                  <option key={f} value={"feature:" + f}>
                    {f}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {ov.focus.cards.length ? (
              <optgroup label="A card's change">
                {ov.focus.cards.map((c: string) => (
                  <option key={c} value={"card:" + c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label>
          Judge
          <select className="cp-in sg-sel" aria-label="Judge model" data-k="qa-model" disabled={off} value={S.model} onChange={(e) => set({ model: e.target.value }, true)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m === "pi" ? "Pi + Bonsai 2 ($0, text only)" : m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
          <input type="checkbox" className="sg-cb" aria-label="Judge each scenario" checked={S.judge} onChange={(e) => set({ judge: e.target.checked })} />
        </label>
        <label title="When the run ends, its new medium+ findings go to staging as one change job">
          <input type="checkbox" className="sg-cb" checked={S.autoFix} onChange={(e) => set({ autoFix: e.target.checked })} />
          Fix in staging when done
        </label>
        <button type="button" className="cp-btn sg-pri" data-k="qa-run" disabled={live || busy || ov.dry || !ov.staging || off || Boolean(runWhy)} title={runWhy} onClick={start}>
          {live ? "A QA run is going" : "Run QA"}
        </button>
      </div>
      {quote && !quote.error ? (
        <div className="sg-dim" data-k="qa-quote">
          {quote.quote.text} · {quote.scenarios} scenarios over {quote.n} agent{quote.n > 1 ? "s" : ""}: {quote.agents.map((a: any) => a.label + " (" + a.scenarios.length + ")").join(", ")}. Covers: {covers(quote)}
        </div>
      ) : quote && quote.error ? (
        <div className="sg-err" data-k="qa-quote">
          {quote.error}
        </div>
      ) : null}
      <p className="sg-dim" data-k="qa-personas">
        Personas: {ov.personas.map((p: any) => p.label).join(", ")}. Findings are fixed in staging or reported here; nothing files a card (Promote to production does).
      </p>
    </section>
  );
  // ---------- the live (or last) run
  let liveSec: React.ReactNode = null;
  if (view) {
    const q = view.quote || {},
      frac = q.p90 ? Math.min(1, view.costUsd / q.p90) : 0,
      s = view.summary;
    liveSec = (
      <section className="sg-sec" aria-labelledby="sg-qa-run-h" aria-live="polite" data-k="qa-run-view">
        <div className="sg-row">
          <h3 id="sg-qa-run-h">
            {live ? "Running " : "Last run "}
            {view.id}
          </h3>
          <span className={"sg-chip " + view.status}>{view.status}</span>
          <span className="sg-dim">
            {money(view.costUsd)} of {q.text || "no quote"}
          </span>
          {live ? (
            <button type="button" className="cp-btn sm danger" data-k="qa-stop-all" disabled={!canWrite} title={RO} onClick={() => stop(null)}>
              Stop all
            </button>
          ) : null}
        </div>
        <div className="sg-meter" title="cost so far vs the 80% quote">
          <i style={{ width: Math.round(frac * 100) + "%" }} />
        </div>
        {s ? (
          <div className="sg-dim">
            {s.passed}/{s.results} scenarios passed · {s.findings.length} findings ({s.findings.filter((f: any) => ["new", "regressed"].includes(f.status)).length} new) · coverage {s.coverageSummary.passing} passing, {s.coverageSummary.failing} failing of {s.coverageSummary.built} built screens
          </div>
        ) : null}
        <div className="sg-agents">
          {view.agents.map((a: any) => (
            <div className="sg-agent" key={a.id} data-k={"qa-agent-" + a.id}>
              <div className="sg-row">
                <b>
                  {a.id} · {a.label}
                </b>
                <span className={"sg-chip " + a.status}>{a.status}</span>
              </div>
              {a.lastShot ? <img src={studioFileSrc(app, "qa", "runs/" + view.id + "/shot/" + a.lastShot)} alt={a.label + ": last screenshot"} loading="lazy" /> : null}
              <div className="sg-dim">{a.scenario ? a.scenario + (a.step ? " · " + a.step : "") : a.error || ""}</div>
              <div className="sg-row">
                <span>
                  {a.done}/{a.total} · {a.passed} ok · {a.findings} findings{a.costUsd ? " · " + money(a.costUsd) : ""}
                </span>
                {a.live ? (
                  <button type="button" className="cp-btn sm" data-k={"qa-stop-" + a.id} disabled={!canWrite} title={RO} onClick={() => stop(a.id)}>
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {!s && view.live && view.live.length ? (
          <div>
            <h4 className="sg-h4">Findings as they arrive</h4>
            <ul className="sg-fl">
              {view.live
                .slice(-8)
                .reverse()
                .map((f: any, i: number) => (
                  <li key={i} className="sg-dim">
                    {f.agent} · {f.severity} · {f.screen || ""}: {f.title}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }
  // ---------- the requirements
  let rqSec: React.ReactNode = null;
  if (cl && cl.progress && Array.isArray(cl.items)) {
    const rank = (i: any) => {
      const k = RQ_ORDER.indexOf(RQ(i)[0]);
      return k < 0 ? RQ_ORDER.length : k;
    };
    const pr = cl.progress,
      items = cl.items.filter((i: any) => i.status !== "retired").sort((a: any, b: any) => rank(a) - rank(b)),
      last = vfs && Array.isArray(vfs.results) ? vfs.results[0] : null;
    const lay = (l: any) => l.id + (l.skipped ? " skipped" : l.ok === true ? " passed" : l.ok === false ? " failed" : " started");
    const shotSrc = (u: string) => qaFile(app, u);
    rqSec = (
      <section className="sg-sec" aria-labelledby="sg-qa-rq-h" data-k="qa-requirements">
        <div className="sg-row">
          <h3 id="sg-qa-rq-h">Requirements</h3>
          <b>{pr.text}</b>
          <button type="button" className="cp-btn sm sg-pri" data-k="qa-verify" disabled={busy || !canWrite} title={RO} onClick={verifyNow}>
            Verify staging
          </button>
          {items.some((i: any) => i.status === "unwritten") ? (
            <button type="button" className="cp-btn sm" data-k="qa-author" disabled={busy || !canWrite} title={RO} onClick={authorNow}>
              Write missing checks
            </button>
          ) : null}
        </div>
        <div className="sg-meter" title={pr.text}>
          <i style={{ width: (pr.total ? Math.round((pr.verified / pr.total) * 100) : 0) + "%" }} />
        </div>
        {pr.detail || pr.note ? <div className="sg-dim">{[pr.detail, pr.note].filter(Boolean).join(" · ")}</div> : null}
        <p className="sg-dim">Every answered question and asked change is a requirement; it is verified only when a browser check passes on staging.</p>
        {last ? (
          <div className="sg-row">
            <span className="sg-dim">Latest verify {last.id}:</span>
            {last.layers.map((l: any) => (
              <span key={l.id} className={"sg-chip " + (l.ok === false ? "failing" : l.ok === true ? "passing" : "untested")} title={l.why || ""}>
                {lay(l)}
              </span>
            ))}
            {last.failed ? <span className="sg-err">{(last.layers.find((l: any) => l.id === last.failed) || {}).why || ""}</span> : null}
          </div>
        ) : null}
        {last && last.shots && last.shots.length ? (
          <div className="sg-shots">
            {last.shots.slice(0, 4).map((u: string) => (
              <a key={u} href={shotSrc(u)} target="_blank" rel="noopener noreferrer">
                <img src={shotSrc(u)} alt="verify screenshot" loading="lazy" />
              </a>
            ))}
          </div>
        ) : null}
        <ul className="sg-rq">
          {items.map((i: any) => {
            const [label, cls] = RQ(i),
              vv = i.verified;
            return (
              <li key={i.id} data-k={"qa-rq-" + i.id}>
                <div className="sg-row">
                  <span className={"sg-chip " + cls}>{label}</span>
                  <span>{i.text}</span>
                </div>
                {i.status === "fail" && vv && vv.why ? <div className="sg-dim">{vv.why}</div> : i.status === "context" && i.why ? <div className="sg-dim">{i.why}</div> : null}
                {vv && vv.shot ? (
                  <a className="sg-a" href={studioFileSrc(app, "qa", "verify/" + vv.verify + "/shot/" + vv.shot)} target="_blank" rel="noopener noreferrer">
                    Screenshot
                  </a>
                ) : null}
                {i.status !== "context" ? (
                  <details data-k={"qa-rq-d-" + i.id}>
                    <summary>{i.scenario ? "The browser check" : "Write the browser check"}</summary>
                    <textarea
                      className="cp-in area sg-code"
                      aria-label={"Browser check for: " + i.text}
                      data-k={"qa-rq-edit-" + i.id}
                      value={drafts[i.id] != null ? drafts[i.id] : JSON.stringify(i.scenario || { page: "", steps: [], expect: [{ text: "" }] }, null, 1)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                    />
                    <button type="button" className="cp-btn sm" data-k={"qa-rq-save-" + i.id} disabled={!canWrite} title={RO} onClick={() => saveCheck(i)}>
                      Save check
                    </button>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  // ---------- findings
  const fs: any[] = ov.findings || [];
  let fSec: React.ReactNode;
  if (!fs.length)
    fSec = (
      <section className="sg-sec" data-k="qa-findings">
        <h3>Findings</h3>
        <p className="sg-dim">None yet.</p>
      </section>
    );
  else {
    const open = fs.filter((f) => OPEN.includes(f.status));
    const chosen = new Set([...pick].filter((s) => open.some((f) => f.sig === s)));
    const actB = (path: "fix" | "report", label: string) => (
      <button type="button" className={"cp-btn sm" + (path === "fix" ? " sg-pri" : "")} data-k={"qa-" + path} disabled={!chosen.size || busy || !canWrite} title={RO} onClick={() => acts(path)}>
        {label + (chosen.size ? " (" + chosen.size + ")" : "")}
      </button>
    );
    fSec = (
      <section className="sg-sec" aria-labelledby="sg-qa-f-h" data-k="qa-findings">
        <div className="sg-row">
          <h3 id="sg-qa-f-h">Findings</h3>
          <span className="sg-dim">
            {open.length} open of {fs.length}
          </span>
          {actB("fix", "Fix in staging")}
          {actB("report", "Report")}
          {open.length ? (
            <button type="button" className="cp-btn sm ghost" onClick={() => setPick(chosen.size === open.length ? new Set() : new Set(open.map((f) => f.sig)))}>
              {chosen.size === open.length ? "Choose none" : "Choose all open"}
            </button>
          ) : null}
        </div>
        <ul className="sg-fl">
          {fs.map((f) => {
            const run = (f.runs || []).slice(-1)[0];
            return (
              <li className="sg-f" key={f.sig} data-k={"qa-f-" + f.sig}>
                {OPEN.includes(f.status) ? (
                  <input
                    type="checkbox"
                    className="sg-cb"
                    aria-label={"Choose: " + f.title}
                    checked={chosen.has(f.sig)}
                    onChange={(e) =>
                      setPick((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(f.sig);
                        else n.delete(f.sig);
                        return n;
                      })
                    }
                  />
                ) : (
                  <span />
                )}
                <div className="sg-fmain">
                  <div className="sg-row">
                    <span className={"sg-chip " + f.severity}>{f.severity}</span>
                    <b>{(f.screen ? f.screen + ": " : "") + f.title}</b>
                  </div>
                  <div className="sg-dim">
                    {f.kind} · {f.element || "page"}
                    {f.source ? " · " + f.source : ""} · {f.agents.length} agent{f.agents.length > 1 ? "s" : ""}
                    {f.change ? " · staging change " + f.change.id + " (" + (f.change.state || "") + ")" : ""}
                    {f.reportNote ? " · " + f.reportNote : ""}
                  </div>
                </div>
                <div className="sg-row sg-fside">
                  <span className={"sg-chip " + f.status}>{f.status}</span>
                  {OPEN.includes(f.status) && f.status !== "dismissed-like" ? (
                    <button type="button" className="cp-btn sm ghost" data-k={"qa-dismiss-" + f.sig} disabled={!canWrite} title={RO} onClick={() => setDismiss({ sig: f.sig, why: "" })}>
                      Dismiss
                    </button>
                  ) : null}
                </div>
                {dismiss && dismiss.sig === f.sig ? (
                  <form
                    className="sg-dismiss"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void doDismiss(f.sig, dismiss.why);
                    }}
                  >
                    <label className="sg-lab" htmlFor={"sg-dm-" + f.sig}>
                      Why is this not a defect? (teaches the dedupe)
                    </label>
                    <input id={"sg-dm-" + f.sig} className="cp-in" autoFocus maxLength={300} value={dismiss.why} onChange={(e) => setDismiss({ sig: f.sig, why: e.target.value })} onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), e.preventDefault(), setDismiss(null))} />
                    <button type="submit" className="cp-btn sm" data-k={"qa-dismiss-go-" + f.sig}>
                      Dismiss
                    </button>
                    <button type="button" className="cp-btn sm ghost" onClick={() => setDismiss(null)}>
                      Cancel
                    </button>
                  </form>
                ) : null}
                <details data-k={"qa-ev-" + f.sig}>
                  <summary>Repro and evidence</summary>
                  <pre>{[(f.repro || []).map((s: string, i: number) => i + 1 + ". " + s).join("\n"), f.expected && "Expected: " + f.expected, f.actual && "Actual: " + f.actual].filter(Boolean).join("\n")}</pre>
                  <div className="sg-row">
                    {(f.evidence || [])
                      .filter((e: any) => e.shot)
                      .slice(0, 3)
                      .map((e: any, i: number) =>
                        run ? (
                          <a key={i} className="sg-a" href={studioFileSrc(app, "qa", "runs/" + run + "/shot/" + e.shot)} target="_blank" rel="noopener noreferrer">
                            {e.agent} screenshot
                          </a>
                        ) : null,
                      )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  // ---------- coverage and wallets
  const n = (k: string) => ov.screens.filter((s: any) => s.cov.state === k).length;
  const cov = ov.screens.length ? (
    <section className="sg-sec" aria-labelledby="sg-qa-c-h" data-k="qa-coverage">
      <div className="sg-row">
        <h3 id="sg-qa-c-h">Coverage on the app map</h3>
        <span className="sg-dim">
          {n("passing")} passing · {n("failing")} failing · {n("untested")} untested · {n("mock")} mock
        </span>
      </div>
      <div className="sg-cov">
        {ov.screens.map((s: any) => (
          <span key={s.id} className={"sg-chip " + s.cov.state} title={s.cov.state + (s.cov.runs ? " · " + s.cov.passed + "/" + s.cov.runs + " scenarios ok · " + s.cov.findings + " findings" : "")}>
            {s.name} · {s.cov.state}
          </span>
        ))}
      </div>
    </section>
  ) : null;
  const p = ov.profile;
  const wal = p.crypto ? (
    <section className="sg-sec" data-k="qa-wallets">
      <h3>Mock wallets{ov.dry ? " (dry design)" : ""}</h3>
      <p className="sg-dim">Each agent gets a fresh throwaway key and a QA Sandbox Wallet on the run's own sandbox ledger (chain 31337). Never a real wallet, key, mainnet or public testnet.</p>
      {p.wallets ? (
        <ul>
          {Object.entries(p.wallets).map(([role, w]: [string, any]) => (
            <li key={role}>
              {role}: funded{" "}
              {Object.entries(w.fund || {})
                .map(([k, v]) => v + " " + k)
                .join(", ")}{" "}
              · {(w.does || []).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {p.crossAgent ? <p className="sg-dim">{p.crossAgent}</p> : null}
      {p.needs ? <p className="sg-dim">{p.needs}</p> : null}
    </section>
  ) : null;
  return (
    <div className="sg-qa" data-k="qa-panel">
      {launch}
      {liveSec}
      {rqSec}
      {fSec}
      {cov}
      {wal}
    </div>
  );
}
