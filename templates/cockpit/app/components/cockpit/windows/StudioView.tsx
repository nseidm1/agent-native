import { useActionMutation } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../CardDialog";
import { Thumb, thumbSrc } from "./Thumb";
import "./studio-view.css";

type Tone = "g" | "a" | "r" | "d" | "s" | "";
export type StudioData = {
  app: string;
  name: string;
  chip: string;
  platform: string;
  identity: {
    staging: { short: string; ago: string } | null;
    stagingText: string;
    production: { short: string; url: string | null; ago: string } | null;
    productionText: string;
    text: string;
  };
  inbox: { need: number; proposals: number; text: string };
  tiles: { k: string; label: string; v: string; s: string; tone: string; busy: boolean; need: boolean }[];
  staging: { running: boolean; exists: boolean; url: string | null; subject: string; ahead: number; building: boolean; error: string | null };
  thumb: string | null;
  preview: string;
  requirements: { text: string; detail: string; note: string; items: { id: string; text: string; status: string; tone: Tone; why: string }[] };
  changes: { id: string; what: string; state: string; at: string; tone: Tone }[];
  activity: { at: string; text: string }[];
  autopilot: { state: string; text: string };
  errors: string[];
};

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
const STATUS_WORD: Record<string, string> = { verified: "verified", failing: "failing", blocked: "could not check", pending: "not checked yet", unwritten: "no check yet", context: "context" };

/**
 * FA-19157: an app's studio, rendered by agent-native from the cockpit client (the Apps window with args.app). The legacy
 * studio's face: the identity line (staging and production, each with its age), the inbox badge, the lifecycle bar (Build,
 * Quality, Launch ready, Deploy, Live; the tile that needs the console is marked, and each opens its detail), the staging
 * app's picture with Open staging and Start, the newest staging changes and the studio's activity. The studio's deeper tools (the Agent
 * chat, the action menus, the live staging frame: FA-19172 to FA-19175) still open in the legacy studio from "Agent, menus, live frame",
 * so moving Open studio here took no capability away; that button goes when they land (FA-19136).
 */
