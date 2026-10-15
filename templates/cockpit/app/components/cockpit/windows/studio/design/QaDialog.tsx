/**
 * FA-19173: QA AGENTS (card-studio.js qaDialog, qaGateApply, mkShow, mkBack): a dialog holding the QA panel (QaPanel.tsx) and, from its
 * API mocks button, the mocks view (Mocks.tsx) in the same dialog; Back returns. QA NEEDS READY MOCKS: while the gate is up (an app
 * calling external APIs whose mocks are not ready) Run QA is off with the gate's reason, a note above the panel says so, and the dialog
 * opens straight on the mocks view with Generate focused (Esc then closes). Opened as API mocks ({mocks: true}) it is the same.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useStudio } from "../api";
import { StudioModal } from "../Modal";
import { mkgLoad, useMocksGate } from "./data";
import { MocksView } from "./Mocks";
import { QaPanel } from "./QaPanel";

export function QaDialog({ mocks }: { mocks?: boolean }) {
  const st = useStudio();
  const { app, name } = st;
  const { gate } = useMocksGate(app, name, true);
  // the gate as of now (legacy mkgLoad(true) on open)
  useEffect(() => mkgLoad(app, true), [app]);
  // gated when it opened (the gate as the studio last read it): straight to the mocks, Generate / Update focused, Esc closes
  // (legacy QA.mkDirect); a gate read after it opened only turns Run QA off and shows its note, as legacy's qaGateApply does
  const [mk, setMk] = useState<boolean>(() => Boolean(mocks) || Boolean(gate));
  const [direct, setDirect] = useState<boolean>(() => Boolean(mocks) || Boolean(gate));
  const [focusGen, setFocusGen] = useState<boolean>(() => Boolean(mocks) || Boolean(gate));
  const [popOpen, setPopOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean; n: number } | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const mkBtnRef = useRef<HTMLButtonElement>(null);
  const say = useCallback(
    (text: string, ok = true) => {
      setMsg((m) => ({ text, ok, n: (m ? m.n : 0) + 1 }));
      st.say(text, ok);
    },
    [st],
  );
  useEffect(() => {
    if (!msg || !msg.ok) return;
    const n = msg.n;
    const t = setTimeout(() => setMsg((x) => (x && x.n === n ? null : x)), 8000);
    return () => clearTimeout(t);
  }, [msg]);
  const show = (on: boolean) => {
    setMk(on);
    if (on) setTimeout(() => backRef.current?.focus(), 0);
  };
  const back = useCallback(() => {
    setDirect(false);
    setMk(false);
    setTimeout(() => mkBtnRef.current?.focus(), 0);
  }, []);
  // Esc in the mocks view is Back (opened straight on the mocks: Esc closes); a popup over it takes its own Esc
  useEffect(() => {
    if (!mk || direct || popOpen) return;
    const f = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      back();
    };
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, [mk, direct, popOpen, back]);

  const extra = mk ? (
    <button ref={backRef} type="button" className="cp-btn sm" data-k="qa-mocks-back" aria-label="Back to the QA agents" onClick={back}>
      <span aria-hidden="true">‹ </span>Back
    </button>
  ) : (
    <button
      ref={mkBtnRef}
      type="button"
      className="cp-btn sm"
      data-k="qa-mocks"
      title="Mocks of the app's external APIs (from each vendor's own contract) so QA runs can pass or fail them"
      onClick={() => {
            setDirect(false);
        show(true);
      }}
    >
      API mocks
    </button>
  );
  return (
    <StudioModal
      open
      onClose={st.close}
      size="lg"
      testid="sg-qa"
      title={(mk ? "API mocks · " : "QA agents · ") + name}
      extra={extra}
      footer={
        msg ? (
          <p className={"sg-say " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"} data-k="qa-say">
            {msg.text}
          </p>
        ) : undefined
      }
    >
      <div className="sg-qad" data-k="qa-dialog">
        {gate && !mk ? (
          <div className="sg-gate" role="note" data-k="qa-gate">
            <span>
              <b>{gate.badge}: </b>Run QA is off. {gate.why}.
            </span>
            <button
              type="button"
              className="cp-btn sm"
              data-k="qa-gate-mocks"
              onClick={() => {
                setFocusGen(true);
                show(true);
              }}
            >
              {gate.state === "generating" ? "Show the mocks" : gate.state === "stale" ? "Update mocks…" : "Generate mocks…"}
            </button>
          </div>
        ) : null}
        <div hidden={mk} data-k="qa-dialog-body">
          <QaPanel gate={gate} say={say} />
        </div>
        {mk ? <MocksView focusGen={focusGen} onFocused={() => setFocusGen(false)} say={say} back={backRef} setPopOpen={setPopOpen} /> : null}
      </div>
    </StudioModal>
  );
}
