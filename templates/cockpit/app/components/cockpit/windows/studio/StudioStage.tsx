/**
 * FA-19174: THE STUDIO IS THE STAGING APP (the legacy studio-stage.js, whole). ONE large frame on the app's running staging server (the
 * cockpit proxies it same-origin; its URL is DATA: frame/_/info staging.base), fully interactive (clicks, forms, dialogs, navigation work as
 * in a browser). The frame is rendered at the chosen device width (375 Phone / 1440 Wide) and scaled down to the stage's width.
 * THE BAR: every control changes something visible, or is disabled with its reason: Phone | Wide sizes the frame; Dark | Light drives the
 * APP'S OWN theme (the injected frame script: its data-theme / class / theme key, or its prefers-color-scheme rules rewritten); an app with
 * one theme has no theme toggle (the Design menu proposes "Add a <other> theme" from the stage handle's theme); then the steering tools
 * (./stage/steer.tsx: Select, Mark, Comments (N)) and Variants (./stage/canvas.tsx).
 * The building bar sits IN FLOW above the app while an answered round builds in staging; a new staging sha (or a change going live)
 * re-reads the info and reloads the frame. The frame talks to the studio by postMessage (studio-live-frame.js, same origin,
 * data.studio === 'live'): ev ready / theme / changed / probed / shown and the steering reports; the studio tells it {op}.
 * When there is no live frame (not a web app, no staging copy, the staging app unreachable) the staging picture (fallback) stands in,
 * with the reason and Try again, so the studio never shows an empty box.
 */
import { type ReactNode, useCallback, useEffect, useReducer, useRef } from "react";

import { type FrameRef, narrowNow, type StageHandle, studioRead, useStudio, useStudioRead } from "./api";
import { useCanvas } from "./stage/canvas";
import { useSteer } from "./stage/steer";
import "./studio-stage.css";

type Info = { app: string; platform: string; staging: { exists: boolean; running: boolean; base: string; sha: string | null; why: string | null }; production?: { ok: boolean; base: string; sha: string | null } };
type Change = { id: string; source?: string; state: string; step?: number; pct?: number; title?: string; label?: string };
type Staged = { changes?: Change[]; running?: number; staging?: { sha?: string | null } | null };
type Ovl = { kind: "busy"; text: string } | { kind: "problem"; text: string; why?: string | null } | null;

const Spin = () => <i className="ap-spin" aria-hidden="true" />;