export function StudioView({ s, canWrite, onDone, onBack }: { s: StudioData; canWrite: boolean; onDone: () => void; onBack: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const start = useActionMutation<{ ok: boolean }, { app: string }>("cockpit-app-staging", {
    timeoutMs: 160_000,
    onSuccess: () => {
      setMsg({ ok: true, text: s.name + " staging is starting." });
      onDone();
    },
    onError: (e) => setMsg({ ok: false, text: s.name + " staging did not start: " + errText(e) }),
  });
  // VIEWING THE STUDIO IS STAGING (the legacy studio's rule, env-api.mjs: this Mac or a device past the write gate brings a stopped web app's
  // staging up, cutting its copy first if there is none, when it opens the studio): the same start (apps.staging -> M.staging.start), once per open
  const viewed = useRef<string | null>(null);
  useEffect(() => {
    if (viewed.current === s.app || !canWrite || s.platform !== "web" || s.staging.running || s.staging.building) return;
    viewed.current = s.app;
    start.mutate({ app: s.app });
  }, [s.app, canWrite, s.platform, s.staging.running, s.staging.building]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = s.identity;
  const tile = s.tiles.find((t) => t.k === open) || null;
  return (
    <div className="st-part" data-testid="studio" data-app={s.app}>
      <div className="st-top">
        <button type="button" className="cp-btn sm ghost st-back" onClick={onBack}>
          ← All apps
        </button>
        <span className="st-id" data-testid="studio-identity">
          {id.staging ? (
            <span>
              Staging <code>{id.staging.short}</code>
              {id.staging.ago ? " · " + id.staging.ago : ""}
            </span>
          ) : (
            <span>{id.stagingText}</span>
          )}
          {id.production ? (
            <span>
              Production{" "}
              {id.production.url ? (
                <a href={id.production.url} target="_blank" rel="noopener noreferrer">
                  <code>{id.production.short}</code>
                  <span className="sr-only"> (opens the production site)</span>
                </a>
              ) : (
                <code>{id.production.short}</code>
              )}
              {id.production.ago ? " · " + id.production.ago : ""}
            </span>
          ) : (
            <span>{id.productionText}</span>
          )}
        </span>
        <span className="st-sp" />
        <span className={"st-inbox" + (s.inbox.need ? " need" : "")} data-testid="studio-inbox" title={s.inbox.need ? s.inbox.need + " waiting on you" : "Nothing waits on you"}>
          <span aria-hidden="true">✉</span> {s.inbox.text}
          {!s.inbox.need && s.inbox.proposals ? <span className="ap-chip">{s.inbox.proposals} proposals</span> : null}
        </span>
        <button
          type="button"
          className="cp-btn sm ghost"
          title="The Agent chat, the Build / Design / Improve / Verify / Launch menus and the live staging frame are not rendered here yet (FA-19172 to FA-19175): they open in the legacy studio"
          onClick={() => window.dispatchEvent(new CustomEvent("cockpit-open-legacy", { detail: { slug: "apps=" + s.app, label: s.name + " studio tools" } }))}
        >
          Agent, menus, live frame
        </button>
        {s.staging.url ? (
          <a className="cp-btn sm" href={s.staging.url} target="_blank" rel="noopener noreferrer">
            Open staging ↗
          </a>
        ) : null}
      </div>

      <div className="st-tiles" role="group" aria-label={s.name + ": build, quality, launch, deploy, live"} data-testid="studio-tiles">
        {s.tiles.map((t) => (
          <button
            key={t.k}
            type="button"
            className={"st-tile" + (t.need ? " need" : "")}
            data-k={t.k}
            aria-expanded={open === t.k}
            aria-controls="st-detail"
            aria-label={t.label + ": " + t.v + (t.s ? ", " + t.s : "") + (t.need ? ". Needs you" : "") + ". Open the details"}
            onClick={() => setOpen(open === t.k ? null : t.k)}
          >
            <span className="k">
              {t.busy ? <i className="ap-spin" aria-hidden="true" /> : <i className={"st-dot t-" + (t.tone || "n")} aria-hidden="true" />}
              {t.label}
              {t.need ? <span className="ap-chip t-a">needs you</span> : null}
            </span>
            <span className="v">{t.v}</span>
            <span className="s">{t.s || " "}</span>
          </button>
        ))}
      </div>
      {tile ? (
        <section id="st-detail" className="st-detail" aria-label={tile.label}>
          <TileDetail k={tile.k} s={s} />
        </section>
      ) : null}

      <div className="st-main">
        <section className="st-stage" aria-label={s.name + ", the staging app"}>
          <h4 className="st-h">{s.name}, the staging app</h4>
          <div className={"st-pic" + (s.thumb ? " pic" : "")} data-st={s.preview}>
            {s.thumb ? <Thumb src={thumbSrc(s.thumb)} alt={s.name + " staging homepage"} /> : null}
            {!s.thumb || s.preview !== "live" ? (
              <div className="st-pic-o">
                <b>{s.staging.running ? (s.staging.building ? "Building staging…" : "Staging is running") : s.staging.exists ? "Staging not running" : "No staging copy yet"}</b>
                {s.staging.error ? <span className="why">{s.staging.error}</span> : null}
              </div>
            ) : null}
          </div>
          <div className="st-row">
            <span className="st-sub">
              {s.staging.subject ? "Newest: " + s.staging.subject : ""}
              {s.staging.ahead ? " · " + s.staging.ahead + " change" + (s.staging.ahead === 1 ? "" : "s") + " ahead of production" : ""}
            </span>
            {s.staging.exists && !s.staging.running ? (
              <button
                type="button"
                className="cp-btn sm"
                disabled={!canWrite || start.isPending}
                title={canWrite ? undefined : READ_ONLY}
                onClick={() => {
                  setMsg(null);
                  start.mutate({ app: s.app });
                }}
              >
                {start.isPending ? "Starting…" : "Start staging"}
              </button>
            ) : null}
          </div>
          {msg ? (
            <p className={"cp-act-msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </p>
          ) : null}
        </section>
        <section className="st-side" aria-label="Staging changes and activity">
          <h4 className="st-h">Staging changes</h4>
          {s.changes.length ? (
            <ul className="st-list" data-testid="studio-changes">
              {s.changes.map((c) => (
                <li key={c.id}>
                  <span className={"ap-chip t-" + (c.tone || "n")}>{c.state || "change"}</span> <b>{c.what}</b>
                  <span className="st-when">{when(c.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ap-none">No staging changes yet.</p>
          )}
          <details className="st-act">
            <summary>Activity ({s.activity.length})</summary>
            <ul className="st-list">
              {s.activity.map((a, i) => (
                <li key={i}>
                  <span className="st-when">{when(a.at)}</span> {a.text}
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
      {s.errors.length ? (
        <p className="cp-act-msg err" role="alert">
          Some studio reads did not answer: {s.errors.join("; ").slice(0, 300)}
        </p>
      ) : null}
    </div>
  );
}

function TileDetail({ k, s }: { k: string; s: StudioData }) {
  const t = s.tiles.find((x) => x.k === k)!;
  if (k === "build") {
    const r = s.requirements;
    return (
      <>
        <p className="st-dl">
          <b>{r.text}</b>
          {r.detail ? " · " + r.detail : ""}
          {s.autopilot.text ? <span className="st-sub"> · {s.autopilot.text}</span> : null}
        </p>
        {r.note ? <p className="st-sub">{r.note}</p> : null}
        {r.items.length ? (
          <ul className="st-list st-reqs" data-testid="studio-requirements">
            {r.items.map((x) => (
              <li key={x.id} title={x.why || undefined}>
                <span className={"ap-chip t-" + (x.tone || "n")}>{STATUS_WORD[x.status] || x.status}</span> {x.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ap-none">No requirements yet.</p>
        )}
      </>
    );
  }
  return (
    <p className="st-dl">
      <b>{t.v}</b>
      {t.s ? " · " + t.s : ""}
    </p>
  );
}
