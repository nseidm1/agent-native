import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CARD_TITLES, type CardId, type CockpitCard, type Tone } from "@shared/cockpit";
import {
  type CardDetail,
  type DetailAction,
  type DetailCell,
  type DetailFilter,
  type DetailRow,
  type DetailSearch,
  type DetailSection,
  type JobForm,
  searchSections,
  WRITE_ACTIONS,
} from "@shared/cockpit-detail";

import { useCanWrite } from "./viewer";

/** The cockpit (the parent window) gives the iframe the whole viewport while a dialog is open. */
export function postModal(open: boolean) {
  try {
    window.parent.postMessage({ type: "cockpit-modal", open }, "*");
  } catch {
    // no parent (opened directly)
  }
}

/** Writes act on this Mac, or from a phone the cockpit's own write gate admits (MI-370); anyone else sees them disabled (the server refuses them too). */
export { isLocalViewer } from "./viewer";

export const READ_ONLY = "read-only on this device";

function cellOf(c: DetailCell): { t: string; tone?: Tone; mono?: boolean; title?: string } {
  return typeof c === "string" ? { t: c } : c;
}

export function ActionButton({ action, canWrite, onDone }: { action: DetailAction; canWrite: boolean; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useActionMutation<{ ok: boolean; answer?: any }, Record<string, unknown>>(WRITE_ACTIONS[action.kind], {
    timeoutMs: 160_000,
    onSuccess: (r) => {
      const a = r && r.answer;
      const said = a && typeof a === "object" ? a.text || a.note || (a.pending ? "still running" : "") : "";
      setMsg({ ok: true, text: "Done" + (said ? ": " + String(said).slice(0, 200) : ".") });
      setAsking(false);
      onDone();
    },
    onError: (e) => {
      // the cockpit's own words, without the framework's "Action <name> failed:" prefix
      setMsg({ ok: false, text: (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "") });
      setAsking(false);
    },
  });
  const needInput = action.input && action.input.required && !value.trim();
  const send = () => {
    if (!canWrite || run.isPending || needInput) return;
    setMsg(null);
    run.mutate({ ...action.args, ...(action.input && value.trim() ? { [action.input.name]: value.trim() } : {}) });
  };
  const disabled = !canWrite || run.isPending;
  return (
    <span className="cp-act">
      {action.input ? (
        action.input.options && action.input.options.length ? (
          <select
            className="cp-in"
            aria-label={action.input.label}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="">{action.input.label}…</option>
            {action.input.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="cp-in"
            aria-label={action.input.label}
            placeholder={action.input.label}
            value={value}
            maxLength={500}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
          />
        )
      ) : null}
      {asking ? (
        <span className="cp-confirm" role="group" aria-label="Confirm">
          <span className="cp-confirm-q">{action.confirm}</span>
          <button type="button" className={"cp-btn sm" + (action.danger ? " danger" : "")} onClick={send} disabled={disabled}>
            {run.isPending ? "Working…" : "Yes, " + action.label.toLowerCase()}
          </button>
          <button type="button" className="cp-btn sm ghost" onClick={() => setAsking(false)} disabled={run.isPending}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={"cp-btn sm" + (action.danger ? " danger" : "")}
          disabled={disabled || !!needInput}
          title={!canWrite ? READ_ONLY : needInput ? action.input?.label : undefined}
          onClick={() => (action.confirm ? setAsking(true) : send())}
        >
          {run.isPending ? "Working…" : action.label}
        </button>
      )}
      {msg ? (
        <span className={"cp-act-msg" + (msg.ok ? " ok" : " err")} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </span>
      ) : null}
    </span>
  );
}

function Actions({ actions, canWrite, onDone }: { actions?: DetailAction[]; canWrite: boolean; onDone: () => void }) {
  if (!actions || !actions.length) return null;
  return (
    <div className="cp-acts">
      {actions.map((a, i) => (
        <ActionButton key={a.kind + a.label + i} action={a} canWrite={canWrite} onDone={onDone} />
      ))}
    </div>
  );
}

function Table({ s, rows, canWrite, onDone }: { s: DetailSection; rows: DetailRow[]; canWrite: boolean; onDone: () => void }) {
  const cols = s.columns || [];
  const num = new Set(s.numeric || []);
  if (!rows.length) return <p className="cp-empty">{s.empty || "none"}</p>;
  return (
    <table className="cp-tbl">
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} scope="col" className={num.has(i) ? "n" : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => {
          const extra = !!(r.note || (r.actions && r.actions.length));
          const tone = r.tone ? "t-" + r.tone : "";
          return (
            <Fragment key={ri}>
              <tr className={[tone, extra ? "has-x" : ""].filter(Boolean).join(" ") || undefined}>
                {r.cells.map((c0, ci) => {
                  const c = cellOf(c0);
                  return (
                    <td
                      key={ci}
                      data-label={cols[ci] || undefined}
                      className={[num.has(ci) ? "n" : "", c.mono ? "mono" : "", c.tone ? "c-" + c.tone : "", ci === 0 ? "first" : ""].filter(Boolean).join(" ") || undefined}
                      title={c.title}
                    >
                      {c.t}
                    </td>
                  );
                })}
              </tr>
              {extra ? (
                <tr className={["cp-xr", tone].filter(Boolean).join(" ")}>
                  <td className="cp-x" colSpan={Math.max(1, cols.length)}>
                    {r.note ? <div className="cp-note">{r.note}</div> : null}
                    <Actions actions={r.actions} canWrite={canWrite} onDone={onDone} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Section({ s, tagFilter, canWrite, onDone }: { s: DetailSection; tagFilter: string; canWrite: boolean; onDone: () => void }) {
  const rows = (s.rows || []).filter((r) => tagFilter === "all" || !r.tag || r.tag === tagFilter);
  const body =
    s.kind === "stats" ? (
      <div className="cp-stats">
        {(s.stats || []).map((x, i) => (
          <div key={i} className={"cp-stat" + (x.tone ? " t-" + x.tone : "")}>
            <div className="cp-stat-l">{x.label}</div>
            <div className={"cp-stat-v" + (x.tone ? " c-" + x.tone : "")}>{x.value}</div>
            {x.sub ? <div className="cp-stat-s">{x.sub}</div> : null}
          </div>
        ))}
      </div>
    ) : s.kind === "table" ? (
      <div className="cp-tw">
        <Table s={s} rows={rows} canWrite={canWrite} onDone={onDone} />
      </div>
    ) : s.kind === "list" ? (
      s.items && s.items.length ? (
        <ul className="cp-list">
          {s.items.map((it, i) => (
            <li key={i} className={it.tone ? "c-" + it.tone : undefined}>
              {it.strong ? <b>{it.strong}: </b> : null}
              {it.text}
              <Actions actions={it.actions} canWrite={canWrite} onDone={onDone} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cp-empty">{s.empty || "none"}</p>
      )
    ) : s.kind === "bars" ? (
      s.bars && s.bars.length ? (
        <ul className="cp-bars">
          {s.bars.map((b, i) => (
            <li key={i} className={b.tone ? "t-" + b.tone : undefined} title={b.title}>
              <span className="cp-bar-l">{b.label}</span>
              <span className="cp-bar-t" aria-hidden="true">
                <i style={{ width: Math.max(0, Math.min(1, b.frac)) * 100 + "%" }} />
              </span>
              <span className={"cp-bar-v" + (b.tone ? " c-" + b.tone : "")}>{b.value}</span>
              {b.sub ? <span className="cp-bar-s">{b.sub}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cp-empty">{s.empty || "none"}</p>
      )
    ) : (
      <p className="cp-text">{s.text}</p>
    );
  const more = s.more ? <p className="cp-more">{s.more} more not shown (the list is capped at 200).</p> : null;
  const n = s.kind === "table" ? rows.length : s.kind === "list" ? (s.items || []).length : 0;
  if (s.collapsed) {
    return (
      <details className="cp-sec">
        <summary>
          <span className="cp-sec-t">{s.title}</span>
          {s.sub ? <span className="cp-sec-s">{s.sub}</span> : n ? <span className="cp-sec-s">{n}</span> : null}
        </summary>
        {body}
        {more}
      </details>
    );
  }
  return (
    <section className="cp-sec">
      <h3>
        <span className="cp-sec-t">{s.title}</span>
        {s.sub ? <span className="cp-sec-s">{s.sub}</span> : null}
      </h3>
      {body}
      {more}
    </section>
  );
}

function Filters({ filters, values, onChange }: { filters: DetailFilter[]; values: Record<string, string>; onChange: (key: string, value: string, server: boolean) => void }) {
  return (
    <div className="cp-filters">
      {filters.map((f) => {
        const cur = values[f.key] ?? f.value;
        return (
          <div key={f.key} className="cp-seg" role="group" aria-label={f.label}>
            {f.options.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={cur === o.value}
                onClick={() => onChange(f.key, o.value, f.server)}
              >
                {o.label}
                {o.count != null ? <span className="cp-seg-n">{o.count}</span> : null}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function JobStart({ form, canWrite, onDone }: { form: JobForm; canWrite: boolean; onDone: () => void }) {
  const [kind, setKind] = useState(form.kinds[0]?.id || "");
  const [text, setText] = useState("");
  const [maxUsd, setMaxUsd] = useState("");
  const [maxMin, setMaxMin] = useState("");
  const k = form.kinds.find((x) => x.id === kind);
  const usdN = parseFloat(maxUsd);
  const minN = parseInt(maxMin, 10);
  const action: DetailAction = {
    kind: "job-start",
    label: "Start job",
    args: { kind, text: text.trim(), ...(Number.isFinite(usdN) && usdN > 0 ? { maxUsd: usdN } : {}), ...(Number.isFinite(minN) && minN > 0 ? { maxMin: minN } : {}) },
    confirm: "Start a " + (k?.label || kind) + " job?",
  };
  return (
    <section className="cp-sec cp-job">
      <h3>
        <span className="cp-sec-t">Start a job</span>
      </h3>
      <div className="cp-seg" role="group" aria-label="Job kind">
        {form.kinds.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === kind} onClick={() => setKind(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {k ? <p className="cp-sec-s">{k.label}: {k.does}.</p> : null}
      <label className="cp-lab" htmlFor="cp-job-text">
        The job, in plain words
      </label>
      <textarea id="cp-job-text" className="cp-in area" rows={3} maxLength={4000} value={text} disabled={!canWrite} onChange={(e) => setText(e.target.value)} />
      <div className="cp-job-row">
        <label className="cp-lab">
          Spending cap ($)
          <input className="cp-in" inputMode="decimal" value={maxUsd} disabled={!canWrite} onChange={(e) => setMaxUsd(e.target.value)} />
        </label>
        <label className="cp-lab">
          Time cap (minutes)
          <input className="cp-in" inputMode="numeric" value={maxMin} disabled={!canWrite} onChange={(e) => setMaxMin(e.target.value)} />
        </label>
        {text.trim() && kind ? (
          <ActionButton action={action} canWrite={canWrite} onDone={() => { setText(""); onDone(); }} />
        ) : (
          <span className="cp-act">
            <button type="button" className="cp-btn sm" disabled title={!canWrite ? READ_ONLY : "Describe the job first"}>
              Start job
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

/** The dialog's search field (the Board dialog: cards and sub-cards by FA id or title). */
export function SearchField({ search, value, onChange, matches }: { search: DetailSearch; value: string; onChange: (v: string) => void; matches: number }) {
  return (
    <div className="cp-search" role="search">
      <svg className="cp-search-i" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="cp-in cp-search-in"
        aria-label={search.label}
        placeholder={search.placeholder}
        value={value}
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        data-testid="detail-search"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears the field first; a second Escape closes the dialog
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
      />
      {value.trim() ? (
        <span className={"cp-search-n" + (matches ? "" : " none")} aria-live="polite" data-testid="detail-search-count">
          {matches ? matches + (matches === 1 ? " card" : " cards") : "no match"}
        </span>
      ) : null}
    </div>
  );
}

function DetailBody({ id, canWrite }: { id: CardId; canWrite: boolean }) {
  const [server, setServer] = useState<Record<string, string>>({});
  // fresh on the cockpit client's change stream (useDbSync in CardRegion); the interval is only the fallback
  const q = useActionQuery<CardDetail>("get-card-detail", { id, ...server } as any, { refetchInterval: 15000 });
  const d = q.data;
  if (!d) {
    return <div className="cp-dlg-msg">{q.isError ? "Could not read this card: " + (q.error instanceof Error ? q.error.message : String(q.error)) : "Reading the cockpit…"}</div>;
  }
  return <DetailView d={d} canWrite={canWrite} server={server} setServer={setServer} />;
}

/**
 * A detail document (a card's, or a cockpit window's: FA-19087's WindowDialog) rendered as sections: stats, tables,
 * lists, text and bars, with its filters, search, whole-dialog actions and job form. server/setServer carry the
 * filters that refetch (the caller owns the query).
 */
export function DetailView({ d, canWrite, server, setServer }: { d: Omit<CardDetail, "id"> & { id: string }; canWrite: boolean; server: Record<string, string>; setServer: (f: (p: Record<string, string>) => Record<string, string>) => void }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const refresh = () => {
    void qc.invalidateQueries();
  };
  const tagFilter = useMemo(() => {
    const f = d?.filters?.find((x) => !x.server);
    return f ? local[f.key] ?? f.value : "all";
  }, [d, local]);
  const found = useMemo(() => (d && d.search ? searchSections(d.sections, query) : { sections: d?.sections ?? [], matches: -1 }), [d, query]);
  return (
    <>
      {d.error ? (
        <div className="cp-dlg-msg err" role="alert">
          {d.error}
        </div>
      ) : null}
      {d.lead ? <p className="cp-lead">{d.lead}</p> : null}
      {d.search ? <SearchField search={d.search} value={query} onChange={setQuery} matches={found.matches} /> : null}
      {d.filters && d.filters.length ? (
        <Filters
          filters={d.filters}
          values={{ ...server, ...local }}
          onChange={(key, value, isServer) =>
            isServer ? setServer((p) => ({ ...p, [key]: value })) : setLocal((p) => ({ ...p, [key]: value }))
          }
        />
      ) : null}
      {(d.actions && d.actions.length) || d.jobForm ? (
        !canWrite ? <p className="cp-ro">Buttons are {READ_ONLY}: open the cockpit on this Mac to use them.</p> : null
      ) : null}
      <Actions actions={d.actions} canWrite={canWrite} onDone={refresh} />
      {d.jobForm ? <JobStart form={d.jobForm} canWrite={canWrite} onDone={refresh} /> : null}
      {found.matches === 0 ? <p className="cp-empty">No card matches "{query.trim()}".</p> : null}
      {found.sections.map((s, i) => (
        <Section key={s.title + i + (found.matches >= 0 ? ":q" : "")} s={s} tagFilter={tagFilter} canWrite={canWrite} onDone={refresh} />
      ))}
      <p className="cp-at">
        {d.ok ? "Live · read " : "Last read "}
        {new Date(d.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
    </>
  );
}

export const GLYPH: Record<Tone, string> = { g: "✓", a: "⚠", r: "✕", d: "–" };

export function CardDialog({ card, onClose, returnTo }: { card: CockpitCard | null; onClose: () => void; returnTo: HTMLElement | null }) {
  const open = !!card;
  const canWrite = useCanWrite();
  const returnRef = useRef<HTMLElement | null>(null);
  returnRef.current = returnTo;
  useEffect(() => {
    if (!open) return;
    postModal(true);
    return () => postModal(false);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {card ? (
        <DialogContent
          hideClose
          motion="instant"
          className="cp-dlg"
          overlayClassName="cp-dlg-ov"
          aria-describedby="cp-dlg-desc"
          onCloseAutoFocus={(e) => {
            // focus goes back to the card that opened it
            e.preventDefault();
            returnRef.current?.focus();
          }}
        >
          <header className={"cp-dlg-h t-" + card.tone}>
            <span className="cp-edge" />
            <div className="cp-dlg-ht">
              <DialogTitle className="cp-dlg-title">
                <i className={"cp-dot t-" + card.tone} />
                {CARD_TITLES[card.id]}
                <span className="cp-glyph-i" aria-hidden="true">
                  {GLYPH[card.tone]}
                </span>
              </DialogTitle>
              <div className={"cp-dlg-hl c-" + card.tone}>{card.headline}</div>
              <DialogDescription id="cp-dlg-desc" className="cp-dlg-sub">
                {card.sub}
                {card.chip ? <span className="cp-chip">{card.chip}</span> : null}
              </DialogDescription>
            </div>
            <button type="button" className="cp-btn cp-x-btn" onClick={onClose} aria-label={"Close " + CARD_TITLES[card.id]}>
              ✕
            </button>
          </header>
          <div className="cp-dlg-b" data-testid="card-dialog-body">
            <DetailBody id={card.id} canWrite={canWrite} />
          </div>
          <footer className="cp-dlg-f">
            <span className="cp-dlg-f-l">{canWrite ? "Writes go to the cockpit on this Mac." : "Viewing only: " + READ_ONLY + "."}</span>
            <button type="button" className="cp-btn" onClick={onClose}>
              Close
            </button>
          </footer>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
