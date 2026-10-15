import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type BoardCard, type BoardCardRead, type BoardView, boardCardActions, boardMatch } from "@shared/cockpit-board";
import { CARD_TITLES, type CockpitCard } from "@shared/cockpit";

import { ActionButton, GLYPH, isLocalViewer, postModal, READ_ONLY, SearchField } from "./CardDialog";

/**
 * The whole board, rendered here from the cockpit client (FA-19027): every
 * column of resource board/cards side by side (stacked on a phone), each card's
 * face, a search over FA id, title, app and chips, Archive on every card, and a
 * card's full detail (resource board/card/<fa>) with its other actions.
 */

const COL_TONE: Record<string, string> = {
  pending: "dim",
  recommendations: "vio",
  todo: "sky",
  reopened: "amb",
  "in-progress": "em",
  "release-ready": "sky",
  released: "em",
};
const PR_CLASS: Record<string, string> = { critical: "r", high: "a", low: "d" };
const SEARCH = { label: "Search cards", placeholder: "Card id, title or app, e.g. FA-18951" };

const hms = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const minTxt = (m: number) => (m < 60 ? m + " min" : (m / 60).toFixed(m % 60 ? 1 : 0) + " h");

function Face({ c, canWrite, onOpen, onDone }: { c: BoardCard; canWrite: boolean; onOpen: (fa: string) => void; onDone: () => void }) {
  const tone = c.paused || c.blocked ? "a" : c.priority === "critical" ? "r" : c.column === "in-progress" ? "g" : "";
  const archive = boardCardActions(c).find((a) => a.label === "Archive");
  const chips = c.chips.filter((x) => !/^(critical|high|low)$/.test(x));
  return (
    <article className={"cp-bc" + (tone ? " t-" + tone : "")} data-fa={c.fa || undefined} data-testid="board-card">
      <button type="button" className="cp-bc-open" onClick={() => c.fa && onOpen(c.fa)} disabled={!c.fa} aria-label={(c.fa || "card") + ": " + c.title}>
        <span className="cp-bc-top">
          <span className="cp-bc-fa">{c.fa || "no id"}</span>
          {c.priority && c.priority !== "normal" ? <span className={"cp-pr p-" + (PR_CLASS[c.priority] || "d")}>{c.priority}</span> : null}
          {c.estimate ? <span className="cp-bc-est">{minTxt(c.estimate)}</span> : null}
        </span>
        <span className="cp-bc-title">{c.title}</span>
        <span className="cp-bc-meta">
          {c.parentFa ? <span className="cp-tag">↳ {c.parentFa}</span> : null}
          {c.children.length ? <span className="cp-tag">⧉ {c.children.length}</span> : null}
          {chips.slice(0, 3).map((x) => (
            <span key={x} className={"cp-tag" + (/paused|blocked/.test(x) ? " a" : /untriaged/.test(x) ? " d" : "")}>
              {x}
            </span>
          ))}
          <span className="cp-tag app">{c.app || "system"}</span>
        </span>
      </button>
      {archive ? (
        <div className="cp-bc-act">
          <ActionButton action={{ ...archive, label: "Archive" }} canWrite={canWrite} onDone={onDone} />
        </div>
      ) : null}
    </article>
  );
}

function Column({ id, name, count, cards, canWrite, onOpen, onDone, wide }: {
  id: string;
  name: string;
  count: number;
  cards: BoardCard[];
  canWrite: boolean;
  onOpen: (fa: string) => void;
  onDone: () => void;
  wide: boolean;
}) {
  const [all, setAll] = useState(false);
  const CAP = 60;
  const shown = all ? cards : cards.slice(0, CAP);
  return (
    <section
      className={"cp-kb-col c-" + (COL_TONE[id] || "sky") + (wide ? " wide" : "") + (!cards.length && !wide ? " rail" : "")}
      aria-label={name + ": " + cards.length + (cards.length === 1 ? " card" : " cards")}
      title={!cards.length && !wide ? name + ": no cards" + (count ? " here (" + count + " on the board)" : "") : undefined}
      data-col={id}
      data-testid="board-column"
    >
      <header className="cp-kb-h">
        <span className="cp-kb-name">{name}</span>
        <span className="cp-kb-n" title={count > cards.length ? count + " on the board, " + cards.length + " open here" : undefined}>
          {cards.length}
          {count > cards.length ? <small> / {count}</small> : null}
        </span>
      </header>
      <div className="cp-kb-list">
        {shown.length ? (
          shown.map((c) => <Face key={c.id} c={c} canWrite={canWrite} onOpen={onOpen} onDone={onDone} />)
        ) : (
          <p className="cp-kb-empty">No cards.</p>
        )}
        {cards.length > shown.length ? (
          <button type="button" className="cp-btn sm ghost cp-kb-more" onClick={() => setAll(true)}>
            Show {cards.length - shown.length} more
          </button>
        ) : null}
      </div>
    </section>
  );
}

