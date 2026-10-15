import { useActionMutation } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

import { WRITE_ACTIONS } from "@shared/cockpit-detail";
import {
  gatesOn,
  STRICT_ORDER,
  STRICT_RISK,
  STRICT_RULES,
  strictChip,
  strictLevel,
  strictSteps,
  wantFlip,
  wantLevel,
  type StrictGate,
  type StrictMap,
} from "@shared/cockpit-strict";

import { READ_ONLY } from "../CardDialog";
import type { WindowPartProps } from "./index";
import "./overview.css";

type Step = { gate: StrictGate; on: boolean };

/**
 * FA-19130: the Production box's strictness (the legacy PRODUCTION STRICTNESS script): the 0-7 stepper that turns the rules
 * on cumulatively, safest first, and one switch per rule. A move sends ONE cockpit-strict write per gate that changes, in
 * sequence (ons safest first, offs least-safe first); turning the real-money release-gate rule off asks first and sends
 * confirm. A written state holds for 3 s so a reading taken before the write never flickers the switches back.
 */
export function OverviewPart({ d, canWrite, onDone }: WindowPartProps) {
  const read = ((d as unknown as { strict?: StrictMap | null }).strict ?? null) as StrictMap | null;
  const [held, setHeld] = useState<StrictMap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ steps: Step[]; label: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const write = useActionMutation<{ ok: boolean; answer?: any }, Record<string, unknown>>(WRITE_ACTIONS.strict, { timeoutMs: 60_000 });
  const cur = held ?? read;
  if (!cur) return null;

  const lv = strictLevel(cur),
    chip = strictChip(cur),
    off = !canWrite || !!busy;

  async function send(steps: Step[], label: string) {
    if (!cur) return;
    setBusy(label);
    setMsg(null);
    let now: StrictMap = { ...cur },
      err: string | null = null;
    for (const s of steps) {
      try {
        const r = await write.mutateAsync({ gate: s.gate, on: s.on, ...(s.gate === "releaseGate" && !s.on ? { confirm: true } : {}) });
        const back = r && r.answer && typeof r.answer === "object" ? (r.answer as { strict?: StrictMap }).strict : null;
        now = back && typeof back === "object" ? { ...back } : { ...now, [s.gate]: s.on };
        setHeld(now);
      } catch (e) {
        err = s.gate + ": " + (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
        break;
      }
    }
    const nl = strictLevel(now);
    setMsg(err ? { ok: false, text: "Not saved, " + err } : { ok: true, text: "Saved: strictness " + (nl ?? STRICT_ORDER.filter((g) => gatesOn(now, g)).length + " of 7, custom") + (nl !== null ? " of 7" : "") + "." });
    setBusy(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeld(null), 3000);
    onDone();
  }
  function go(want: StrictMap, label: string) {
    if (off || !cur) return;
    const steps = strictSteps(cur, want);
    if (!steps.length) return;
    if (steps.some((s) => s.gate === "releaseGate" && !s.on)) setAsking({ steps, label });
    else void send(steps, label);
  }

  return (
    <section className="cp-sec ov-strict" data-testid="ov-strict" aria-label="Production strictness">
      <h3>
        <span className="cp-sec-t">Production strictness</span>
        <span className={"ov-chip " + chip.tone} data-testid="ov-strict-chip">
          {chip.text}
        </span>
      </h3>
      <div className="ov-step" role="group" aria-label="Strictness level, 0 lightest to 7 strictest">
        {Array.from({ length: 8 }, (_, n) => (
          <button
            key={n}
            type="button"
            data-lv={n}
            aria-pressed={lv === n}
            disabled={off}
            title={!canWrite ? READ_ONLY : n === 0 ? "Lightest: every rule off" : n === 7 ? "Strictest: every rule on" : "Rules on: " + STRICT_ORDER.slice(0, n).flat().join(", ")}
            onClick={() => go(wantLevel(cur, n), "Setting strictness " + n + " of 7")}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="ov-ends">
        <span>Lightest</span>
        {lv === null ? <span className="ov-custom">Custom (set by hand)</span> : null}
        <span>Strictest</span>
      </div>
      <p className="ov-note">Each step turns on the next rule, safest first; the lane reads the switches on its next pass.</p>
      {!canWrite ? <p className="cp-ro">The switches are {READ_ONLY}: open the cockpit on this Mac to change them.</p> : null}
      {asking ? (
        <div className="cp-confirm ov-confirm" role="group" aria-label="Confirm">
          <span className="cp-confirm-q">{STRICT_RISK}</span>
          <button
            type="button"
            className="cp-btn sm danger"
            onClick={() => {
              const a = asking;
              setAsking(null);
              void send(a.steps, a.label);
            }}
          >
            Yes, turn it off
          </button>
          <button type="button" className="cp-btn sm ghost" onClick={() => setAsking(null)}>
            Keep it on
          </button>
        </div>
      ) : null}
      {busy || msg ? (
        <p className={"ov-msg" + (msg && !msg.ok ? " bad" : "")} role="status">
          {busy ? busy + "…" : msg ? msg.text : ""}
        </p>
      ) : null}
      <ul className="ov-rules">
        {STRICT_RULES.map((r) => {
          const on = gatesOn(cur, r.gates);
          return (
            <li key={r.gates.join(" ")} className={on ? "" : "off"} data-gates={r.gates.join(" ")}>
              <span className="ov-rt">{r.text}</span>
              <button
                type="button"
                role="switch"
                className="ov-tog"
                aria-checked={on}
                aria-label={r.text}
                disabled={off}
                title={canWrite ? (on ? "On: tap to turn off" : "Off: tap to turn on") : READ_ONLY}
                onClick={() => go(wantFlip(cur, r.gates), (on ? "Turning off: " : "Turning on: ") + r.text)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
