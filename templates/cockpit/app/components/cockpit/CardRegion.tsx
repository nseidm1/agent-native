import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
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

const GLYPH: Record<Tone, string> = { g: "✓", a: "⚠", r: "✕", d: "–" };
const TONE_WORD: Record<Tone, string> = { g: "ok", a: "needs attention", r: "broken", d: "no data" };
const COLLAPSE_KEY = "cockpit.cards.collapsed";

/** Tells the cockpit (the parent window) to open its own dialog for a card. */
function openInCockpit(id: CardId) {
  try {
    window.parent.postMessage({ type: "cockpit-open", sec: id }, "*");
  } catch {
    // no parent (opened directly): nothing to open
  }
}

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

function Card({ card, size, fill }: { card: CockpitCard; size?: string; fill?: boolean }) {
  const label = `${card.title}: ${card.headline}. ${card.sub}${card.chip ? `. ${card.chip}` : ""}. Status ${TONE_WORD[card.tone]}. Opens details in the cockpit.`;
  return (
    <button
      type="button"
      className={`cp-card t-${card.tone}${size === "l" ? " sz-l" : fill ? " fill" : ""}`}
      data-card={card.id}
      aria-label={label}
      title={`${card.headline} · ${card.sub}`}
      onClick={() => openInCockpit(card.id)}
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

function AskPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ text: string; changed: boolean } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ask = useActionMutation<{ answer: string; layoutChanged: boolean }, { question: string }>("ask-agent", {
    timeoutMs: 135_000,
    onSuccess: (r) => {
      setAnswer({ text: r.answer, changed: r.layoutChanged });
      void qc.invalidateQueries();
    },
  });
  useEffect(() => ref.current?.focus(), []);
  const send = () => {
    const q = question.trim();
    if (!q || ask.isPending) return;
    setAnswer(null);
    ask.mutate({ question: q });
  };
  return (
    <div
      className="cp-ask"
      role="dialog"
      aria-label="Ask the cockpit agent"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <label htmlFor="cp-ask-q">Ask the agent to read or rearrange these cards</label>
      <div className="cp-ask-row">
        <textarea
          id="cp-ask-q"
          ref={ref}
          rows={1}
          maxLength={2000}
          value={question}
          placeholder="e.g. move Halo to the top of Models & compute"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="cp-btn" onClick={send} disabled={ask.isPending || !question.trim()}>
          {ask.isPending ? "Asking…" : "Send"}
        </button>
      </div>
      {ask.isPending ? (
        <div className="cp-ask-out busy" aria-live="polite">
          The agent is working (up to 2 minutes)…
        </div>
      ) : ask.isError ? (
        <div className="cp-ask-out err" role="alert">
          {ask.error instanceof Error ? ask.error.message : String(ask.error)}
        </div>
      ) : answer ? (
        <>
          <div className="cp-ask-out" aria-live="polite">
            {answer.text}
          </div>
          <div className="cp-ask-meta">{answer.changed ? "Layout changed." : "Layout unchanged."}</div>
        </>
      ) : null}
    </div>
  );
}

export function CardRegion() {
  const cardsQ = useActionQuery<CardsResult>("get-cards", {}, { refetchInterval: 3000 });
  const layoutQ = useActionQuery<CockpitLayout>("get-layout", {}, { refetchInterval: 5000 });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [askOpen, setAskOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
        : { text: "live · " + new Date(result.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), stale: false };

  return (
    <div className="cp-region" ref={rootRef} data-testid="cockpit-region">
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
                <Card key={c.id} card={c} size={layout.size[c.id]} fill={i === fillIndex} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
