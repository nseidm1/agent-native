import { useActionMutation } from "@agent-native/core/client/hooks";
import { useState } from "react";

import type { PhonePartData } from "../../../../server/cockpit/windows/phone";
import { READ_ONLY } from "../CardDialog";
import type { WindowPartProps } from "./index";
import "./phone-part.css";

/**
 * FA-19128: the Phone app window's device pick, install steps and Install button, ported from the legacy phoneDlg: with more than
 * one ready phone a radio picks the one to install on; while a job runs its build / install / launch steps show with their lines;
 * Install (Reinstall, Retry) runs android.install on the picked device behind a confirm. The cockpit runs the job: closing the
 * window changes nothing, and a second press attaches to the running job.
 */
export function PhonePart({ d, canWrite, onDone }: WindowPartProps) {
  const p = (d.part || {}) as unknown as PhonePartData;
  const [chosen, setChosen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const install = useActionMutation<{ ok: boolean; answer?: any }, { serial?: string }>("cockpit-android-install", { timeoutMs: 160_000 });
  const ready = p.ready || [];
  const pick = chosen && ready.some((x) => x.serial === chosen) ? chosen : p.pick;
  const label = (s: string | null) => (ready.find((x) => x.serial === s) || { label: s || "" }).label;
  async function go() {
    if (!canWrite || !pick || install.isPending) return;
    setAsking(false);
    setMsg({ t: "Starting…" });
    try {
      const r = await install.mutateAsync({ serial: pick });
      const a = (r && r.answer) || {};
      setMsg({ t: a.attached ? "Already installing: showing that run." : "Building, then installing on " + label(pick) + ". You can close this window." });
    } catch (e) {
      setMsg({ t: "Not started: " + (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, ""), bad: true });
    } finally {
      onDone();
    }
  }
  const showPick = ready.length > 1 && p.state !== "installing";
  if (!showPick && !p.steps && !p.go && !msg) return null;
  return (
    <section className={(showPick || p.steps ? "cp-sec " : "") + "cf-ph"} aria-label="Install the phone app">
      {showPick ? (
        <div className="cf-ph-devs" role="radiogroup" aria-label="Device">
          {ready.map((x) => (
            <label key={x.serial} className={x.serial === pick ? "on" : undefined}>
              <input type="radio" name="cf-ph-dev" value={x.serial} checked={x.serial === pick} onChange={() => setChosen(x.serial)} />
              {x.label}
            </label>
          ))}
        </div>
      ) : null}
      {p.steps ? (
        <ol className="cf-ph-steps" aria-label="Install steps">
          {p.steps.map((s) => (
            <li key={s.id} className={s.cls || undefined} title={s.line}>
              <span className="cf-ph-sn">{s.id}</span>
              {s.line ? <span className="cf-ph-sl">{s.line}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="cf-ph-row">
        <span className={"cf-ph-stat" + (msg && msg.bad ? " bad" : "")} role="status" aria-live="polite">
          {msg ? msg.t : ""}
        </span>
        {p.go ? (
          asking ? (
            <span className="cp-confirm" role="group" aria-label="Confirm">
              <span className="cp-confirm-q">{"Build the phone app and install it on " + label(pick) + "?"}</span>
              <button type="button" className="cp-btn sm" onClick={go} disabled={!canWrite || install.isPending}>
                {"Yes, " + p.go.toLowerCase()}
              </button>
              <button type="button" className="cp-btn sm ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="cp-btn sm cf-ph-go"
              disabled={!canWrite || !pick || install.isPending}
              title={!canWrite ? READ_ONLY : !pick ? "Pick a device first" : undefined}
              onClick={() => setAsking(true)}
            >
              {install.isPending ? "Starting…" : p.go}
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
