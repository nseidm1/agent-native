import { useActionMutation } from "@agent-native/core/client/hooks";
import { type ReactElement, type ReactNode, useState } from "react";

import type { AccountPartData, Flow, FlowLink, FlowStep } from "../../../../server/cockpit/windows/account";
import { READ_ONLY } from "../CardDialog";
import type { WindowPartProps } from "./index";
import "./account-part.css";

const ICON: Record<string, string> = { done: "✓", failed: "✕", working: "…", waiting: "→", pending: "○", skipped: "–" };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");

/**
 * FA-19125: the Claude account window's flow, ported from the legacy acctDlg body (page/account.js paint): with no flow, Sign in or
 * Swap account (Google first, an email pre-fill under another method), Resume now on a lane held for an out account, and Sign in
 * the Halo when it is on another account; with a flow, its steps with each one's action (Pause them now, the sign-in links, the
 * one-time code, Retry, Skip) and Done / Cancel. Everything runs in the cockpit: closing the window changes nothing. The code is a
 * password field, sent once and cleared; it is never logged, kept or shown back.
 */
export function AccountPart({ d, canWrite, onDone }: WindowPartProps) {
  const p = (d.part || {}) as unknown as AccountPartData;
  const f = p.flow;
  const [busy, setBusy] = useState(false);
  const [stat, setStat] = useState<{ t: string; bad?: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [ask, setAsk] = useState<{ q: string; yes: string; go: () => void } | null>(null);
  const start = useActionMutation<unknown, Record<string, unknown>>("cockpit-account-start", { timeoutMs: 160_000 });
  const codeM = useActionMutation<unknown, Record<string, unknown>>("cockpit-account-code", { timeoutMs: 160_000 });
  const step = useActionMutation<unknown, Record<string, unknown>>("cockpit-account-step", { timeoutMs: 160_000 });
  const off = busy || !canWrite;
  async function act(m: typeof start, args: Record<string, unknown>, label: string) {
    if (off) return;
    setAsk(null);
    setBusy(true);
    setStat({ t: label + "…" });
    try {
      await m.mutateAsync(args);
      setStat(null);
    } catch (e) {
      setStat({ t: errText(e), bad: true });
    } finally {
      setBusy(false);
      onDone();
    }
  }
  const Btn = ({ text, prim, onClick }: { text: string; prim?: boolean; onClick: () => void }) => (
    <button type="button" className={"cp-btn sm" + (prim ? " cf-ac-prim" : "")} disabled={off} title={!canWrite ? READ_ONLY : undefined} onClick={onClick}>
      {text}
    </button>
  );
  const sendCode = () => {
    const val = code.trim();
    setCode("");
    if (!val) return setStat({ t: "Paste the code from the sign-in page first.", bad: true });
    void act(codeM, { code: val }, "Checking the code");
  };
  const codeBox = (
    <span className="cf-ac-code">
      <input
        className="cp-in"
        type="password"
        name="acct-code"
        autoComplete="one-time-code"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        data-1p-ignore=""
        data-lpignore="true"
        aria-label="The one-time code claude.ai shows"
        placeholder="Paste the code claude.ai shows"
        value={code}
        disabled={off}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") sendCode();
        }}
      />
      <Btn text="Submit code" prim onClick={sendCode} />
    </span>
  );

  let body: ReactNode;
  if (!f) {
    const signin = p.loggedIn === false;
    const kind = signin ? "signin" : "swap";
    const what = signin ? "Starting the sign-in" : "Starting the swap";
    const begin = (args: Record<string, unknown>) =>
      setAsk({
        q: signin ? "Start the sign-in? claude.ai's sign-in page opens for the account the lane will run on." : "Swap the account? The lane pauses (running work finishes or is paused), signs out and signs in to the new account, then resumes on it.",
        yes: signin ? "Yes, sign in" : "Yes, swap",
        go: () => void act(start, args, what),
      });
    body = (
      <>
        {p.holdKind === "out" && p.loggedIn ? (
          <div className="cf-ac-row">
            <Btn text="Resume now" prim onClick={() => void act(step, { act: "resume" }, "Asking " + p.email + " with a test request")} />
            <span className="cf-ac-sub">
              Sends one tiny test request on {p.email}: if it answers, the lane resumes at once and the interrupted jobs pick up where they stopped; if the account is really out, the lane stays paused and says until when.
            </span>
          </div>
        ) : null}
        <div className="cf-ac-row">
          <Btn text={signin ? "Sign in" : "Swap account"} prim onClick={() => begin({ kind })} />
          <span className="cf-ac-sub">
            {signin
              ? "Opens claude.ai's sign-in page: Continue with Google, and on this Mac the sign-in finishes by itself (from the phone: paste back the code it shows). Agents resume on the new account."
              : "A swap: 1. pauses the lane (no new work; running agent runs finish within 10 min or are paused and resume afterwards), 2. signs out and opens claude.ai's sign-in page (Continue with Google) for the new account, 3. checks the new account with a test request, 4. resumes the lane on it, 5. signs the Halo in to it too (skippable: until then Halo drafting runs on the Mac)."}
          </span>
          <details className="cf-ac-other">
            <summary>Use a different sign-in method</summary>
            <div className="cf-ac-row">
              <input
                className="cp-in"
                type="text"
                inputMode="email"
                name="acct-prefill"
                autoComplete="off"
                data-1p-ignore=""
                data-lpignore="true"
                aria-label={(signin ? "Account" : "New account") + " email"}
                placeholder={(signin ? "Account" : "New account") + " email"}
                value={email}
                disabled={off}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Btn
                text={signin ? "Sign in with email" : "Swap with email"}
                onClick={() => {
                  const e = email.trim();
                  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return setStat({ t: "Type the account email first.", bad: true });
                  begin({ kind, email: e });
                }}
              />
              <span className="cf-ac-sub">For an account without Google: the email is filled in on claude.ai's page, which then sends that address a sign-in code or link.</span>
            </div>
          </details>
        </div>
        {p.haloMatch === false && p.loggedIn ? (
          <div className="cf-ac-row">
            <Btn text="Sign in the Halo" prim onClick={() => void act(start, { kind: "halo" }, "Starting the Halo sign-in")} />
            <span className="cf-ac-sub">Signs the Halo in to {p.email} with its own login (a sign-in page and a code). The lane keeps running; Halo drafting resumes once it matches.</span>
          </div>
        ) : null}
      </>
    );
  } else {
    const restHalo = f.steps.every((s) => s.id === "halo" || s.state === "done" || s.state === "skipped");
    body = (
      <>
        <ol className="cf-ac-steps">
          {f.steps.map((s) => (
            <StepRow key={s.id} s={s} f={f} Btn={Btn} codeBox={codeBox} onStep={(a, label) => void act(step, { act: a }, label)} />
          ))}
        </ol>
        <div className="cf-ac-row end">
          {f.done ? (
            <>
              <span className="cf-ac-sub">{f.result || "Finished."}</span>
              <Btn text="Done" prim onClick={() => void act(step, { act: "dismiss" }, "Closing")} />
            </>
          ) : restHalo ? (
            <span className="cf-ac-sub">The lane runs on the Mac's account; only the Halo is left. You can close this window: the step stays here.</span>
          ) : (
            <>
              <span className="cf-ac-sub">You can close this window: the cockpit keeps going and the steps are here when you reopen it.</span>
              <Btn
                text={"Cancel " + (f.kind === "signin" ? "sign-in" : "swap")}
                onClick={() =>
                  setAsk({
                    q: "Cancel? A sign-in in progress is abandoned. If an account is still signed in, the lane resumes on it; if not, it stays paused until you sign in.",
                    yes: "Yes, cancel",
                    go: () => void act(step, { act: "cancel" }, "Cancelling"),
                  })
                }
              />
            </>
          )}
        </div>
      </>
    );
  }
  return (
    <section className="cp-sec cf-ac" data-flow={f ? (f.done ? "done" : "running") : "none"} aria-label="Sign-in and swap">
      {body}
      {ask ? (
        <div className="cp-confirm cf-ac-ask" role="group" aria-label="Confirm">
          <span className="cp-confirm-q">{ask.q}</span>
          <button type="button" className="cp-btn sm" disabled={off} onClick={ask.go}>
            {ask.yes}
          </button>
          <button type="button" className="cp-btn sm ghost" onClick={() => setAsk(null)}>
            Back
          </button>
        </div>
      ) : null}
      {!canWrite ? <p className="cf-ac-sub">This device can only view the cockpit: open it from this Mac or the paired phone to change the account.</p> : null}
      <p className={"cf-ac-stat" + (stat && stat.bad ? " bad" : "")} role="status" aria-live="polite">
        {stat ? stat.t : ""}
      </p>
    </section>
  );
}

