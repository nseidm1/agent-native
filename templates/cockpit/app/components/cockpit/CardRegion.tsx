import { useActionMutation, useActionQuery, useDbSync } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CARD_TITLES,
  type CardId,
  type CardsResult,
  type CockpitCard,
  type CockpitLayout,
  DEFAULT_LAYOUT,
  type Tone,
} from "@shared/cockpit";
import { AppliedBanner, ApplyProgress } from "./ApplyStatus";
import { ensureUiCapability } from "@/lib/ui-capability";
import { BoardDialog } from "./BoardDialog";
import { CardDialog } from "./CardDialog";
import { useCanWrite } from "./viewer";
import { type AskImage, MAX_ASK_IMAGES, precheckImageFile, sniffImageType } from "@shared/ask-images";

const GLYPH: Record<Tone, string> = { g: "✓", a: "⚠", r: "✕", d: "–" };
const TONE_WORD: Record<Tone, string> = { g: "ok", a: "needs attention", r: "broken", d: "no data" };
const COLLAPSE_KEY = "cockpit.cards.collapsed";


function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n > 1 ? (100 * i) / (n - 1) : 50).toFixed(1);
  const y = (v: number) => (22 - (20 * v) / max).toFixed(1);
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg className="cp-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,24 ${pts} 100,24`} />
      <polyline points={pts} />
    </svg>
  );
}

function Meters({ meters }: { meters: NonNullable<CockpitCard["meters"]> }) {
  return (
    <div className="cp-meters" aria-hidden="true">
      {meters.map((m) => (
        <MeterRow key={m.label} label={m.label} pct={m.pct} />
      ))}
    </div>
  );
}

function MeterRow({ label, pct }: { label: string; pct: number }) {
  return (
    <>
      <span data-pct={`${pct}%`}>{label}</span>
      <span className={"cp-bar" + (pct > 85 ? " r" : pct > 60 ? " a" : "")}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <b>{pct}%</b>
    </>
  );
}

function Card({ card, size, fill, onOpen }: { card: CockpitCard; size?: string; fill?: boolean; onOpen: (id: CardId, el: HTMLElement) => void }) {
  const label = `${card.title}: ${card.headline}. ${card.sub}${card.chip ? `. ${card.chip}` : ""}. Status ${TONE_WORD[card.tone]}. Opens its details.`;
  return (
    <button
      type="button"
      className={`cp-card t-${card.tone}${size === "l" ? " sz-l" : fill ? " fill" : ""}`}
      data-card={card.id}
      aria-label={label}
      title={`${card.headline} · ${card.sub}`}
      aria-haspopup="dialog"
      onClick={(e) => onOpen(card.id, e.currentTarget)}
    >
      <span className="cp-edge" />
      <span className="cp-title">
        <i className={`cp-dot t-${card.tone}`} />
        <span>{card.title}</span>
      </span>
      <span className="cp-hl">{card.headline}</span>
      <span className="cp-sub">{card.sub}</span>
      {card.chip ? <span className="cp-chip">{card.chip}</span> : <span />}
      <span className="cp-viz">
        {card.meters ? <Meters meters={card.meters} /> : card.spark && card.spark.length > 1 ? <Spark values={card.spark} /> : null}
      </span>
      <span className="cp-glyph" aria-hidden="true">
        {GLYPH[card.tone]}
      </span>
    </button>
  );
}

function placeholder(id: CardId): CockpitCard {
  return { id, title: CARD_TITLES[id], tone: "d", headline: "Loading…", sub: "reading the cockpit", chip: "" };
}

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

interface Attached extends AskImage {
  id: string;
  url: string;
  size: number;
}

/** Reads one picked, pasted or dropped file into an attachment, or says why it cannot be one. */
function readImageFile(f: File): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error(`Could not read ${f.name || "the image"}.`));
    r.onload = () => {
      const url = String(r.result || "");
      const data = url.slice(url.indexOf(",") + 1);
      let head: Uint8Array;
      try {
        const bin = atob(data.slice(0, 24));
        head = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } catch {
        head = new Uint8Array();
      }
      // the bytes, not the declared type, decide (the server checks again)
      if (!sniffImageType(head)) return reject(new Error(`${f.name || "That file"} is not a PNG, JPEG, WebP or GIF image.`));
      resolve({ id: Math.random().toString(36).slice(2), name: (f.name || "pasted image").slice(0, 200), data, url, size: f.size });
    };
    r.readAsDataURL(f);
  });
}

