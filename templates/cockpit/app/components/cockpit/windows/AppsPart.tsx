import { useActionMutation } from "@agent-native/core/client/hooks";
import { type FormEvent, useState } from "react";

import type { Tone } from "@shared/cockpit";

import { READ_ONLY } from "../CardDialog";
import type { WindowPartProps } from "./index";
import "./apps-part.css";

type Tile = {
  id: string;
  name: string;
  desc: string;
  preview: string;
  previewTitle: string;
  previewSub: string;
  canStart: boolean;
  staging: string;
  stagingOn: boolean;
  chips: { t: string; tone?: Tone }[];
  last: string;
  requests: { id: string; kind: string; title: string; line: string; tone?: Tone; fa?: string }[];
};
type PartData = { intro?: string; tiles?: Tile[]; hint?: string; requestHint?: string };
type Msg = { ok: boolean; text: string } | null;

/** The cockpit's own words for a refused write, without the framework's "Action <name> failed:" prefix. */
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
const slugN = (s: string) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/** An app's studio is still the legacy page's (#apps=<id>): Cockpit opens it in its LegacyWindow. */
export function openStudio(id: string, name: string) {
  window.dispatchEvent(new CustomEvent("cockpit-open-legacy", { detail: { slug: "apps=" + id, label: name + " studio" } }));
}

/**
 * FA-19129: the Apps picker's own part (the legacy appsDlg): a tile per app with its staging state in words, its open cards,
 * its release line and its requests; Open studio (the legacy studio, for now), Start staging for a stopped copy, a Request
 * form per app (apps.request) and the New app form (apps.new). Every write is the cockpit's, through the region's actions.
 */
export function AppsPart({ d, canWrite, onDone }: WindowPartProps) {
  const p = (d.part || {}) as PartData;
  const tiles = p.tiles || [];
  const [reqFor, setReqFor] = useState<string | null>(null);
  return (
    <div className="ap-part" data-testid="apps-part">
      {p.intro ? <p className="cp-lead ap-intro">{p.intro}</p> : null}
      <NewApp hint={p.hint || ""} canWrite={canWrite} onDone={onDone} />
      {tiles.length ? (
        <div className="ap-grid">
          {tiles.map((t) => (
            <AppTile key={t.id} t={t} canWrite={canWrite} onDone={onDone} asking={reqFor === t.id} setAsking={(v) => setReqFor(v ? t.id : null)} requestHint={p.requestHint || ""} />
          ))}
        </div>
      ) : (
        <p className="cp-empty">No apps yet: New app starts one.</p>
      )}
    </div>
  );
}

