/**
 * FA-19174: DESIGN-SYSTEM GROUNDED VARIANTS ON A CANVAS BESIDE THE LIVE FRAME (the legacy studio-canvas.js, whole).
 *   Variants (the bar, or the Design menu through the stage handle) opens the canvas: the app's own palette as staging serves it (its
 *   colours by role: background, text, primary, accent, card, border, muted) and 2-3 variants from GET frame/_/variants: the design KB's
 *   palette on the app's roles, a WCAG AA fix of its own palette, a calmer one. Each card: what changes (old -> new swatches), its text
 *   contrast (pairs passing 4.5:1, before and after), and on a wide screen the REAL staging app in a small live frame with the variant on it.
 *   Try on the app puts it on the big frame (the frame's recolor op; Back to current takes it off); Apply to staging writes it
 *   (POST frame/_/recolor: the stylesheet gets the colours as :root role tokens, one staging commit, Undo in its toast). $0, no model.
 * Beside the frame at 1100 px and wider, a sheet over the lower half of the stage on narrower screens.
 */
import { type ReactNode, useEffect, useReducer, useRef } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, studioRead, studioWrite } from "../api";
import { changesOf, checkWords, ROLE_ORDER, type Variant, type Variants } from "./pure";

export type CanvasEnv = {
  app: string;
  appName: string;
  canWrite: boolean;
  tell: (o: Record<string, unknown>) => void;
  say: (t: string, ok?: boolean) => void;
  onStaged: () => void;
  /** the staging app's frame URL (frame/_/info staging.base) */
  stagingBase: () => string;
  /** the canvas opened or closed (the stage lays itself out beside it) */
  changed: () => void;
};

const Spin = () => <i className="ap-spin" aria-hidden="true" />;
const wideMini = () => typeof window !== "undefined" && window.innerWidth >= 1100;

/** the real staging app, small, with the variant on it (a wide screen only: each is one more load of the app) */
function Mini({ v, src, appName }: { v: Variant; src: string; appName: string }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const fr = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const fit = () => {
      if (!wrap.current || !fr.current) return;
      const w = wrap.current.clientWidth || 300;
      fr.current.style.transform = "scale(" + w / 1280 + ")";
      wrap.current.style.height = Math.round((600 * w) / 1280) + "px";
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrap.current) ro.observe(wrap.current);
    // the mini frame says ready: it gets the variant's colours
    const onMsg = (e: MessageEvent) => {
      if (!fr.current || e.source !== fr.current.contentWindow || e.origin !== location.origin || !e.data || e.data.studio !== "live" || e.data.ev !== "ready") return;
      fr.current.contentWindow!.postMessage({ studio: "live", op: "recolor", map: v.map }, location.origin);
    };
    addEventListener("message", onMsg);
    return () => {
      ro.disconnect();
      removeEventListener("message", onMsg);
    };
  }, [v]);
  return (
    <div className="ss-mini" ref={wrap}>
      <iframe ref={fr} title={appName + " with " + v.name} src={src} sandbox="allow-scripts allow-same-origin" tabIndex={-1} aria-hidden="true" loading="lazy" data-k={"cv-mini-" + v.id} />
    </div>
  );
}

