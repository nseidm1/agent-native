/**
 * FA-19173: API MOCKS (card-studio.js mkOpen .. mkPopup): the QA agents dialog's mocks view. The app's external API dependencies, each
 * with its status, contract, live verification and scenarios; Generate / Update (a capped agent job: PAID, so its popup names the
 * dependencies, the model and the cap BEFORE anything is spent), Verify live (an agent job with the console's own credential file),
 * Use mocks in QA runs; the last QA run's issues (App bug -> Send to staging, Mock issue / Unclear -> fixed by the next update), each
 * kind changeable, each dismissable, each with its screenshot and request log.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, studioFileSrc, studioRead, studioWrite, useStudio, when } from "../api";
import { StudioModal } from "../Modal";
import { mkgPut, qaFile, useFlash } from "./data";

const Spin = () => <i className="ap-spin" aria-hidden="true" />;
const MK_CAPS: Record<string, number> = { haiku: 1, sonnet: 2, opus: 4 };
const MK_STATUS: Record<string, [string, string]> = { none: ["Not generated", ""], generating: ["Generating", "s"], ready: ["Ready", "g"], stale: ["Stale", "a"], failed: ["Failed", "r"] };
const MK_KIND: Record<string, [string, string]> = { app: ["App bug", "r"], mock: ["Mock issue", "a"], unclear: ["Unclear", ""] };
const MK_MAXF = 5,
  MK_MAXB = 5 << 20;
const tone = (t: string) => (t ? " t-" + (t === "s" ? "s" : t) : " t-d");

export function mkGenLabel(d: any) {
  const deps = (d && d.deps) || [],
    is = (d && d.lastRun && d.lastRun.issues) || [];
  const open = is.filter((x: any) => x.state === "open").length;
  if (!deps.some((x: any) => x.status === "ready" || x.status === "stale" || x.status === "failed") && !is.length) return { text: "Generate mocks…", open: 0 };
  return open ? { text: "Update mocks", open } : { text: "Update mocks…", open: 0 };
}
const mkTicked = (issues: any[], fix: Record<string, boolean>) => (issues || []).filter((x) => x.state === "open" && (x.kind === "mock" || x.kind === "unclear") && (fix || {})[x.id] !== false);
function mkFixedOf(prev: any, next: any): string[] {
  if (!prev || !next || !prev.runId || prev.runId === next.runId) return [];
  const live = (s: string) => s === "open" || s === "sent",
    still = new Set((next.issues || []).filter((x: any) => live(x.state)).map((x: any) => x.scenario));
  return [...new Set((prev.issues || []).filter((x: any) => live(x.state) && !still.has(x.scenario)).map((x: any) => x.scenario))] as string[];
}

type Mk = { data: any; state: "loading" | "ok" | "absent" | "error"; why: string };

export function MocksView({ focusGen, onFocused, say, back, setPopOpen }: { focusGen: boolean; onFocused: () => void; say: (t: string, ok?: boolean) => void; back: React.RefObject<HTMLButtonElement | null>; setPopOpen: (on: boolean) => void }) {
  const st = useStudio();
  const { app, name, canWrite } = st;
  const [mk, setMk] = useState<Mk>({ data: null, state: "loading", why: "" });
  const [openRes, setOpenRes] = useState(false);
  const [fix, setFix] = useState<Record<string, boolean>>({});
  const [fixed, setFixed] = useState<{ runId: string; ids: string[]; names: string[] } | null>(null);
  const [wait, setWait] = useState(0); // following the update's re-run until (ms)
  const [pick, setPick] = useState<string[] | null>(null);
  const [shot, setShot] = useState<{ src: string; nm: string; opener: HTMLElement | null } | null>(null);
  const [err, setErr, clearErr] = useFlash();
  const [ierr, setIerr, clearIerr] = useFlash();
  const [busyK, setBusyK] = useState<string | null>(null);
  const data = useRef<any>(null);
  const waitRef = useRef(0);
  waitRef.current = wait;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dead = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // a popup or the screenshot over the view: Esc is theirs, not Back
  useEffect(() => setPopOpen(Boolean(pick || shot)), [pick, shot, setPopOpen]);

  const load = useCallback(async () => {
    if (dead.current) return;
    if (timer.current) clearTimeout(timer.current);
    const before = data.current && data.current.lastRun;
    let next: Mk;
    try {
      const d = await studioRead<any>(app, "qa", "mocks");
      next = { data: d, state: "ok", why: "" };
    } catch (e) {
      const t = errText(e);
      if (/\b404\b|no such|not found/i.test(t) && !data.current) next = { data: null, state: "absent", why: "" };
      else if (data.current) {
        next = { data: data.current, state: "ok", why: "" };
        setErr("Could not refresh the mocks: " + t);
      } else next = { data: null, state: "error", why: t };
    }
    if (dead.current) return;
    data.current = next.data;
    setMk(next);
    if (next.state === "ok" && next.data) mkgPut(app, next.data);
    // a new QA run landed (the update's re-run): mark the scenarios it fixed, stop waiting for it
    const lr = next.data && next.data.lastRun;
    let w = waitRef.current;
    if (lr && before && lr.runId !== before.runId) {
      const fx = mkFixedOf(before, lr);
      w = 0;
      setFixed({ runId: lr.runId, ids: fx, names: fx.map((sc) => ((before.issues || []).find((x: any) => x.scenario === sc) || {}).name || sc) });
      say("QA re-ran with the mocks: " + (lr.passed ?? "?") + " of " + (lr.total ?? "?") + " passed" + (fx.length ? ", " + fx.length + " fixed" : ""));
    }
    if (w && lr && (!before || lr.runId !== before.runId)) w = 0;
    if (w && Date.now() > w) w = 0;
    if (w !== waitRef.current) setWait(w);
    // while a generation, a verification or the update's re-run runs, the view follows it
    const d = next.data;
    if (d && (d.job || w || (d.deps || []).some((x: any) => x.status === "generating"))) timer.current = setTimeout(load, document.hidden ? 8000 : 2000);
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    dead.current = false;
    void load();
    return () => {
      dead.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    if (wait) void load();
  }, [wait]); // eslint-disable-line react-hooks/exhaustive-deps
  // focus Generate mocks… / Update mocks… once the view has drawn (Back when a generation runs and Generate is off)
  useEffect(() => {
    if (!focusGen || mk.state === "loading") return;
    const g = boxRef.current && (boxRef.current.querySelector("[data-k=qa-mocks-open]") as HTMLButtonElement | null);
    const to = g && !g.disabled ? g : back.current;
    if (to) {
      to.focus();
      onFocused();
    }
  }, [focusGen, mk.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = (path: string, body: Record<string, unknown>) => studioWrite<any>(app, "qa", "mocks" + path, body);
  async function act(k: string, fn: () => Promise<void>, onErr: (m: string) => void = setErr) {
    if (busyK) return;
    setBusyK(k);
    clearErr();
    clearIerr();
    try {
      await fn();
    } catch (e) {
      onErr(errText(e));
    } finally {
      setBusyK(null);
    }
  }
  const patch = (id: string, p: any) => {
    const d = data.current;
    if (!d || !d.lastRun) return;
    const nd = { ...d, lastRun: { ...d.lastRun, issues: (d.lastRun.issues || []).map((x: any) => (x.id === id ? { ...x, ...p } : x)) } };
    data.current = nd;
    setMk((m) => ({ ...m, data: nd }));
    setTimeout(() => (document.getElementById("sg-mkish") as HTMLElement | null)?.focus(), 0);
  };

  const Box = (kids: React.ReactNode) => (
    <div className="sg-mk" data-k="qa-mocks-body" ref={boxRef}>
      {kids}
    </div>
  );
  if (mk.state === "loading")
    return Box(
      <p className="sg-msg" role="status">
        <Spin /> Reading the app's API dependencies…
      </p>,
    );
  if (mk.state === "absent")
    return Box(
      <div className="sg-msg" role="status" data-k="qa-mocks-absent">
        <b>API mocks are not available yet</b>
        <p className="sg-dim">The QA mock engine is not installed on this cockpit yet. When it is, {name}'s external API calls are listed here and mocks can be generated from each vendor's own contract.</p>
      </div>,
    );
  if (mk.state === "error")
    return Box(
      <div className="sg-msg" role="alert">
        <b>Could not read the API mocks</b>
        <p>{mk.why}</p>
        <button
          type="button"
          className="cp-btn sm"
          data-k="qa-mocks-retry"
          onClick={() => {
            setMk({ data: null, state: "loading", why: "" });
            void load();
          }}
        >
          Try again
        </button>
      </div>,
    );
  const d = mk.data,
    deps: any[] = d.deps || [],
    gen = deps.some((x) => x.status === "generating"),
    ready = deps.some((x) => x.status === "ready" || x.status === "stale");
  const gl = mkGenLabel(d);
  const on = Boolean(d.useInQa);
  const RO = canWrite ? undefined : READ_ONLY;
  const genWhy = !deps.length ? "No external API calls found in " + name : gen ? "A generation is running" : gl.open ? "Update the mocks: the popup lists the issues this update addresses, before anything is spent" : "Choose the dependencies, the model and the cap, and add context, before anything is spent";
  const ctxText = d.context && d.context.text ? String(d.context.text) : "";
  return (
    <div className="sg-mk" data-k="qa-mocks-body" ref={boxRef}>
      <p className="sg-dim">Mocks answer {name}'s external API calls the way the real API does (its official contract), so the QA agents can pass or fail the implementation. Generate and Verify live are agent jobs with a cap.</p>
      <div className="sg-row sg-mkbar">
        <button type="button" className="cp-btn sg-pri" data-k="qa-mocks-open" aria-haspopup="dialog" disabled={!deps.length || gen} title={genWhy} onClick={() => setPick(deps.map((x) => x.id))}>
          {gen ? <Spin /> : null}
          {gl.text}
          {gl.open ? (
            <>
              {" · "}
              <span className="sg-mkbadge">
                {gl.open} issue{gl.open === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
        </button>
        <span className="sg-sp" />
        <button
          type="button"
          className="sg-sw"
          role="switch"
          aria-checked={on}
          data-k="qa-mocks-use"
          disabled={!ready || !canWrite || busyK === "use"}
          title={!canWrite ? READ_ONLY : ready ? "QA runs answer the app's API calls from these mocks and report PASS / FAIL per scenario" : "On once a dependency's mocks are ready"}
          onClick={() =>
            act("use", async () => {
              const r = await post("/use", { on: !on });
              const nd = { ...data.current, useInQa: r && typeof r.useInQa === "boolean" ? r.useInQa : !on };
              data.current = nd;
              setMk((m) => ({ ...m, data: nd }));
              say(!on ? "QA runs now use the API mocks" : "QA runs no longer use the API mocks");
            })
          }
        >
          <span className="sg-knob" aria-hidden="true" />
          Use mocks in QA runs
        </button>
      </div>
      {err ? (
        <p className="sg-err" role="alert" title="Tap to dismiss" onClick={clearErr}>
          {err}
        </p>
      ) : null}
      {d.lastRun ? (
        <Issues
          d={d}
          fixed={fixed}
          wait={Boolean(wait)}
          openRes={openRes}
          setOpenRes={setOpenRes}
          fix={fix}
          setFix={setFix}
          ierr={ierr}
          clearIerr={clearIerr}
          busyK={busyK}
          onShot={(src, nm, el) => setShot({ src, nm, opener: el })}
          onAct={(k, path, body, p, said) =>
            act(
              k,
              async () => {
                const r = await post(path, body);
                patch(p.id, (r && r.issue) || p.patch);
                say(said);
              },
              setIerr,
            )
          }
        />
      ) : null}
      {ctxText ? (
        <p className="sg-dim" data-k="qa-mocks-context">
          <b>Context used: </b>
          {ctxText.replace(/\s+/g, " ").slice(0, 160) + (ctxText.length > 160 ? "…" : "")}
          {d.context.at ? " · " + when(d.context.at) : ""}
        </p>
      ) : null}
      {deps.length ? (
        <ul className="sg-mklist" aria-label={"API dependencies of " + name}>
          {deps.map((x) => (
            <DepRow
              key={x.id}
              x={x}
              gen={gen}
              d={d}
              ro={RO}
              busy={busyK === "verify-" + x.id}
              onRegen={() => setPick([x.id])}
              onVerify={() =>
                act("verify-" + x.id, async () => {
                  await post("/verify", { dep: x.id });
                  say("Verifying " + (x.vendor || x.id) + " against the live API");
                  void load();
                })
              }
            />
          ))}
        </ul>
      ) : (
        <div className="sg-msg" role="status" data-k="qa-mocks-none">
          No external API calls found in {name}.
        </div>
      )}
      {pick ? (
        <MocksPopup
          d={d}
          pick={pick}
          fix={fix}
          onClose={(sent) => {
            const one = pick.length === 1 && deps.length > 1 ? pick[0] : null;
            setPick(null);
            if (sent) {
              if (sent.rerun) setWait(Date.now() + 30 * 60e3);
              say(sent.text);
              void load();
            }
            setTimeout(() => (boxRef.current?.querySelector(one ? '[data-k="qa-mocks-regen-' + one + '"]' : "[data-k=qa-mocks-open]") as HTMLElement | null)?.focus(), 0);
          }}
        />
      ) : null}
      {shot ? (
        <StudioModal
          open
          size="lg"
          testid="sg-mkshot"
          title={shot.nm}
          onClose={() => {
            const o = shot.opener;
            setShot(null);
            setTimeout(() => o && o.isConnected && o.focus(), 0);
          }}
        >
          <img className="sg-shotbig" src={shot.src} alt={"Screenshot of " + shot.nm} />
        </StudioModal>
      ) : null}
    </div>
  );
}

function DepRow({ x, gen, d, ro, busy, onRegen, onVerify }: { x: any; gen: boolean; d: any; ro?: string; busy: boolean; onRegen: () => void; onVerify: () => void }) {
  const [word, t] = MK_STATUS[x.status] || [String(x.status || "Unknown"), ""];
  const ops = Array.isArray(x.operations) ? x.operations.length : Number(x.operations) || 0;
  const jb = d && d.job && d.job.kind === "generate" ? d.job : null;
  const p = x.progress || (jb ? { pct: jb.N ? (100 * jb.n) / jb.N : 0, label: jb.step ? (jb.N ? "Step " + jb.n + " of " + jb.N + ": " : "") + jb.step : null } : {});
  const pct = Math.max(0, Math.min(100, Math.round(Number(p.pct) || 0))),
    verifying = Boolean(d && d.job && d.job.kind === "verify");
  const why = x.status === "stale" ? "Stale - " + (x.why || "the app or the spec changed") : x.status === "failed" ? "Failed: " + (x.why || "no reason given") : x.status === "generating" ? p.label || x.why || null : null;
  const c = x.contract || {};
  let host: string | null = null;
  if (/^https?:\/\//.test(c.source || ""))
    try {
      host = new URL(c.source).host;
    } catch {
      host = null;
    }
  const contract = c.source
    ? "from " + (host ? "the published spec at " + host : c.source) + (c.fetchedAt ? ", fetched " + when(c.fetchedAt) : "") + (c.sha ? " (" + String(c.sha).slice(0, 10) + ")" : "")
    : x.status === "ready" || x.status === "stale"
      ? "from the app's own call (no published vendor spec)"
      : "no contract yet";
  const cred = x.credential && (x.credential === true || x.credential.present);
  const howCred = (x.credential && x.credential.how) || x.credentialHow || "No credential file: place a JSON credential for " + (x.vendor || x.id) + " (chmod 600) under .tmp/lane/qa/credentials/ yourself; the studio never asks for a credential";
  const scn: any[] = Array.isArray(x.scenarios) ? x.scenarios : [];
  const used = x.context && (x.context.text || typeof x.context === "string") ? String(x.context.text || x.context).replace(/\s+/g, " ") : x.context && x.context.current === false ? "an earlier context (Regenerate to use the current one)" : null;
  return (
    <li className="sg-mkrow" data-k="qa-mocks-dep">
      <div className="sg-mkhd">
        <b>{x.vendor || x.id}</b>
        <span className="sg-dim">
          {ops} operation{ops === 1 ? "" : "s"}
        </span>
        <span className={"ap-chip" + tone(t)} data-k="qa-mocks-status">
          {x.status === "generating" ? <Spin /> : null}
          {word}
        </span>
        <span className="sg-sp" />
        <button type="button" className="cp-btn sm" data-k={"qa-mocks-regen-" + x.id} aria-haspopup="dialog" disabled={gen} title={gen ? "A generation is running" : "Generate this dependency's mocks again (opens the options first)"} onClick={onRegen}>
          {x.status === "none" ? "Generate…" : "Regenerate…"}
        </button>
        <button
          type="button"
          className="cp-btn sm"
          data-k={"qa-mocks-verify-" + x.id}
          disabled={!cred || gen || verifying || (x.status !== "ready" && x.status !== "stale") || Boolean(ro) || busy}
          title={ro || (!cred ? howCred : x.status !== "ready" && x.status !== "stale" ? "Generate the mocks first" : "Check the mocks against the real " + (x.vendor || x.id) + " API with your credential file (an agent job)")}
          onClick={onVerify}
        >
          {verifying || busy ? <Spin /> : null}Verify live
        </button>
      </div>
      {x.status === "generating" ? (
        <div className="sg-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={pct + "%" + (p.label ? ", " + p.label : "")} aria-label={"Generating the " + (x.vendor || x.id) + " mocks"}>
          <i style={{ width: pct + "%" }} />
        </div>
      ) : null}
      {why ? <p className={"sg-mkwhy" + (x.status === "failed" ? " r" : "")}>{why}</p> : null}
      <p className="sg-dim">
        {contract} ·{" "}
        {x.live && x.live.verifiedAt ? <span className="ap-chip t-g">Verified live {when(x.live.verifiedAt)}</span> : <span>contract-derived, not live-verified</span>}
      </p>
      {used ? <p className="sg-dim">Context used: {used.slice(0, 140) + (used.length > 140 ? "…" : "")}</p> : null}
      {scn.length ? (
        <details className="sg-mkscn">
          <summary>
            {scn.length} scenario{scn.length === 1 ? "" : "s"} the QA checks
          </summary>
          <ul>
            {scn.map((s, i) => (
              <li key={i}>
                <b>{s.title || s.id}</b>
                {s.expect ? <span> - the app must show: {s.expect}</span> : null}
                {s.result ? <span className={"ap-chip " + (s.result === "PASS" ? "t-g" : "t-r")}>{s.result}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {x.why && (x.status === "none" || x.mockable === false) ? <p className="sg-dim">{x.why}</p> : null}
    </li>
  );
}

type IssueAct = (k: string, path: string, body: Record<string, unknown>, p: { id: string; patch: any }, said: string) => void;
function Issues({ d, fixed, wait, openRes, setOpenRes, fix, setFix, ierr, clearIerr, busyK, onShot, onAct }: { d: any; fixed: { runId: string; ids: string[]; names: string[] } | null; wait: boolean; openRes: boolean; setOpenRes: (b: boolean) => void; fix: Record<string, boolean>; setFix: (f: Record<string, boolean>) => void; ierr: string; clearIerr: () => void; busyK: string | null; onShot: (src: string, nm: string, el: HTMLElement) => void; onAct: IssueAct }) {
  const lr = d.lastRun;
  const is: any[] = lr.issues || [],
    done = is.filter((x) => x.state === "addressed" || x.state === "dismissed"),
    live = is.filter((x) => !done.includes(x));
  const fx = fixed && fixed.runId === lr.runId ? fixed.names : [];
  const row = (x: any) => <IssueRow key={x.id} x={x} lr={lr} fixed={fixed} fix={fix} setFix={setFix} busyK={busyK} onShot={onShot} onAct={onAct} />;
  return (
    <section className="sg-mkis" aria-labelledby="sg-mkish" data-k="qa-mocks-issues">
      <div className="sg-mkhd">
        <h4 id="sg-mkish" tabIndex={-1}>
          Last QA run: {lr.passed ?? "?"} of {lr.total ?? "?"} passed{lr.at ? " · " + when(lr.at) : ""}
        </h4>
        {wait ? (
          <span className="ap-chip" role="status">
            <Spin />
            Re-running QA with the updated mocks
          </span>
        ) : null}
      </div>
      {fx.length ? (
        <p className="sg-mkfixed" role="status">
          <span className="ap-chip t-g">Fixed</span> now passing: {fx.join(", ")}
        </p>
      ) : null}
      {live.length ? (
        <ul className="sg-mkissues" aria-label="Open issues">
          {live.map(row)}
        </ul>
      ) : (
        <p className="sg-dim">{is.length ? "No open issues." : "No issues: every scenario passed."}</p>
      )}
      {done.length ? (
        <details className="sg-mkres" data-k="qa-mocks-resolved" open={openRes} onToggle={(e) => setOpenRes((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Resolved ({done.length})</summary>
          <ul className="sg-mkissues" aria-label="Resolved issues">
            {done.map(row)}
          </ul>
        </details>
      ) : null}
      {ierr ? (
        <p className="sg-err" role="alert" onClick={clearIerr}>
          {ierr}
        </p>
      ) : null}
    </section>
  );
}

function IssueRow({ x, lr, fixed, fix, setFix, busyK, onShot, onAct }: { x: any; lr: any; fixed: { runId: string; ids: string[] } | null; fix: Record<string, boolean>; setFix: (f: Record<string, boolean>) => void; busyK: string | null; onShot: (src: string, nm: string, el: HTMLElement) => void; onAct: IssueAct }) {
  const st = useStudio();
  const { app, canWrite } = st;
  const [word, t] = MK_KIND[x.kind] || MK_KIND.unclear;
  const nm = x.name || x.scenario || x.id;
  const done = x.state === "addressed" || x.state === "dismissed",
    isFixed = Boolean(fixed && fixed.runId === lr.runId && fixed.ids.includes(x.scenario));
  const [menu, setMenu] = useState(false);
  const [openLog, setOpenLog] = useState(false);
  const kb = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!menu) return;
    const i = Object.keys(MK_KIND).indexOf(x.kind);
    (items.current[i < 0 ? 0 : i] || items.current[0])?.focus();
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const shut = (focus = false) => {
    setMenu(false);
    if (focus) kb.current?.focus();
  };
  const src = x.shot ? (/^(https?:|data:image\/)/.test(x.shot) ? x.shot : /^\//.test(x.shot) ? qaFile(app, x.shot) : studioFileSrc(app, "qa", "runs/" + lr.runId + "/shot/" + String(x.shot))) : null;
  const rq: any[] = Array.isArray(x.requests) ? x.requests : [];
  const RO = canWrite ? undefined : READ_ONLY;
  let acts: React.ReactNode;
  if (done) acts = <span className={"ap-chip" + (isFixed || x.state === "addressed" ? " t-g" : " t-d")}>{isFixed ? "Fixed" : x.state === "addressed" ? "Addressed" : "Dismissed"}</span>;
  else {
    const first =
      x.kind === "app" ? (
        x.state === "sent" ? (
          <span className="ap-chip">Sent to staging</span>
        ) : (
          <button type="button" className="cp-btn sm" data-k={"qa-mocks-send-" + x.id} disabled={!canWrite || busyK === "send-" + x.id} title={RO || "The app answered the mock wrong: send it to the app's staging to fix"} onClick={() => onAct("send-" + x.id, "/issues/" + x.id + "/send", {}, { id: x.id, patch: { state: "sent" } }, "Sent to staging: " + nm)}>
            {busyK === "send-" + x.id ? <Spin /> : null}Send to staging
          </button>
        )
      ) : (
        <label className="sg-fix">
          <input type="checkbox" className="sg-cb" checked={fix[x.id] !== false} data-k={"qa-mocks-fix-" + x.id} onChange={(e) => setFix({ ...fix, [x.id]: e.target.checked })} />
          Fix in the next update
        </label>
      );
    acts = (
      <>
        {first}
        <button type="button" className="cp-btn sm ghost" data-k={"qa-mocks-dismiss-" + x.id} aria-label={"Dismiss " + nm} disabled={!canWrite || busyK === "dismiss-" + x.id} title={RO} onClick={() => onAct("dismiss-" + x.id, "/issues/" + x.id, { state: "dismissed" }, { id: x.id, patch: { state: "dismissed" } }, "Dismissed: " + nm)}>
          Dismiss
        </button>
      </>
    );
  }
  const keys = Object.keys(MK_KIND);
  return (
    <li className={"sg-mkissue" + (done ? " done" : "")} data-k="qa-mocks-issue">
      <div className="sg-mkhd">
        <b>{nm}</b>
        <span
          className="sg-kindw"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) shut();
          }}
        >
          <button
            ref={kb}
            type="button"
            className={"ap-chip sg-kind" + tone(t)}
            title={x.why || "Change the kind"}
            aria-haspopup="menu"
            aria-expanded={menu}
            data-k={"qa-mocks-kindmenu-" + x.id}
            aria-label={word + (x.why ? ": " + x.why : "") + ". Change the kind"}
            disabled={!canWrite}
            onClick={() => (menu ? shut() : setMenu(true))}
          >
            {word}
            <span aria-hidden="true"> ▾</span>
          </button>
          {menu ? (
            <div
              className="sg-kmenu"
              role="menu"
              aria-label="Kind of issue"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  e.preventDefault();
                  shut(true);
                  return;
                }
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const i = items.current.indexOf(document.activeElement as HTMLButtonElement),
                  n = keys.length;
                items.current[(i + (e.key === "ArrowDown" ? 1 : n - 1)) % n]?.focus();
              }}
            >
              {keys.map((k, i) => (
                <button
                  key={k}
                  ref={(el) => {
                    items.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={k === x.kind}
                  data-k={"qa-mocks-kind-" + x.id + "-" + k}
                  onClick={() => {
                    shut();
                    if (k === x.kind) return;
                    onAct("kind-" + x.id, "/issues/" + x.id, { kind: k }, { id: x.id, patch: { kind: k } }, nm + " is now " + MK_KIND[k][0]);
                  }}
                >
                  {MK_KIND[k][0]}
                </button>
              ))}
            </div>
          ) : null}
        </span>
        {x.dep ? <span className="sg-dim">{x.dep}</span> : null}
        {isFixed && !done ? <span className="ap-chip t-g">Fixed</span> : null}
      </div>
      <div className="sg-mkiss">
        <dl className="sg-mkeo">
          <dt>Expected</dt>
          <dd>{x.expected || "-"}</dd>
          <dt>Observed</dt>
          <dd>{x.observed || "-"}</dd>
        </dl>
        {src ? (
          <button type="button" className="sg-mkthumb" data-k={"qa-mocks-shot-" + x.id} aria-label={"Screenshot of " + nm + ", open it large"} onClick={(e) => onShot(src, nm, e.currentTarget)}>
            <img src={src} alt="" loading="lazy" />
          </button>
        ) : null}
      </div>
      {rq.length ? (
        <details className="sg-mkreq" data-k="qa-mocks-req" open={openLog} onToggle={(e) => setOpenLog((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>Request log ({rq.length})</summary>
          <pre>{rq.map((r) => (typeof r === "string" ? r : [r.method, r.url, r.status != null ? "-> " + r.status : null, r.note].filter(Boolean).join(" "))).join("\n")}</pre>
        </details>
      ) : null}
      <div className="sg-row sg-mkacts">{acts}</div>
    </li>
  );
}

/** THE POPUP before anything is paid: which dependencies, the model and its cap, context, attachments; Cancel spends nothing. */
function MocksPopup({ d, pick, fix, onClose }: { d: any; pick: string[]; fix: Record<string, boolean>; onClose: (sent: { text: string; rerun: boolean } | null) => void }) {
  const st = useStudio();
  const { app, name, canWrite } = st;
  const deps: any[] = d.deps || [];
  const key = "qa-mocks-context:" + app;
  const [boxes, setBoxes] = useState<Record<string, boolean>>(() => Object.fromEntries(deps.map((x) => [x.id, pick.includes(x.id)])));
  const caps = { ...MK_CAPS, ...(d.caps || {}) };
  const [model, setModel] = useState("sonnet");
  const [cap, setCap] = useState(String(caps.sonnet));
  const [ctx, setCtx] = useState(() => {
    let saved = "";
    try {
      saved = localStorage.getItem(key) || "";
    } catch {
      /* private mode */
    }
    return (d.context && d.context.text) || saved;
  });
  const [files, setFiles] = useState<any[]>([]);
  const [kept, setKept] = useState<any[]>(() => ((d.context && d.context.files) || []).map((f: any) => ({ ...f, drop: false })));
  const [adr, setAdr] = useState<any[]>(() => mkTicked(d.lastRun && d.lastRun.issues, fix));
  const [rerun, setRerun] = useState(true);
  const [qwen, setQwen] = useState<{ ok: boolean; text: string; title?: string }>({ ok: false, text: "Qwen3.8 (Halo, free) · checking…" });
  const [err, setErr, clearErr] = useFlash();
  const [going, setGoing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const upd = Boolean(d.lastRun) || deps.some((x) => x.status === "ready" || x.status === "stale" || x.status === "failed");
  useEffect(() => {
    setTimeout(() => taRef.current?.focus(), 0);
    // Qwen3.8 on the Halo writes the same JSON for $0 and the same checks decide; greyed with the reason when it is off, down or still checking
    studioRead<any>(app, "studio", "qwen")
      .then((s) => setQwen({ ok: Boolean(s.available), text: s.label + (s.available ? " · $0, the same checks decide" : " · off: " + String(s.why || "").slice(0, 48)), title: s.available ? "Qwen3.8 has no tools: it does not see attached screenshots" : s.why }))
      .catch(() => setQwen({ ok: false, text: "Qwen3.8 (Halo, free) · state unknown" }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const n = deps.filter((x) => boxes[x.id]).length;
  const modelLabel = model === "qwen" ? qwen.text : model[0].toUpperCase() + model.slice(1);
  const quote = n + " of " + deps.length + " dependenc" + (deps.length === 1 ? "y" : "ies") + " · " + modelLabel + (model === "qwen" ? " · $0 (the Halo)" : " · at most $" + (Number(cap) || 0).toFixed(2) + " for this generation");
  async function addFiles(list: FileList | null) {
    const out = [...files];
    for (const f of [...(list || [])]) {
      if (out.length >= MK_MAXF) {
        setErr("At most " + MK_MAXF + " attachments");
        break;
      }
      if (f.size > MK_MAXB) {
        setErr(f.name + " is over 5 MB");
        continue;
      }
      const img = /^image\//.test(f.type);
      const data = await new Promise<string>((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result));
        r.onerror = () => no(r.error);
        if (img) r.readAsDataURL(f);
        else r.readAsText(f);
      }).catch(() => null);
      if (data == null) {
        setErr("Could not read " + f.name);
        continue;
      }
      out.push({ name: f.name.slice(0, 120), type: f.type || (/\.har$/i.test(f.name) ? "application/har+json" : "text/plain"), size: f.size, ...(img ? { dataUrl: data } : { text: data }) });
    }
    setFiles(out);
  }
  async function go() {
    if (going) return;
    clearErr();
    const ids = deps.filter((x) => boxes[x.id]).map((x) => x.id),
      maxUsd = model === "qwen" ? null : Number(cap),
      context = ctx.trim();
    if (!ids.length) return setErr("Tick at least one dependency");
    if (model !== "qwen" && !(maxUsd! >= 0.25 && maxUsd! <= 20)) return setErr("The cap is between $0.25 and $20");
    try {
      localStorage.setItem(key, context);
    } catch {
      /* private mode */
    }
    const removeFiles = kept.filter((f) => f.drop).map((f) => f.name);
    const issues = adr.map((x) => x.id);
    setGoing(true);
    try {
      await studioWrite(app, "qa", "mocks/generate", { deps: ids, model, maxUsd, context, attachments: files, issues, rerun, ...(removeFiles.length ? { removeFiles } : {}) });
      onClose({ rerun, text: (upd ? "Updating" : "Generating") + " the API mocks (" + ids.length + ")" + (issues.length ? ", addressing " + issues.length + " issue" + (issues.length === 1 ? "" : "s") : "") + (rerun ? "; QA re-runs when done" : "") });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setGoing(false);
    }
  }
  return (
    <StudioModal
      open
      size="md"
      testid="sg-mkpop"
      title={(upd ? "Update" : "Generate") + " API mocks · " + (name || app)}
      onClose={() => onClose(null)}
      footer={
        <div className="sg-foot">
          <button type="button" className="cp-btn sg-pri" data-k="qa-mocks-go" disabled={!canWrite || going} title={canWrite ? quote : READ_ONLY} onClick={go}>
            {going ? <Spin /> : null}Generate
          </button>
          <button type="button" className="cp-btn ghost" data-k="qa-mocks-cancel" onClick={() => onClose(null)}>
            Cancel
          </button>
          <span className="sg-sp" />
          <span className="sg-dim">{quote}</span>
        </div>
      }
    >
      <div className="sg-mkform" data-k="qa-mocks-popup">
        <fieldset>
          <legend>Dependencies</legend>
          {deps.map((x) => (
            <label key={x.id} className="sg-fix">
              <input type="checkbox" className="sg-cb" checked={Boolean(boxes[x.id])} value={x.id} data-k={"qa-mocks-dep-" + x.id} onChange={(e) => setBoxes({ ...boxes, [x.id]: e.target.checked })} />
              {(x.vendor || x.id) + " · " + (Array.isArray(x.operations) ? x.operations.length : Number(x.operations) || 0) + " operations"}
            </label>
          ))}
        </fieldset>
        {d.lastRun ? (
          <>
            <p className="sg-lab">This update addresses:</p>
            <ul className="sg-mkfiles" aria-label="Issues this update addresses">
              {adr.length ? (
                adr.map((x, i) => (
                  <li key={x.id}>
                    <span className={"ap-chip" + tone((MK_KIND[x.kind] || MK_KIND.unclear)[1])}>{(MK_KIND[x.kind] || MK_KIND.unclear)[0]}</span> {(x.name || x.scenario) + (x.observed ? " - " + String(x.observed).slice(0, 90) : "")}
                    <button type="button" className="sg-x" aria-label={"Remove " + (x.name || x.scenario) + " from this update"} onClick={() => setAdr(adr.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </li>
                ))
              ) : (
                <li className="sg-dim">No issue chosen: the update regenerates from the contract and the context</li>
              )}
            </ul>
          </>
        ) : null}
        <div className="sg-row">
          <label className="sg-lab" htmlFor="sg-mkmodel">
            Model
          </label>
          <select
            id="sg-mkmodel"
            className="cp-in sg-sel"
            data-k="qa-mocks-model"
            value={model}
            onChange={(e) => {
              const m = e.target.value;
              setModel(m);
              setCap(m === "qwen" ? "0" : String(caps[m]));
            }}
          >
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="qwen" data-k="qa-mocks-model-qwen" disabled={!qwen.ok} title={qwen.title}>
              {qwen.text}
            </option>
          </select>
          <label className="sg-lab" htmlFor="sg-mkcap">
            Cap $
          </label>
          <input id="sg-mkcap" className="cp-in sg-num" type="number" min="0.25" max="20" step="0.25" inputMode="decimal" value={cap} disabled={model === "qwen"} data-k="qa-mocks-cap" onChange={(e) => setCap(e.target.value)} />
        </div>
        <p className="sg-dim" role="status" data-k="qa-mocks-quote">
          {quote}
        </p>
        <label className="sg-lab" htmlFor="sg-mkctx">
          Context for the mocks
        </label>
        <textarea
          ref={taRef}
          id="sg-mkctx"
          className="cp-in area sg-ta"
          rows={9}
          maxLength={20000}
          data-k="qa-mocks-context-text"
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
          placeholder={
            "Anything that helps the mocks match what " +
            (name || app) +
            " will really meet, for example:\n- the API/SDK version the app targets (e.g. Jira Cloud REST v3, @atlassian/... 2.x)\n- the sandbox site / test account shape (no secrets): site name, projects, users\n- the real data the QA should see: projects, issue types, statuses, custom fields, how acceptance criteria are written\n- edge cases and error cases to cover: expired token, 401 / 403 / 429, empty project, pagination\n- links to the API docs the app follows"
          }
        />
        <p className="sg-warn" role="note">
          Do not paste tokens, passwords or client secrets here - live verification reads a credential file you place yourself
        </p>
        <label className="sg-lab" htmlFor="sg-mkfile">
          Attachments: sample responses (JSON), screenshots, the SDK's type file or an OpenAPI excerpt, HAR files (up to 5, 5 MB each)
        </label>
        <input
          id="sg-mkfile"
          type="file"
          multiple
          accept=".json,.har,.yaml,.yml,.ts,.txt,.md,.png,.jpg,.jpeg,.webp,application/json"
          data-k="qa-mocks-attach"
          onChange={(e) => {
            void addFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <ul className="sg-mkfiles" aria-label="Attachments">
          {kept.map((f, i) => (
            <li key={"k" + i} className={f.drop ? "drop" : undefined}>
              {f.name} · kept from last time{f.redacted ? " (redacted)" : ""}
              {f.drop ? " · will be removed" : ""}
              <button type="button" className="sg-x" aria-label={(f.drop ? "Keep " : "Remove ") + f.name} aria-pressed={f.drop} onClick={() => setKept(kept.map((y, j) => (j === i ? { ...y, drop: !y.drop } : y)))}>
                {f.drop ? "↺" : "×"}
              </button>
            </li>
          ))}
          {files.map((f, i) => (
            <li key={"f" + i}>
              {f.name} · {Math.max(1, Math.round(f.size / 1024))} KB
              <button type="button" className="sg-x" aria-label={"Remove " + f.name} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <p className="sg-dim">The engine redacts Authorization headers, cookies and tokens from HAR files and samples before storing them. The context is kept for {name || app} and filled in next time.</p>
        <label className="sg-fix" htmlFor="sg-mkrerun">
          <input type="checkbox" className="sg-cb" id="sg-mkrerun" data-k="qa-mocks-rerun" checked={rerun} onChange={(e) => setRerun(e.target.checked)} />
          Re-run QA with the mocks when done
        </label>
        {err ? (
          <p className="sg-err" role="alert" onClick={clearErr}>
            {err}
          </p>
        ) : null}
      </div>
    </StudioModal>
  );
}
