/**
 * FA-19173: REVIEW EXISTING DESIGNS (card-studio.js rdOpen, rdRender, rdCard, rdSwap; studio-designs.mjs). Every design made with New
 * Design (and every applied concept), newest first, each as staging last had it (a live render of staging at its lastSha, read-only),
 * its pages as tabs, its dates and what changed while it was current. Swap = one staging change (designs/swap {key}) after its confirm;
 * a design never built in staging shows its proposal and Apply this design builds it (newdesign/apply {job}).
 */
import { useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, studioFileSrc, studioWrite, useStudio, when } from "../api";
import { StudioModal } from "../Modal";
import { rdLoad, rdSig, useDesigns, useFlash, usePutView, useView } from "./data";

const Spin = () => <i className="ap-spin" aria-hidden="true" />;
type Swap = { state: "saving" | "saved"; pct: number; label: string } | null;

export function ReviewDesignsDialog() {
  const st = useStudio();
  const { app, name } = st;
  const v = useView(app).data;
  const sig = v ? rdSig(v) : null;
  const d = useDesigns(app, sig);
  // opening it always reads the designs fresh (legacy rdOpen -> rdLoad(true))
  useEffect(() => {
    rdLoad(app, sig || "", true);
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps
  const [page, setPage] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [swap, setSwap] = useState<Swap>(null);
  const [err, setErr, clearErr] = useFlash();
  const putView = usePutView(app);
  const data = d.data;
  let body: React.ReactNode;
  if (!data) {
    body = d.err ? (
      <div className="sg-msg" role="alert">
        <b>Could not read the designs</b>
        <p>{d.err}</p>
        <button type="button" className="cp-btn sm" data-k="rd-retry" onClick={() => rdLoad(app, sig || "", true)}>
          Try again
        </button>
      </div>
    ) : (
      <>
        <p className="sg-dim" role="status">
          <Spin /> Reading the designs from staging…
        </p>
        <div className="sg-rdlist" aria-hidden="true">
          {[0, 1].map((i) => (
            <div key={i} className="sg-rdcard sg-skel">
              <i />
              <i />
              <div className="sg-rdfw" />
            </div>
          ))}
        </div>
      </>
    );
  } else {
    const busy = Boolean(swap && swap.state === "saving") || data.designs.some((x: any) => x.building);
    body = (
      <>
        <p className="sg-dim">Every design made with New Design (and every applied concept), newest first, each shown as staging last had it. {data.note}</p>
        {swap ? (
          <div className="sg-rdbar" role="status" data-k="rd-swap-bar">
            {swap.state === "saving" ? <Spin /> : null}
            <b>{swap.label}</b>
            <div className="sg-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={swap.pct} aria-label="The swap: a staging change" aria-valuetext={swap.pct + "%, " + swap.label}>
              <i style={{ width: swap.pct + "%" }} />
            </div>
          </div>
        ) : null}
        {data.designs.length ? (
          <div className="sg-rdlist">
            {data.designs.map((x: any) => (
              <Card
                key={x.key}
                x={x}
                busy={busy}
                page={page[x.key] || 0}
                setPage={(i) => setPage((p) => ({ ...p, [x.key]: i }))}
                confirming={confirm === x.key}
                onConfirm={(on) => setConfirm(on ? x.key : null)}
                onSwap={async () => {
                  setSwap({ state: "saving", pct: 40, label: "Restoring " + x.name + " and saving it to staging…" });
                  clearErr();
                  let r: any = null;
                  try {
                    r = await studioWrite<any>(app, "app", "designs/swap", { key: x.key });
                  } catch (e) {
                    setErr(errText(e));
                  }
                  setConfirm(null);
                  if (r && r.ok) {
                    setSwap({ state: "saved", pct: 100, label: "Saved to staging (" + String(r.sha).slice(0, 10) + "): " + x.name + " is staging's design; Undo is in its toast and Details › Work" });
                    st.say(x.name + " is staging's design again");
                    putView(r);
                    rdLoad(app, sig || "", true);
                  } else setSwap(null);
                }}
                onApply={async () => {
                  clearErr();
                  try {
                    const r = await studioWrite<any>(app, "app", "newdesign/apply", { job: x.job });
                    st.say(x.name + " is the desired UI; its staging build is queued");
                    putView(r);
                    rdLoad(app, sig || "", true);
                  } catch (e) {
                    setErr(errText(e));
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <div className="sg-msg" role="status">
            No designs yet: New Design makes one.
          </div>
        )}
      </>
    );
  }
  return (
    <StudioModal open onClose={st.close} title={"Existing designs · " + name} size="xl" testid="sg-rd">
      <div className="sg-rd" data-k="rd-dialog">
        {err ? (
          <p className="sg-err" role="alert" title="Tap to dismiss" onClick={clearErr}>
            {err}
          </p>
        ) : null}
        {body}
      </div>
    </StudioModal>
  );
}

function Card({ x, busy, page, setPage, confirming, onConfirm, onSwap, onApply }: { x: any; busy: boolean; page: number; setPage: (i: number) => void; confirming: boolean; onConfirm: (on: boolean) => void; onSwap: () => Promise<void>; onApply: () => Promise<void> }) {
  const st = useStudio();
  const { app, canWrite } = st;
  const [acting, setActing] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) setTimeout(() => yesRef.current?.focus(), 0);
  }, [confirming]);
  const live = !x.never && x.frame;
  const pages: string[] = live ? (x.pages && x.pages.length ? x.pages : ["index.html"]) : (x.screens || []).map((s: any) => s.mockup);
  const labelOf = (p: string, i: number) =>
    live
      ? p === "index.html"
        ? "Home"
        : p
            .replace(/\.html?$/i, "")
            .replace(/[-_/]+/g, " ")
            .replace(/^./, (c) => c.toUpperCase())
      : x.screens[i].name;
  const sel = Math.min(page, Math.max(0, pages.length - 1)),
    id = "rd-" + String(x.key).replace(/[^a-z0-9-]/gi, "-");
  const src = !pages.length ? null : live ? x.frame + pages[sel].split("/").map(encodeURIComponent).join("/") : studioFileSrc(app, "app", "file/" + pages[sel]);
  const dates = [x.generatedAt ? "Generated " + when(x.generatedAt) : null, x.appliedAt ? "applied " + when(x.appliedAt) : null, x.lastSha && !x.current ? "last in staging " + when(x.lastAt) + " (" + x.lastSha.slice(0, 10) + ")" : x.current && x.lastSha ? "live now (" + x.lastSha.slice(0, 10) + ")" : null].filter(Boolean).join(" · ");
  const changes: any[] = Array.isArray(x.changes) ? x.changes : [];
  let act0: React.ReactNode = null;
  if (confirming) {
    act0 = (
      <div className="sg-rdconf" role="group" aria-label="Confirm the swap">
        <p>Staging becomes {x.name} as it was on {when(x.lastAt)}; your current design stays in this list. Answers and decisions made after it stay in the record; later decisions are not replayed.</p>
        <div className="sg-row">
          <button ref={yesRef} type="button" className="cp-btn sg-pri" data-k="rd-swap-confirm" disabled={busy || !canWrite} title={canWrite ? undefined : READ_ONLY} onClick={() => void onSwap()}>
            Swap now
          </button>
          <button type="button" className="cp-btn ghost" data-k="rd-swap-cancel" onClick={() => onConfirm(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else if (x.never && !x.building) {
    act0 = (
      <button
        type="button"
        className="cp-btn sm sg-wide"
        data-k={"rd-apply-" + x.key}
        disabled={busy || !x.job || !canWrite || acting}
        title={canWrite ? "Never built in staging: Apply builds it there (a staging change)" : READ_ONLY}
        onClick={async () => {
          setActing(true);
          await onApply();
          setActing(false);
        }}
      >
        {acting ? <Spin /> : null}Apply this design
      </button>
    );
  } else if (!x.current) {
    act0 = (
      <button type="button" className="cp-btn sm sg-wide" data-k={"rd-swap-" + x.key} disabled={busy || !canWrite} title={!canWrite ? READ_ONLY : busy ? "Wait for the staging change in progress" : "Make staging this design again, as it last was"} onClick={() => onConfirm(true)}>
        Swap to this design
      </button>
    );
  }
  return (
    <section className={"sg-rdcard" + (x.current ? " cur" : "")} aria-labelledby={id} data-k="rd-card">
      <div className="sg-rdhd">
        <h4 id={id}>{x.name}</h4>
        {x.current ? <span className="ap-chip t-g">Current</span> : null}
        {x.building ? (
          <span className="ap-chip">
            <Spin />
            Building in staging
          </span>
        ) : null}
        {x.never && !x.building ? <span className="ap-chip t-a">Never built in staging</span> : null}
        {x.kind === "enhancedesign" ? <span className="ap-chip t-d">Enhance</span> : x.kind === "concept" ? <span className="ap-chip t-d">Concept</span> : null}
      </div>
      {dates ? <p className="sg-dim">{dates}</p> : null}
      {pages.length > 1 ? (
        <div className="sg-seg" role="group" aria-label={"Screens of " + x.name}>
          {pages.map((p, i) => (
            <button key={i} type="button" aria-pressed={i === sel} data-k={"rd-page-" + (i + 1)} onClick={() => setPage(i)}>
              {labelOf(p, i)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="sg-rdfw">
        {src ? (
          <iframe
            key={src}
            src={src}
            loading="lazy"
            title={x.name + (live ? ", as staging last had it" : ", the proposal")}
            sandbox={live ? "allow-scripts allow-same-origin allow-forms" : "allow-scripts"}
            referrerPolicy={live ? "same-origin" : "no-referrer"}
            data-k="rd-frame"
          />
        ) : (
          <div className="sg-msg">No screens to show for this design.</div>
        )}
      </div>
      {changes.length ? (
        <details className="sg-rdchg">
          <summary>What changed in staging while it was current ({changes.length})</summary>
          <ul>
            {changes.map((c, i) => (
              <li key={i}>
                <code>{c.sha}</code> {c.subject}
                <span className="sg-dim"> · {when(c.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : !x.never ? (
        <p className="sg-dim">Nothing else changed in staging while it was current.</p>
      ) : null}
      {x.never && !x.building ? <p className="sg-dim">Never built in staging: this is its proposal. Applying it builds it as a staging change.</p> : null}
      {act0}
    </section>
  );
}