export function StudioStage({ fallback }: { fallback: ReactNode }) {
  const st = useStudio();
  const app = st.app,
    appName = st.name || "The app";
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const S = useRef({
    w: narrowNow() ? 375 : 1440,
    scheme: (typeof document !== "undefined" && (document.documentElement.dataset.theme === "light" || document.documentElement.classList.contains("light")) ? "light" : "dark") as "dark" | "light",
    live: null as Info | null,
    err: null as string | null,
    theme: null as { kind: boolean | string; base: string; tried?: boolean } | null,
    loads: 0,
    vars: {} as Record<string, unknown>,
    files: "",
    ovl: { kind: "busy", text: "Opening the staging app…" } as Ovl,
    frameN: 0, // the frame's key: a new one reloads it
    slow: 0 as unknown as ReturnType<typeof setTimeout>,
    showing: null as null | { token: string; res: (r: { found: number; via: string | null }) => void; rej: (e: Error) => void; t: ReturnType<typeof setTimeout> },
    sha: null as string | null,
    seen: new Map<string, number>(),
    gone: false,
  }).current;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fwrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const rbarRef = useRef<HTMLDivElement | null>(null);
  const say = st.say;

  const liveOk = () => Boolean(S.live && S.live.platform === "web" && S.live.staging && S.live.staging.exists);
  const tell = useCallback((o: Record<string, unknown>) => {
    const f = frameRef.current;
    if (f && f.contentWindow) f.contentWindow.postMessage({ studio: "live", ...o }, location.origin);
  }, []);

  // ---------- the frame: rendered at the device width, scaled to the stage
  const fit = useCallback(() => {
    const f = frameRef.current,
      wrap = fwrapRef.current,
      stage = stageRef.current;
    if (!f || !wrap || !stage) return;
    const W = S.w,
      avail = stage.clientWidth - 2,
      sc = Math.min(1, avail / W),
      rb = rbarRef.current ? rbarRef.current.offsetHeight : 0,
      H = Math.max(320, stage.clientHeight - 2 - rb); // the building bar sits above the app
    f.style.width = W + "px";
    f.style.height = Math.round(H / sc) + "px";
    f.style.transform = sc < 1 ? "scale(" + sc + ")" : "";
    wrap.style.width = Math.floor(W * sc) + "px";
    wrap.style.height = H + "px";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function show() {
    clearTimeout(S.slow);
    if (S.err) S.ovl = { kind: "problem", text: "Could not reach the staging app", why: S.err };
    else if (!liveOk())
      S.ovl = {
        kind: "problem",
        text: S.live && S.live.platform !== "web" ? appName + " is not a web app: it has no live frame here" : appName + " has no staging copy yet",
        why: S.live && S.live.staging && S.live.staging.why,
      };
    else {
      S.ovl = { kind: "busy", text: "Opening " + appName + " (staging)…" };
      S.frameN++;
      S.loads = 0;
      const n = S.frameN;
      S.slow = setTimeout(() => {
        if (S.gone || S.frameN !== n || S.loads) return;
        S.ovl = { kind: "problem", text: "The staging app did not answer in 20 s", why: "its server may be starting; Try again reloads it" };
        bump();
      }, 20000);
    }
    bump();
  }
  async function load() {
    S.ovl = { kind: "busy", text: "Opening the staging app…" };
    bump();
    try {
      S.live = await studioRead<Info>(app, "app", "frame/_/info");
      S.err = null;
    } catch (e) {
      S.err = (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");
      S.live = null;
    }
    if (S.gone) return;
    show();
  }
  // staging changed (a new sha, or a change reached live): re-read the info and reload the frame
  async function stagingLive() {
    try {
      S.live = await studioRead<Info>(app, "app", "frame/_/info");
      S.err = null;
    } catch {
      /* keep */
    }
    if (S.gone) return;
    show();
    say("Staging changed: the app shows what was built");
  }

  // ---------- the staged changes: the building bar, and a moved sha reloads the frame
  const fast = useRef(false);
  const staged = useStudioRead<Staged>(app, "app", "staged", { every: fast.current || st.s.staging.building ? 3000 : 20000 });
  const sd = staged.data;
  fast.current = Boolean(sd && (sd.running || 0) > 0);
  const round = ((sd && sd.changes) || []).find((c) => c.source === "answers" && (c.state === "queued" || c.state === "running")) || null;
  useEffect(() => {
    if (!sd) return;
    const now = sd.changes || [];
    const went = now.some((c) => {
      const was = S.seen.get(c.id);
      return was !== undefined && was !== 3 && c.step === 3;
    });
    for (const c of now) S.seen.set(c.id, c.step ?? 0);
    const sha = (sd.staging && sd.staging.sha) || null; // one reload per staging sha, whatever moved it
    const moved = Boolean(sha && S.sha && S.sha !== sha);
    if (sha) S.sha = sha;
    if ((went || moved) && S.live) stagingLive();
  }, [sd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    fit();
  }, [round ? round.id : "", round ? round.label : "", fit]);
  const onStaged = useCallback(() => {
    staged.refetch();
    st.refresh();
  }, [staged, st]);

  // ---------- the steering tools and the variants canvas
  const steer = useSteer({
    app,
    appName,
    canWrite: st.canWrite,
    tell,
    say,
    chat: (text: string, refs: FrameRef[]) => st.open({ kind: "chat", prefill: text || undefined, refs }),
    onStaged,
    vars: () => S.vars,
  });
  const canvas = useCanvas({
    app,
    appName,
    canWrite: st.canWrite,
    tell,
    say,
    onStaged,
    stagingBase: () => (S.live && S.live.staging && S.live.staging.base) || "",
    changed: () => requestAnimationFrame(fit),
  });
  const steerRef = useRef(steer);
  steerRef.current = steer;
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // ---------- the frame's reports (studio-live-frame.js)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const f = frameRef.current;
      if (!f || e.source !== f.contentWindow || e.origin !== location.origin || !e.data || e.data.studio !== "live") return;
      const d = e.data;
      if (d.ev !== "ready" && steerRef.current.onMsg(d)) return;
      if (d.ev === "ready") {
        S.vars = d.vars || {};
        steerRef.current.frameReady(d);
        canvasRef.current.frameReady();
        S.loads++;
        clearTimeout(S.slow);
        S.ovl = null;
        S.theme = { kind: d.themes || false, base: d.base || "dark" };
        if (S.theme.kind) tell({ op: "theme", scheme: S.scheme });
        bump();
        if (S.loads > 1) say(appName + " reloaded" + (S.files ? " (" + S.files + ")" : ""));
      } else if (d.ev === "theme") {
        // the app's theme mechanism did not change the page: one theme after all (the toggle goes; the Design menu proposes a theme)
        if (!d.changed && S.theme && !S.theme.tried) {
          S.theme = { kind: false, base: d.base || S.theme.base };
          bump();
          say(appName + " has one theme");
        } else {
          if (S.theme) S.theme.tried = true;
          say("The app shows its " + d.scheme + " theme");
        }
      } else if (d.ev === "changed") S.files = (d.files || []).slice(0, 3).join(", ");
      else if (d.ev === "shown") {
        const p = S.showing;
        if (p && p.token === d.token) {
          S.showing = null;
          clearTimeout(p.t);
          p.res({ found: d.found, via: d.via || null });
        }
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, [appName, say, tell]); // eslint-disable-line react-hooks/exhaustive-deps

  // WHAT CHANGED's Show me: the frame brings the changed elements into view (trying the app's tabs) and outlines them
  const showChanged = useCallback(
    (sels: string[]) =>
      new Promise<{ found: number; via: string | null }>((res, rej) => {
        if (!frameRef.current || !S.loads) return rej(new Error("The staging app is not open yet"));
        if (S.showing) {
          clearTimeout(S.showing.t);
          S.showing.rej(new Error("superseded"));
        }
        const token = "w" + Date.now();
        S.showing = {
          token,
          res,
          rej,
          t: setTimeout(() => {
            S.showing = null;
            rej(new Error("The app did not answer in 8 s"));
          }, 8000),
        };
        tell({ op: "show", sels: (sels || []).slice(0, 16), token });
      }),
    [tell], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------- mount: read the info, open the frame
  useEffect(() => {
    S.gone = false;
    load();
    return () => {
      S.gone = true;
      clearTimeout(S.slow);
    };
  }, [app]); // eslint-disable-line react-hooks/exhaustive-deps
  // the stage element comes and goes with the problem states: observe whichever is there
  const roRef = useRef<ResizeObserver | null>(null);
  const setStageEl = useCallback(
    (el: HTMLDivElement | null) => {
      stageRef.current = el;
      if (!roRef.current) roRef.current = new ResizeObserver(() => fit());
      roRef.current.disconnect();
      if (el) {
        roRef.current.observe(el);
        requestAnimationFrame(fit);
      }
    },
    [fit],
  );
  useEffect(() => () => roRef.current?.disconnect(), []);
  const setFrameEl = useCallback(
    (el: HTMLIFrameElement | null) => {
      frameRef.current = el;
      if (el) requestAnimationFrame(fit);
    },
    [fit],
  );

  // ---------- the studio's other tools reach the frame through the stage handle (the Design menu's Variants and Add a theme)
  const live = liveOk() && !S.err;
  const themeKind = S.theme ? Boolean(S.theme.kind) : null;
  const themeBase = S.theme ? S.theme.base : "";
  useEffect(() => {
    const h: StageHandle & { show: typeof showChanged; setWidth: (wide: boolean) => void } = {
      live,
      variants: () => {
        if (!canvasRef.current.open) canvasRef.current.toggle(true);
        stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
      theme: themeKind === null ? null : { kind: themeKind, base: themeBase },
      show: showChanged,
      setWidth: (wide) => {
        const w = wide ? 1440 : 375;
        if (w !== S.w) {
          S.w = w;
          fit();
          bump();
        }
      },
    };
    st.setStage(h);
  }, [live, themeKind, themeBase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => st.setStage(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc (the studio's layers ask first): the steering tray, its comments list, Select / Mark, then the variants
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[data-radix-popper-content-wrapper], .st-modal, .st-drawer")) return; // a menu or a studio layer is open: it closes first
      if (steerRef.current.escape() || canvasRef.current.escape()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => {
    fit();
  }, [S.frameN, canvas.open, fit]);

  // ---------- render
  const T = S.theme;
  const seg = (label: string, k: string, opts: [string | number, string][], val: string | number, on: (v: any) => void) => (
    <div className="cp-seg ss-seg" role="group" aria-label={label} data-k={k}>
      {opts.map(([v, l]) => (
        <button key={String(v)} type="button" aria-pressed={val === v} onClick={() => on(v)}>
          {l}
        </button>
      ))}
    </div>
  );
  const ovl = S.ovl;
  const problem = ovl && ovl.kind === "problem" ? ovl : null;
  const again = (
    <button
      type="button"
      className="cp-btn sm"
      data-k="ss-retry"
      onClick={() => {
        load();
      }}
    >
      Try again
    </button>
  );
  // no live frame at all: the staging picture with the reason
  if (S.live !== null || S.err) {
    if (!live && problem)
      return (
        <div className="ss ss-off" role="region" aria-label={appName + " staging app"} data-k="ss">
          {fallback}
          <div className="ss-prob" role="alert" data-k="ss-problem">
            <b>{problem.text}</b>
            {problem.why ? <p className="ss-why">{problem.why}</p> : null}
            {again}
          </div>
        </div>
      );
  }
  return (
    <div className={"ss" + (canvas.open ? " cv-on" : "")} role="region" aria-label={appName + " staging app, live"} data-k="ss">
      <h4 className="sr-only">{appName}, the staging app</h4>
      <div className="ss-bar" role="toolbar" aria-label={appName + ": the staging app's tools"} data-k="ss-bar">
        {seg(
          "Device width",
          "ss-width",
          [
            [375, "Phone"],
            [1440, "Wide"],
          ],
          S.w,
          (v: number) => {
            S.w = v;
            fit();
            bump();
            say(v === 375 ? "Phone width" : "Wide");
          },
        )}
        {!(T && T.kind === false)
          ? seg(
              "App theme",
              "ss-theme",
              [
                ["dark", "Dark"],
                ["light", "Light"],
              ],
              S.scheme,
              (v: "dark" | "light") => {
                S.scheme = v;
                tell({ op: "theme", scheme: v });
                bump();
              },
            )
          : null}
        {live ? (
          <>
            {steer.barItems}
            {canvas.barItem}
          </>
        ) : null}
      </div>
      <div className="ss-body">
        <div className="ss-stage" ref={setStageEl} data-k="ss-stage" aria-busy={ovl && ovl.kind === "busy" ? true : undefined}>
          {round ? (
            <div className="ss-rbar" role="status" data-k="ss-rbar" ref={rbarRef}>
              <b>Building in staging</b>
              <span>{(round.title || "") + " · " + (round.label || "")}</span>
              <span className="ss-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={round.pct || 0} aria-label={"Building in staging: " + (round.title || "")}>
                <i style={{ width: (round.pct || 0) + "%" }} />
              </span>
            </div>
          ) : null}
          {live && S.frameN ? (
            <div className="ss-fwrap" ref={fwrapRef}>
              <iframe
                key={S.frameN}
                ref={setFrameEl}
                className="ss-frame"
                data-k="sm-live-frame"
                data-env="staging"
                title={appName + ", the staging app, live and interactive"}
                src={S.live!.staging.base}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
                referrerPolicy="same-origin"
              />
            </div>
          ) : null}
          {ovl ? (
            <div className="ss-ovl" role="status" data-k="ss-ovl">
              {ovl.kind === "busy" ? (
                <div>
                  <Spin />
                  <b>{ovl.text}</b>
                </div>
              ) : (
                <div role="alert">
                  <b>{ovl.text}</b>
                  {ovl.why ? <p className="ss-why">{ovl.why}</p> : null}
                  {again}
                </div>
              )}
            </div>
          ) : null}
          {live ? steer.tray : null}
          {live ? steer.pop : null}
        </div>
        {live ? canvas.panel : null}
      </div>
    </div>
  );
}