function AppTile({ t, canWrite, onDone, asking, setAsking, requestHint }: { t: Tile; canWrite: boolean; onDone: () => void; asking: boolean; setAsking: (v: boolean) => void; requestHint: string }) {
  const [msg, setMsg] = useState<Msg>(null);
  const start = useActionMutation<{ ok: boolean; answer?: any }, { app: string }>("cockpit-app-staging", {
    timeoutMs: 160_000,
    onSuccess: () => {
      setMsg({ ok: true, text: t.name + " staging is starting." });
      onDone();
    },
    onError: (e) => setMsg({ ok: false, text: t.name + " staging did not start: " + errText(e) }),
  });
  const notFiled = t.requests.filter((r) => r.tone === "r").length;
  return (
    <article className={"ap-tile" + (asking ? " wide" : "")} data-app={t.id} aria-label={t.name}>
      <div className="ap-pv" data-st={t.preview}>
        <span className="ap-pv-l">staging</span>
        {t.previewTitle ? <b className="ap-pv-t">{t.previewTitle}</b> : null}
        {t.previewSub ? <span className={"ap-pv-s" + (t.preview === "fail" || t.preview === "err" ? " why" : "")}>{t.previewSub}</span> : null}
        {t.canStart ? (
          <button
            type="button"
            className="cp-btn sm"
            disabled={!canWrite || start.isPending}
            title={canWrite ? undefined : READ_ONLY}
            onClick={() => {
              setMsg(null);
              start.mutate({ app: t.id });
            }}
          >
            {start.isPending ? "Starting…" : "Start"}
          </button>
        ) : null}
      </div>
      <div className="ap-body">
        <button type="button" className="ap-name" onClick={() => openStudio(t.id, t.name)} aria-label={"Open the " + t.name + " studio"}>
          <b className="ap-n">{t.name}</b>
          <span className="ap-d">{t.desc}</span>
        </button>
        {t.staging ? (
          <div className="ap-st">
            <span className={"ap-dot" + (t.stagingOn ? " on" : "")} aria-hidden="true" />
            <span>{t.staging}</span>
          </div>
        ) : null}
        <div className="ap-chips">
          {t.chips.map((c) => (
            <span key={c.t} className={"ap-chip" + (c.tone ? " t-" + c.tone : "")}>
              {c.t}
            </span>
          ))}
        </div>
        <p className="ap-last" title={t.last}>
          {t.last}
        </p>
        {t.requests.length ? (
          <details className="ap-reqs">
            <summary>
              Requests <span className="ap-reqn">{t.requests.length}</span>
              {notFiled ? <span className="ap-chip t-r">{notFiled} not filed</span> : null}
            </summary>
            <ul>
              {t.requests.map((r) => (
                <li key={r.id} className={r.tone ? "t-" + r.tone : undefined}>
                  <span className="ap-chip">{r.kind}</span> <b>{r.title}</b>
                  <span className="ap-req-l">{r.line}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="ap-none">No requests yet.</p>
        )}
        <div className="ap-acts">
          <button type="button" className="cp-btn sm" onClick={() => openStudio(t.id, t.name)}>
            Open studio
          </button>
          <button type="button" className="cp-btn sm ghost" aria-expanded={asking} onClick={() => setAsking(!asking)}>
            Request work
          </button>
        </div>
        {msg ? (
          <p className={"cp-act-msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        ) : null}
        {asking ? <RequestForm app={t.id} name={t.name} hint={requestHint} canWrite={canWrite} onDone={onDone} onClose={() => setAsking(false)} /> : null}
      </div>
    </article>
  );
}

const KINDS = [
  { k: "feature", l: "Feature" },
  { k: "fix", l: "Fix" },
  { k: "polish", l: "Polish" },
] as const;
type Kind = (typeof KINDS)[number]["k"];

function RequestForm({ app, name, hint, canWrite, onDone, onClose }: { app: string; name: string; hint: string; canWrite: boolean; onDone: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("feature");
  const [title, setTitle] = useState("");
  const [what, setWhat] = useState("");
  const [done, setDone] = useState("");
  const [where, setWhere] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const run = useActionMutation<{ ok: boolean; answer?: any }, Record<string, unknown>>("cockpit-app-request", {
    timeoutMs: 160_000,
    onSuccess: (r) => {
      const a = (r && r.answer) || {};
      const reason = String(a.reason || "").replace(/^[^:]*: /, "");
      setMsg({
        ok: true,
        text: a.route === "filing" ? "Sent: your card is being filed" + (reason ? " (" + reason + ")" : "") + ". Its status shows under Requests." : "Saved to the production backlog" + (reason ? " (" + reason + ")" : "") + ".",
      });
      setTitle("");
      setWhat("");
      setDone("");
      setWhere("");
      onDone();
    },
    onError: (e) => setMsg({ ok: false, text: "Not sent: " + errText(e) + ". Your text is kept." }),
  });
  const ready = title.trim().length >= 4 && what.trim().length >= 10;
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite || run.isPending || !ready) return;
    setMsg(null);
    run.mutate({ app, kind, title: title.trim(), what: what.trim(), ...(done.trim() ? { done: done.trim() } : {}), ...(where.trim() ? { where: where.trim() } : {}) });
  };
  const id = "ap-rq-" + app;
  return (
    <form className="ap-form" onSubmit={send} aria-label={"Request work on " + name}>
      <h4>Request work on {name}</h4>
      <div className="cp-seg" role="group" aria-label="Kind of work">
        {KINDS.map((k) => (
          <button key={k.k} type="button" aria-pressed={kind === k.k} onClick={() => setKind(k.k)}>
            {k.l}
          </button>
        ))}
      </div>
      <label className="cp-lab" htmlFor={id + "-t"}>
        Title
      </label>
      <input id={id + "-t"} className="cp-in" maxLength={56} required placeholder="Short, like a card title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="cp-lab" htmlFor={id + "-w"}>
        What you want
      </label>
      <textarea id={id + "-w"} className="cp-in area" maxLength={2000} required placeholder="What should change, as the person using the app sees it" value={what} onChange={(e) => setWhat(e.target.value)} />
      <div className="ap-two">
        <label className="cp-lab">
          Done when (optional)
          <input className="cp-in" maxLength={400} placeholder="What you will see when it works" value={done} onChange={(e) => setDone(e.target.value)} />
        </label>
        <label className="cp-lab">
          Where (optional)
          <input className="cp-in" maxLength={200} placeholder="file and function, e.g. docs/app.js render" value={where} onChange={(e) => setWhere(e.target.value)} />
        </label>
      </div>
      <p className="ap-hint">{hint}</p>
      <div className="ap-row">
        {msg ? (
          <span className={"cp-act-msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </span>
        ) : (
          <span className="ap-sp" />
        )}
        <button type="button" className="cp-btn sm ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="cp-btn sm" disabled={!canWrite || run.isPending || !ready} title={!canWrite ? READ_ONLY : !ready ? "A title (4 to 56 characters) and what you want (a sentence or two)" : undefined}>
          {run.isPending ? "Filing…" : "Request"}
        </button>
      </div>
    </form>
  );
}

function NewApp({ hint, canWrite, onDone }: { hint: string; canWrite: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const run = useActionMutation<{ ok: boolean; answer?: any }, { name: string; description: string }>("cockpit-app-new", {
    timeoutMs: 160_000,
    onSuccess: (r) => {
      const a = (r && r.answer) || {};
      setMsg({ ok: true, text: "Created " + (a.name || name.trim()) + (a.repo && a.repo.ok ? " in the repo at " + a.repo.path : " (starter page ready)") + "." });
      setName("");
      setDesc("");
      setAsking(false);
      setOpen(false);
      onDone();
    },
    onError: (e) => {
      setMsg({ ok: false, text: "Not created: " + errText(e) + ". Your text is kept." });
      setAsking(false);
    },
  });
  const nm = name.trim();
  const ready = nm.length >= 2 && desc.trim().length > 0;
  return (
    <div className="ap-new">
      <div className="ap-row">
        <button type="button" className="cp-btn" aria-expanded={open} disabled={!canWrite} title={canWrite ? undefined : READ_ONLY} onClick={() => setOpen((v) => !v)}>
          New app
        </button>
        <span className="ap-hint">{hint}</span>
      </div>
      {msg && !open ? (
        <p className={"cp-act-msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
      {open ? (
        <form
          className="ap-form"
          aria-label="New app"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && canWrite) setAsking(true);
          }}
        >
          <h4>New app</h4>
          <label className="cp-lab">
            Name
            <input className="cp-in" maxLength={40} required placeholder="e.g. Notes" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="cp-lab">
            What it is for
            <textarea className="cp-in area" maxLength={20000} placeholder="One or two sentences; the whole brief if you have one" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <p className="ap-hint">Its folder will be /{slugN(name) || "name"}/ with index.html, styles.css, app.js and a README.</p>
          <div className="ap-row">
            {msg ? (
              <span className={"cp-act-msg " + (msg.ok ? "ok" : "err")} role={msg.ok ? "status" : "alert"}>
                {msg.text}
              </span>
            ) : (
              <span className="ap-sp" />
            )}
            {asking ? (
              <span className="cp-confirm" role="group" aria-label="Confirm">
                <span className="cp-confirm-q">Create the app {nm} and its staging copy?</span>
                <button type="button" className="cp-btn sm" disabled={run.isPending} onClick={() => run.mutate({ name: nm, description: desc.trim() })}>
                  {run.isPending ? "Creating…" : "Yes, create app"}
                </button>
                <button type="button" className="cp-btn sm ghost" disabled={run.isPending} onClick={() => setAsking(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="cp-btn sm ghost"
                  onClick={() => {
                    setOpen(false);
                    setMsg(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="cp-btn sm" disabled={!canWrite || !ready} title={!canWrite ? READ_ONLY : !ready ? "Name the app and say what it is for" : undefined}>
                  Create app
                </button>
              </>
            )}
          </div>
        </form>
      ) : null}
    </div>
  );
}