type AskKind = "layout" | "read" | "change" | "system";
interface AskReply {
  answer: string;
  layoutChanged: boolean;
  kind: AskKind;
  classifyNote?: string;
  card?: { fa: string; title: string; attached: string; images: string[] };
  job?: { id: string; status: string };
}
const PATH_LABEL: Record<AskKind, string> = { layout: "Layout path", read: "Read path", change: "Applying change", system: "Filed (system side)" };

const kb = (n: number) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB");

function AskPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [attachErr, setAttachErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; changed: boolean; images: number; kind: AskKind; fa?: string; note?: string; job?: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<Attached[]>([]);
  imagesRef.current = images;
  // MI-388: this Mac and a paired phone apply changes; any other device reads and files (the same verdict the region applies, get-viewer)
  const canApply = useCanWrite();
  const ask = useActionMutation<AskReply, { question: string; images?: AskImage[] }>("ask-agent", {
    // classifier (30 s) + the agent run (120 s) or the card filer (120 s)
    timeoutMs: 280_000,
    onSuccess: (r, vars) => {
      setAnswer({ text: r.answer, changed: r.layoutChanged, images: vars.images?.length ?? 0, kind: r.kind, fa: r.card?.fa, note: r.classifyNote, job: r.job?.id });
      setImages([]);
      void qc.invalidateQueries();
    },
  });
  useEffect(() => ref.current?.focus(), []);
  // ask-agent is UI-only: take the browser's UI capability when the panel opens, so the first ask does not go out
  // without it and come back 403 ui_capability_required before the framework's own retry (a console error in the cockpit)
  useEffect(() => {
    void ensureUiCapability(); // FA-19155: the one shared capability request (app/lib/ui-capability.ts)
  }, []);

  const addFiles = async (files: File[]) => {
    setAttachErr("");
    const errs: string[] = [];
    let count = imagesRef.current.length;
    const added: Attached[] = [];
    for (const f of files) {
      const why = precheckImageFile(f, count);
      if (why) {
        errs.push(f.name ? `${f.name}: ${why}` : why);
        if (count >= MAX_ASK_IMAGES) break;
        continue;
      }
      try {
        added.push(await readImageFile(f));
        count++;
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (added.length) setImages((prev) => [...prev, ...added].slice(0, MAX_ASK_IMAGES));
    if (errs.length) setAttachErr(errs.join(" "));
  };

  const send = () => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    setAnswer(null);
    const imgs = images.map(({ name, data }) => ({ name, data }));
    ask.mutate(imgs.length ? { question: q, images: imgs } : { question: q });
  };
  const full = images.length >= MAX_ASK_IMAGES;
  return (
    <div
      className={"cp-ask" + (dragging ? " drop" : "")}
      role="dialog"
      aria-label="Ask the cockpit agent"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <label htmlFor="cp-ask-q">Ask the agent to read, rearrange or change these cards</label>
      <div className="cp-ask-row">
        <textarea
          id="cp-ask-q"
          ref={ref}
          rows={1}
          maxLength={2000}
          value={question}
          placeholder="e.g. move Halo to the top of Models & compute"
          onChange={(e) => setQuestion(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files || []).filter((f) => f.type.startsWith("image/"));
            if (!files.length) return;
            e.preventDefault();
            void addFiles(files);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="cp-btn cp-attach"
          onClick={() => fileRef.current?.click()}
          disabled={full || ask.isPending}
          aria-label={full ? `Image limit reached (${MAX_ASK_IMAGES})` : "Attach images"}
          title={full ? `At most ${MAX_ASK_IMAGES} images` : "Attach images (or paste / drop them here)"}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              d="M21 11.5 12.4 20a5.5 5.5 0 0 1-7.8-7.8l8.6-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          data-testid="ask-file"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <button type="button" className="cp-btn" onClick={send} disabled={ask.isPending || !question.trim()}>
          {ask.isPending ? "Asking…" : "Send"}
        </button>
      </div>
      {images.length ? (
        <ul className="cp-thumbs" aria-label={`${images.length} of ${MAX_ASK_IMAGES} images attached`}>
          {images.map((img) => (
            <li key={img.id} className="cp-thumb">
              <img src={img.url} alt={img.name} />
              <span className="cp-thumb-cap">{kb(img.size)}</span>
              <button
                type="button"
                className="cp-thumb-x"
                aria-label={`Remove ${img.name}`}
                title={`Remove ${img.name}`}
                disabled={ask.isPending}
                onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="cp-ask-hint">
        {dragging
          ? "Drop to attach"
          : `A change to this region is applied live by the code agent once scope, typecheck, tests, build and a Playwright check pass, with Undo after; a request that needs the system side is filed as a board card. Images: attach, paste or drop · up to ${MAX_ASK_IMAGES}, 5 MB each, PNG/JPEG/WebP/GIF`}
      </div>
      {canApply ? null : (
        <div className="cp-ask-hint" data-testid="ask-unpaired">
          This device is not paired: questions are answered and changes are filed as board cards. Sign in with the board token to apply changes from here.
        </div>
      )}
      {attachErr ? (
        <div className="cp-ask-out err" role="alert">
          {attachErr}
        </div>
      ) : null}
      {ask.isPending ? (
        <div className="cp-ask-out busy" aria-live="polite">
          Classifying, then answering, applying or filing (up to 2 minutes)…
        </div>
      ) : ask.isError ? (
        <div className="cp-ask-out err" role="alert">
          {ask.error instanceof Error ? ask.error.message : String(ask.error)}
        </div>
      ) : answer ? (
        <>
          <div className={"cp-ask-out" + (answer.fa ? " filed" : "")} aria-live="polite" data-testid="ask-answer" data-kind={answer.kind}>
            {answer.text}
          </div>
          {answer.job ? <ApplyProgress id={answer.job} onFollow={(id) => setAnswer((a) => (a ? { ...a, job: id } : a))} /> : null}
          <div className="cp-ask-meta" data-testid="ask-meta">
            <span className={"cp-ask-path k-" + answer.kind}>{PATH_LABEL[answer.kind]}</span>
            {answer.fa
              ? ` Filed as ${answer.fa}; nothing in the cockpit was changed.`
              : answer.job
                ? " Applied only if every gate passes."
                : answer.changed
                  ? " Layout changed."
                  : " Layout unchanged."}
            {answer.images && answer.kind !== "change" ? ` ${answer.images} image${answer.images === 1 ? "" : "s"} sent.` : ""}
            {answer.note ? ` (Classifier unavailable, answered as a read: ${answer.note})` : ""}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Liveness (FA-19027): the server's cockpit client holds one change stream to
 * the cockpit and records a "cockpit" change for every resource that moved
 * (server/plugins/cockpit-live.ts); this page hears it on the framework's own
 * sync transport and re-reads its queries. Nothing polls the cockpit's state;
 * the query intervals below are only the fallback for a dropped stream, and a
 * read the client already has costs a 304 at most.
 */
function CockpitSync() {
  const queryClient = useQueryClient();
  useDbSync({ queryClient, realtime: { reason: "the cockpit's cards and board change while the region is open" }, pauseWhenHidden: true });
  return null;
}

export function CardRegion() {
  const cardsQ = useActionQuery<CardsResult>("get-cards", {}, { refetchInterval: 15000 });
  const layoutQ = useActionQuery<CockpitLayout>("get-layout", {}, { refetchInterval: 30000 });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [askOpen, setAskOpen] = useState(false);
  const [openId, setOpenId] = useState<CardId | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const openCard = useCallback((id: CardId, el: HTMLElement) => {
    openerRef.current = el;
    setOpenId(id);
  }, []);

  useEffect(() => setCollapsed(readCollapsed()), []);

  // the cockpit sizes the iframe on a phone from this height
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = -1;
    const post = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h < 1 || h === last) return; // nothing laid out yet
      last = h;
      try {
        window.parent.postMessage({ type: "cockpit-height", h }, "*");
      } catch {
        // no parent
      }
    };
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, []);

  const toggleBand = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        // per-viewer convenience only
      }
      return next;
    });
  }, []);

  const result = cardsQ.data;
  const layout = layoutQ.data ?? DEFAULT_LAYOUT;
  const byId = useMemo(() => {
    const m = new Map<CardId, CockpitCard>();
    for (const c of result?.cards ?? []) m.set(c.id, c);
    return m;
  }, [result]);
  const hidden = new Set(layout.hidden);

  const status = cardsQ.isError
    ? { text: "cards unavailable", stale: true }
    : !result
      ? { text: "connecting…", stale: false }
      : !result.ok
        ? { text: result.error || "cockpit unreachable", stale: true }
        : { text: (result.live ? "live · " : "polling · ") + new Date(result.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), stale: false };

  return (
    <div className="cp-region" ref={rootRef} data-testid="cockpit-region">
      <CockpitSync />
      <header className="cp-head">
        <h1>Cards</h1>
        <span className={"cp-live" + (status.stale ? " stale" : "")} aria-live="polite">
          <i className={"cp-dot " + (status.stale ? "t-a" : "t-g")} />
          {status.text}
        </span>
        <span className="cp-spacer" />
        <button
          type="button"
          className="cp-btn"
          aria-expanded={askOpen}
          aria-controls="cp-ask"
          onClick={() => setAskOpen((v) => !v)}
        >
          ✦ Ask agent
        </button>
      </header>

      <AppliedBanner />

      {askOpen ? (
        <div id="cp-ask">
          <AskPanel onClose={() => setAskOpen(false)} />
        </div>
      ) : null}

      {layout.bands.map((band) => {
        const ids = band.cards.filter((id) => !hidden.has(id));
        if (!ids.length) return null;
        const cards = ids.map((id) => byId.get(id) ?? placeholder(id));
        const isCollapsed = !!collapsed[band.id];
        // on desktop a card left alone on the band's last row spans both columns
        let col = 0;
        let fillIndex = -1;
        cards.forEach((c, i) => {
          if (layout.size[c.id] === "l") {
            col = 0;
            return;
          }
          col = (col + 1) % 2;
          if (i === cards.length - 1 && col === 1) fillIndex = i;
        });
        const worst = (["r", "a"] as Tone[]).map((t) => ({ t, n: cards.filter((c) => c.tone === t).length })).filter((x) => x.n);
        return (
          <section
            key={band.id}
            className={"cp-band" + (isCollapsed ? " collapsed" : "")}
            data-band={band.id}
            aria-label={band.title}
          >
            <button
              type="button"
              className="cp-band-h"
              aria-expanded={!isCollapsed}
              onClick={() => toggleBand(band.id)}
            >
              <span>{band.title}</span>
              <span className="cp-band-sum" aria-label={worst.map((x) => `${x.n} ${TONE_WORD[x.t]}`).join(", ") || "all ok"}>
                {worst.length
                  ? worst.map((x) => Array.from({ length: Math.min(x.n, 4) }, (_, i) => <i key={x.t + i} className={`cp-dot t-${x.t}`} />))
                  : <i className="cp-dot t-g" />}
              </span>
              <span className="cp-chev" aria-hidden="true">
                ▾
              </span>
            </button>
            <div className="cp-grid">
              {cards.map((c, i) => (
                <Card key={c.id} card={c} size={layout.size[c.id]} fill={i === fillIndex} onOpen={openCard} />
              ))}
            </div>
          </section>
        );
      })}
      <CardDialog
        card={openId && openId !== "board" ? (byId.get(openId) ?? placeholder(openId)) : null}
        onClose={() => setOpenId(null)}
        returnTo={openerRef.current}
      />
      <BoardDialog
        card={openId === "board" ? (byId.get("board") ?? placeholder("board")) : null}
        onClose={() => setOpenId(null)}
        returnTo={openerRef.current}
      />
    </div>
  );
}