function CardView({ fa, board, canWrite, onBack, onOpen, onDone }: {
  fa: string;
  board: BoardView | undefined;
  canWrite: boolean;
  onBack: () => void;
  onOpen: (fa: string) => void;
  onDone: () => void;
}) {
  const q = useActionQuery<BoardCardRead>("get-board-card", { fa }, { refetchInterval: 15000 });
  const r = q.data;
  const c = r?.card;
  const face = board?.cards.find((x) => x.fa === fa);
  const colName = (id: string | null) => board?.columns.find((x) => x.id === id)?.name || id || "n/a";
  const known = new Set((board?.cards || []).map((x) => x.fa));
  const link = (f: string) =>
    known.has(f) ? (
      <button key={f} type="button" className="cp-linkbtn" onClick={() => onOpen(f)}>
        {f}
      </button>
    ) : (
      <span key={f} className="cp-mono">
        {f}
      </span>
    );
  return (
    <div className="cp-cv" data-testid="board-card-detail">
      <div className="cp-cv-nav">
        <button type="button" className="cp-btn sm ghost" onClick={onBack} data-testid="board-back">
          ← Board
        </button>
        <span className="cp-cv-fa">{fa}</span>
        {c ? <span className={"cp-colpill c-" + (COL_TONE[c.column || ""] || "sky")}>{colName(c.column)}</span> : null}
      </div>
      {!c ? (
        <div className={"cp-dlg-msg" + (r && !r.ok ? " err" : "")}>{r ? r.error || "No such open card." : q.isError ? "Could not read " + fa + "." : "Reading " + fa + "…"}</div>
      ) : (
        <>
          <h3 className="cp-cv-title">{c.title}</h3>
          <dl className="cp-cv-meta">
            <div>
              <dt>Priority</dt>
              <dd className={c.priority ? "c-" + (PR_CLASS[c.priority] || "") : undefined}>{c.priority || "normal"}</dd>
            </div>
            <div>
              <dt>Estimate</dt>
              <dd>{c.estimate ? minTxt(c.estimate) : "n/a"}</dd>
            </div>
            <div>
              <dt>App</dt>
              <dd>{c.app || "system"}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{[c.triaged ? "triaged" : "untriaged", c.paused ? "paused" : "", c.blocked ? "blocked" : "", c.laneStage ? "lane: " + c.laneStage : ""].filter(Boolean).join(" · ")}</dd>
            </div>
            {c.parentFa ? (
              <div>
                <dt>Parent</dt>
                <dd>{link(c.parentFa)}</dd>
              </div>
            ) : null}
            {c.children.length ? (
              <div className="span">
                <dt>Sub-cards</dt>
                <dd className="cp-cv-links">{c.children.map(link)}</dd>
              </div>
            ) : null}
            {c.links.length ? (
              <div className="span">
                <dt>Links</dt>
                <dd className="cp-cv-links">
                  {c.links.map((l, i) => (
                    <span key={i} className="cp-tag">
                      {l.type} {l.to}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="cp-acts">
            {boardCardActions(face || c).map((a, i) => (
              <ActionButton key={a.label + i} action={a} canWrite={canWrite} onDone={onDone} />
            ))}
          </div>
          {c.questions.length ? (
            <section className="cp-sec">
              <h3>
                <span className="cp-sec-t">Open questions</span>
                <span className="cp-sec-s">{c.questions.length}</span>
              </h3>
              <ul className="cp-list">
                {c.questions.map((x: any, i) => (
                  <li key={i}>{typeof x === "string" ? x : x?.q || x?.question || x?.text || JSON.stringify(x)}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="cp-sec">
            <h3>
              <span className="cp-sec-t">Card</span>
            </h3>
            {c.body.trim() ? <pre className="cp-cv-pre">{c.body}</pre> : <p className="cp-empty">No body.</p>}
          </section>
          <section className="cp-sec">
            <h3>
              <span className="cp-sec-t">Notes</span>
              <span className="cp-sec-s">
                {c.notesTruncated ? "newest " + c.notes.length.toLocaleString() + " of " + c.notesLength.toLocaleString() + " characters" : c.notesLength ? c.notesLength.toLocaleString() + " characters" : ""}
              </span>
            </h3>
            {c.notes.trim() ? <pre className="cp-cv-pre notes">{c.notes}</pre> : <p className="cp-empty">No notes.</p>}
          </section>
          <p className="cp-at">Read {hms(r!.at)} through the cockpit client.</p>
        </>
      )}
    </div>
  );
}

export function BoardDialog({ card, onClose, returnTo }: { card: CockpitCard | null; onClose: () => void; returnTo: HTMLElement | null }) {
  const open = !!card;
  const canWrite = useMemo(isLocalViewer, []);
  const qc = useQueryClient();
  const returnRef = useRef<HTMLElement | null>(null);
  returnRef.current = returnTo;
  const [query, setQuery] = useState("");
  const [col, setCol] = useState<string>("all");
  const [fa, setFa] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // fresh on the cockpit client's change stream (useDbSync in CardRegion); the interval is only the fallback
  const q = useActionQuery<BoardView>("get-board", {}, { refetchInterval: 15000, enabled: open });
  const ping = useActionMutation<{ echo: unknown; ms: number; live: boolean }, { text: string }>("cockpit-ping");
  const b = q.data;
  useEffect(() => {
    if (!open) return;
    postModal(true);
    return () => postModal(false);
  }, [open]);
  useEffect(() => {
    if (!open) {
      setFa(null);
      setQuery("");
      setCol("all");
    }
  }, [open]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [fa]);
  const refresh = () => {
    void qc.invalidateQueries();
  };
  const found = useMemo(() => (b ? b.cards.filter((c) => boardMatch(c, query)) : []), [b, query]);
  const cols = useMemo(() => (b ? b.columns.filter((c) => col === "all" || c.id === col) : []), [b, col]);
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {card ? (
        <DialogContent
          hideClose
          motion="instant"
          className="cp-dlg cp-board-dlg"
          overlayClassName="cp-dlg-ov"
          aria-describedby="cp-board-desc"
          data-testid="board-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnRef.current?.focus();
          }}
        >
          <header className={"cp-dlg-h t-" + card.tone}>
            <span className="cp-edge" />
            <div className="cp-dlg-ht">
              <DialogTitle className="cp-dlg-title">
                <i className={"cp-dot t-" + card.tone} />
                {CARD_TITLES.board}
                <span className="cp-glyph-i" aria-hidden="true">
                  {GLYPH[card.tone]}
                </span>
              </DialogTitle>
              <div className={"cp-dlg-hl c-" + card.tone}>{card.headline}</div>
              <DialogDescription id="cp-board-desc" className="cp-dlg-sub">
                {card.sub}
                {card.chip ? <span className="cp-chip">{card.chip}</span> : null}
              </DialogDescription>
            </div>
            <button type="button" className="cp-btn cp-x-btn" onClick={onClose} aria-label="Close Board">
              ✕
            </button>
          </header>
          {!fa ? (
            <div className="cp-kb-tools">
              <SearchField search={SEARCH} value={query} onChange={setQuery} matches={query.trim() ? found.length : -1} />
              <div className="cp-seg cp-kb-seg" role="group" aria-label="Column">
                <button type="button" aria-pressed={col === "all"} onClick={() => setCol("all")}>
                  All<span className="cp-seg-n">{b ? b.cards.length : "…"}</span>
                </button>
                {(b?.columns || []).map((c) => (
                  <button key={c.id} type="button" aria-pressed={col === c.id} onClick={() => setCol(c.id)} data-testid="board-col-filter">
                    {c.name}
                    <span className="cp-seg-n">{found.filter((x) => x.column === c.id).length}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="cp-dlg-b cp-kb-body" ref={bodyRef} data-testid="board-dialog-body">
            {fa ? (
              <CardView fa={fa} board={b} canWrite={canWrite} onBack={() => setFa(null)} onOpen={setFa} onDone={refresh} />
            ) : !b ? (
              <div className="cp-dlg-msg">{q.isError ? "Could not read the board: " + (q.error instanceof Error ? q.error.message : String(q.error)) : "Reading the board…"}</div>
            ) : (
              <>
                {b.error ? (
                  <div className="cp-dlg-msg err" role="alert">
                    {b.error}
                  </div>
                ) : null}
                {!canWrite ? <p className="cp-ro">Buttons are {READ_ONLY}: open the cockpit on this Mac to use them.</p> : null}
                {query.trim() && !found.length ? <p className="cp-empty">No card matches "{query.trim()}".</p> : null}
                <div className={"cp-kb" + (col !== "all" ? " one" : "")} data-testid="board-kanban">
                  {cols.map((c) => (
                    <Column
                      key={c.id}
                      id={c.id}
                      name={c.name}
                      count={c.count}
                      cards={found.filter((x) => x.column === c.id)}
                      canWrite={canWrite}
                      onOpen={setFa}
                      onDone={refresh}
                      wide={col !== "all"}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <footer className="cp-dlg-f">
            <span className="cp-dlg-f-l" data-testid="board-footer">
              <i className={"cp-dot " + (b?.live ? "t-g" : "t-a")} /> {b ? (b.live ? "Live" : "Polling") + " · read " + hms(b.at) + " · " + b.total + " cards" + (b.archived != null ? " · " + b.archived.toLocaleString() + " archived" : "") : "connecting…"}
              {ping.data ? (
                <span className="cp-ping ok" data-testid="board-ping-answer">
                  {" "}
                  · cockpit answered "{String(ping.data.echo)}" in {ping.data.ms} ms
                </span>
              ) : ping.isError ? (
                <span className="cp-ping err"> · ping failed: {ping.error instanceof Error ? ping.error.message.replace(/^Action [\w-]+ failed:\s*/, "") : ""}</span>
              ) : null}
            </span>
            <button type="button" className="cp-btn sm ghost" onClick={() => ping.mutate({ text: "board " + new Date().toLocaleTimeString() })} disabled={ping.isPending} data-testid="board-ping">
              {ping.isPending ? "Pinging…" : "Ping cockpit"}
            </button>
            <button type="button" className="cp-btn" onClick={onClose}>
              Close
            </button>
          </footer>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