export function useCanvas(env: CanvasEnv) {
  const E = useRef(env);
  E.current = env;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const S = useRef({
    open: false,
    data: null as Variants | null,
    err: null as string | null,
    loading: false,
    trying: null as string | null,
    busy: {} as Record<string, boolean>,
    msgs: {} as Record<string, { ok: boolean; text: string }>,
    gone: false,
  }).current;
  useEffect(() => {
    S.gone = false;
    return () => {
      S.gone = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    S.loading = true;
    S.err = null;
    bump();
    try {
      S.data = await studioRead<Variants>(E.current.app, "app", "frame/_/variants");
    } catch (e) {
      S.err = errText(e);
    }
    S.loading = false;
    if (!S.gone) bump();
  }
  function tryOn(v: Variant | null) {
    S.trying = v ? v.id : null;
    E.current.tell({ op: "recolor", map: v ? v.map : null });
    E.current.say(v ? "Showing " + v.name + " on the app (not saved): Apply to staging keeps it" : "Back to the current colours");
    bump();
  }
  function toggle(on: boolean) {
    S.open = on;
    bump();
    E.current.changed();
    if (!on) {
      if (S.trying) tryOn(null);
      return;
    }
    if (!S.data) load();
  }
  async function apply(v: Variant) {
    if (S.busy[v.id]) return;
    S.busy[v.id] = true;
    delete S.msgs[v.id];
    bump();
    try {
      const j = await studioWrite<{ ms?: number; files?: string[] }>(E.current.app, "app", "frame/_/recolor", { map: v.map, name: v.name });
      S.msgs[v.id] = { ok: true, text: "Saved to staging in " + (((j && j.ms) || 0) / 1000).toFixed(1) + " s, $0: " + ((j && j.files) || []).join(", ") + " (Undo in its toast)" };
      S.trying = null;
      S.data = null;
      E.current.onStaged();
      E.current.say(v.name + " applied to staging");
    } catch (e) {
      S.msgs[v.id] = { ok: false, text: errText(e) };
    } finally {
      S.busy[v.id] = false;
      if (!S.gone) bump();
    }
  }

  const barItem: ReactNode = (
    <button
      type="button"
      className="cp-btn sm ss-tool"
      data-k="ss-variants"
      aria-expanded={S.open}
      aria-controls="ss-cv"
      title={"Variants from " + env.appName + "'s own palette and the design KB: try one on the app, apply it to staging ($0, no model)"}
      onClick={() => toggle(!S.open)}
    >
      <span className="ss-ic" aria-hidden="true">
        ◐
      </span>
      Variants
    </button>
  );

  const sw = (hex: string, label?: string) => (
    <span key={hex + (label || "")} className="ss-cv-c" title={hex}>
      <i style={{ background: hex }} />
      {label || hex}
    </span>
  );
  let body: ReactNode = null;
  if (S.open) {
    if (S.loading)
      body = (
        <div role="status" className="ss-cv-why">
          <Spin /> Reading the staging stylesheets…
        </div>
      );
    else if (S.err)
      body = (
        <>
          <div className="ss-err" role="alert">
            Could not read the palette: {S.err}{" "}
          </div>
          <button type="button" className="cp-btn sm" data-k="cv-retry" onClick={() => load()}>
            Try again
          </button>
        </>
      );
    else if (S.data) {
      const d = S.data,
        pal = d.palette || {},
        roles = pal.roles || {};
      const cards = (d.variants || []).map((v) => {
        const ch = changesOf(v, pal),
          ck = checkWords(v),
          n = ch.length,
          on = S.trying === v.id,
          m = S.msgs[v.id];
        return (
          <section key={v.id} className={"ss-cv-card" + (on ? " on" : "")} data-k={"cv-card-" + v.id} aria-label={v.name}>
            <h4>{v.name}</h4>
            {v.why ? <div className="ss-cv-why">{v.why}</div> : null}
            {n ? (
              <div className="ss-cv-sw">
                {ch.slice(0, 8).map((c) => (
                  <span key={c.from} className="ss-cv-c" title={c.from + " -> " + c.to}>
                    <i style={{ background: c.from }} />→<i style={{ background: c.to }} />
                    {c.role || ""}
                  </span>
                ))}
              </div>
            ) : null}
            <div className={"ss-cv-chk " + (ck.ok ? "ok" : "bad")}>{ck.text}</div>
            {wideMini() && n && env.stagingBase() ? <Mini v={v} src={env.stagingBase()} appName={env.appName} /> : null}
            <div className="ss-row">
              <button type="button" className="cp-btn sm" data-k={"cv-try-" + v.id} aria-pressed={on} disabled={!n} onClick={() => tryOn(on ? null : v)}>
                {on ? "Back to current" : "Try on the app"}
              </button>
              <button
                type="button"
                className="cp-btn sm ss-pri"
                data-k={"cv-apply-" + v.id}
                disabled={!n || !env.canWrite || S.busy[v.id]}
                aria-busy={S.busy[v.id] || undefined}
                title={!env.canWrite ? READ_ONLY : "Write these colours into the staging copy as :root tokens (one staging commit; Undo in its toast)"}
                onClick={() => apply(v)}
              >
                {S.busy[v.id] ? <Spin /> : null}Apply to staging
              </button>
            </div>
            {m ? (
              <span className={m.ok ? "ss-ok" : "ss-err"} role={m.ok ? "status" : "alert"}>
                {m.text}
              </span>
            ) : null}
          </section>
        );
      });
      body = (
        <>
          <div className="ss-cv-why">{"Now (" + (pal.vars ? pal.vars + " root tokens" : "no tokens yet: Apply turns its colours into :root tokens") + (d.kb ? "; design KB: " + d.kb.name : "") + "):"}</div>
          <div className="ss-cv-sw" aria-label="The app's palette now">
            {ROLE_ORDER.filter((r) => roles[r]).map((r) => sw(roles[r], r))}
          </div>
          {cards.length ? cards : <p className="ss-cv-why">{env.appName}'s stylesheets name no colours to vary.</p>}
        </>
      );
    }
  }
  const panel: ReactNode = S.open ? (
    <aside className="ss-cv" id="ss-cv" aria-label={"Design variants of " + env.appName} data-k="cv">
      <div className="ss-cv-h">
        <b>Variants · from {env.appName}'s own palette</b>
        <button type="button" className="ss-x" data-k="cv-close" aria-label="Close the variants" onClick={() => toggle(false)}>
          ×
        </button>
      </div>
      {body}
    </aside>
  ) : null;

  return {
    barItem,
    panel,
    open: S.open,
    toggle,
    frameReady() {
      if (S.trying && S.data) {
        const v = (S.data.variants || []).find((x) => x.id === S.trying);
        if (v) E.current.tell({ op: "recolor", map: v.map });
      }
    },
    escape() {
      if (S.open) {
        toggle(false);
        return true;
      }
      return false;
    },
  };
}
