/**
 * FA-19173: studio-lifecycle.js menu(), natively: a disclosure menu of actions. The button carries a caret and, optionally, a badge;
 * its popover (role=group) holds items (a label, a why line under it), separators and headings. A disabled item keeps its reason
 * (aria-disabled, focusable, its why still read). Esc closes it and returns focus to its button (and never the studio's window under
 * it), ArrowUp / ArrowDown move through the items, a press outside closes it, choosing an item closes it and runs it. One menu (or
 * the gear) is open at a time: the parent holds which.
 */
import { useEffect, useId, useRef } from "react";

import type { MenuItem } from "../api";

export type MenuOpts = { badge?: string | number | null; badgeTone?: string; badgeK?: string; title?: string; right?: boolean };

/** Esc, while a popover is open, is the popover's alone: caught before the studio's window (a dialog listening on the document) sees it. */
export function useEscape(on: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!on) return;
    const f = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener("keydown", f, true);
    return () => window.removeEventListener("keydown", f, true);
  }, [on]);
}
/** A press outside `el` while open closes it. */
export function useOutside(on: boolean, el: React.RefObject<HTMLElement | null>, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!on) return;
    const f = (e: PointerEvent) => {
      if (el.current && e.target instanceof Node && el.current.contains(e.target)) return;
      ref.current();
    };
    document.addEventListener("pointerdown", f, true);
    return () => document.removeEventListener("pointerdown", f, true);
  }, [on, el]);
}

export function Spin() {
  return <i className="ap-spin sm-spin" aria-hidden="true" />;
}

export function Menu({ label, k, items, opts = {}, open, setOpen }: { label: string; k: string; items: (MenuItem | null | false | undefined)[]; opts?: MenuOpts; open: string | null; setOpen: (k: string | null) => void }) {
  const on = open === k;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = (focus: boolean) => {
    setOpen(null);
    if (focus) btn.current?.focus();
  };
  useEscape(on, () => close(true));
  useOutside(on, wrap, () => close(false));
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => pop.current?.querySelector<HTMLElement>('.sm-item:not([aria-disabled="true"])')?.focus(), 0);
    return () => clearTimeout(t);
  }, [on]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const xs = [...(pop.current?.querySelectorAll<HTMLElement>(".sm-item") || [])];
    const i = xs.indexOf(document.activeElement as HTMLElement);
    const nx = xs[(i + (e.key === "ArrowDown" ? 1 : -1) + xs.length) % xs.length];
    nx?.focus();
  };
  const popId = "sm-pop-" + k + "-" + uid;
  return (
    <div className="sm-menu" data-k={"menuwrap-" + k} ref={wrap}>
      <button
        ref={btn}
        type="button"
        className="cp-btn sm-mbtn"
        data-k={"menu-" + k}
        aria-expanded={on}
        aria-controls={popId}
        title={opts.title || undefined}
        onClick={() => setOpen(on ? null : k)}
      >
        {label}
        {opts.badge ? (
          <span className={"ap-chip sm-badge t-" + (opts.badgeTone || "a")} data-k={opts.badgeK || undefined}>
            {String(opts.badge)}
          </span>
        ) : null}
        <span className="sm-caret" aria-hidden="true" />
      </button>
      <div ref={pop} className={"sm-pop" + (opts.right ? " right" : "")} id={popId} role="group" aria-label={label} hidden={!on} onKeyDown={onKey} data-k={"pop-" + k}>
        {on
          ? items.filter(Boolean).map((it, i) => {
              const x = it as MenuItem;
              if ("sep" in x) return <div key={"s" + i} className="sm-sep" role="separator" />;
              if ("head" in x)
                return (
                  <div key={"h" + i} className="sm-mh" role="presentation">
                    {x.head}
                  </div>
                );
              const wid = "sm-w-" + uid + "-" + x.k;
              return (
                <button
                  key={x.k}
                  type="button"
                  className="sm-item"
                  data-k={"mi-" + x.k}
                  aria-disabled={x.disabled ? "true" : undefined}
                  aria-describedby={x.why ? wid : undefined}
                  onClick={() => {
                    if (x.disabled) return;
                    close(false);
                    x.run();
                  }}
                >
                  <span className="l">
                    {x.busy ? <Spin /> : null}
                    {x.label}
                    {x.badge ? <span className={"ap-chip t-" + (x.tone || "a")}>{String(x.badge)}</span> : null}
                  </span>
                  {x.why ? (
                    <span className="w" id={wid}>
                      {x.why}
                    </span>
                  ) : null}
                </button>
              );
            })
          : null}
      </div>
    </div>
  );
}