function StepRow({
  s,
  f,
  Btn,
  codeBox,
  onStep,
}: {
  s: FlowStep;
  f: Flow;
  Btn: (p: { text: string; prim?: boolean; onClick: () => void }) => ReactElement;
  codeBox: ReactNode;
  onStep: (act: string, label: string) => void;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const acts: ReactNode[] = [];
  if (s.id === "quiesce" && s.state === "working" && !f.checkpointedAt) acts.push(<Btn key="ck" text="Pause them now" onClick={() => onStep("checkpoint", "Pausing the running work")} />);
  const link: FlowLink | null | undefined = s.id === "signin" ? f.signin : s.id === "halo" ? f.halo : null;
  if (s.state === "waiting" && link) {
    // the callback finishes by itself on this Mac; the paste path is the fallback (legacy paint: link.mode decides)
    const cbm = link.mode === "callback" || link.mode === "connecting";
    const swapMac = s.id === "signin" && f.kind === "swap";
    const U = cbm ? [link.autoUrl, link.autoReauthUrl] : [link.url, link.reauthUrl];
    const main = swapMac && U[1] ? U[1] : U[0];
    const alt = swapMac && U[1] ? U[0] : U[1];
    const who = "On claude.ai press Continue with Google and pick " + (s.id === "halo" ? f.haloFor || "the Mac's account" : "the account") + ".";
    const A = ({ href, text, prim }: { href?: string; text: ReactNode; prim?: boolean }) =>
      href ? (
        <a className={"cp-btn sm cf-ac-link" + (prim ? " cf-ac-prim" : "")} href={href} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : null;
    const google = (
      <A
        key="g"
        prim
        href={main}
        text={
          <>
            <span className="cf-ac-g" aria-hidden="true">
              G
            </span>
            {(f.emailHint ? "Open the sign-in page" : "Continue with Google") + (s.id === "halo" ? " (Halo)" : "")}
          </>
        }
      />
    );
    if (link.mode === "connecting") acts.push(<span key="w" className="cf-ac-wait">{(link.why || "connecting") + "…"}</span>);
    else if (cbm) {
      acts.push(google);
      if (alt) acts.push(<A key="alt" href={alt} text={swapMac ? "Signed out on claude.ai? Open it directly" : "Use a different account"} />);
      acts.push(
        <span key="h" className="cf-ac-hint">
          {(f.emailHint ? "Sign in on claude.ai." : who) + " The sign-in comes back to " + (s.id === "halo" ? "the Halo (through this Mac)" : "this Mac") + " by itself: nothing to paste."}
        </span>,
      );
      acts.push(<span key="w" className="cf-ac-wait">Waiting for Google sign-in to finish…</span>);
      acts.push(
        <details key="p" className="cf-ac-paste" open={pasteOpen} onToggle={(e) => setPasteOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Stuck? Paste a code instead</summary>
          <div className="cf-ac-act">
            <A href={link.url} text="Open the page that shows a code" />
            <span className="cf-ac-hint">claude.ai shows an Authentication Code with a Copy Code button: paste it here. It goes only to the waiting sign-in; nothing keeps it.</span>
            {codeBox}
          </div>
        </details>,
      );
    } else {
      acts.push(google);
      if (alt) acts.push(<A key="alt" href={alt} text={swapMac ? "Signed out on claude.ai? Open it directly" : "Use a different account"} />);
      if (link.why) acts.push(<span key="why" className="cf-ac-hint why">{"Paste a code: " + link.why + "."}</span>);
      acts.push(
        <span key="h" className="cf-ac-hint">
          {(f.emailHint ? "Sign in on claude.ai." : who) + " claude.ai then shows an Authentication Code with a Copy Code button: copy it and paste it here. It goes only to the waiting sign-in; nothing keeps it."}
        </span>,
      );
      acts.push(<span key="c">{codeBox}</span>);
    }
  }
  if (s.state === "failed") acts.push(<Btn key="r" text="Retry" prim onClick={() => onStep("retry", "Retrying")} />);
  if (s.id === "halo" && (s.state === "waiting" || s.state === "failed")) acts.push(<Btn key="s" text="Skip (Halo drafts on the Mac)" onClick={() => onStep("skip", "Skipping the Halo")} />);
  return (
    <li className={"cf-ac-step " + s.state}>
      <span className="ic" aria-hidden="true">
        {ICON[s.state] || "○"}
      </span>
      <span className="lb">{s.label}</span>
      <span className="rs">{s.reason || (s.state === "pending" ? "next" : "")}</span>
      {acts.length ? <div className="cf-ac-act">{acts}</div> : null}
    </li>
  );
}
