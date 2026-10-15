/**
 * FA-19087 (FA-19172..FA-19175): the native studio's shared plumbing. Every studio tool (the Agent chat, the action menus and
 * their dialogs, the live staging frame, the drawers) reads and writes the legacy studio's OWN routes through the cockpit
 * client (MI-379): a read is the action get-studio {app, root, path}, a write is cockpit-studio-post {app, root, path, body}
 * (the cockpit action studio.post, behind the cockpit's write gate exactly as the legacy studio is), a picture is
 * /cards/studio-file/<app>/<root>/<path>. root: app (the app's studio), qa (its QA agents), env (its environments),
 * studio (app-free). Nothing here names a cockpit route.
 */
import { callAction, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { createContext, useContext } from "react";

import type { StudioData } from "../StudioView";

export type Root = "app" | "qa" | "env" | "studio";
export type WriteRoot = "app" | "qa" | "env";

/** The cockpit's own words for a refused write, without the framework's "Action <name> failed:" prefix. */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Action [\w-]+ failed:\s*/, "");

/** One studio read, live: refetched every `every` ms while enabled (0 = no polling). */
export function useStudioRead<T = any>(app: string, root: Root, path: string, o: { enabled?: boolean; every?: number; n?: number; model?: string } = {}) {
  const params: Record<string, unknown> = { app, root, path };
  if (o.n) params.n = o.n;
  if (o.model) params.model = o.model;
  return useActionQuery<T>("get-studio", params as any, {
    enabled: o.enabled !== false,
    refetchInterval: o.every || false,
    retry: 1,
  } as any);
}
/** One studio read, imperatively (a poll loop that decides its own pace). */
export const studioRead = <T = any>(app: string, root: Root, path: string, q: { n?: number; model?: string; focus?: string } = {}) =>
  callAction<T>("get-studio" as any, { app, root, path, ...q } as any, { method: "GET" }) as Promise<T>;
/** One studio write, imperatively: resolves the studio's answer, rejects with its refusal in its own words. */
export async function studioWrite<T = any>(app: string, root: WriteRoot, path: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = (await callAction("cockpit-studio-post" as any, { app, root, path, body } as any, { method: "POST", timeoutMs: 160_000 })) as { ok: boolean; answer: T };
  return r && "answer" in r ? r.answer : (r as unknown as T);
}
/** One studio write as a mutation (its pending state drives a button). */
export function useStudioWrite<T = any>(opts: { onSuccess?: (r: T, v: { app: string; root: WriteRoot; path: string; body?: Record<string, unknown> }) => void; onError?: (e: unknown) => void } = {}) {
  return useActionMutation<{ ok: boolean; answer: T }, { app: string; root: WriteRoot; path: string; body?: Record<string, unknown> }>("cockpit-studio-post" as any, {
    timeoutMs: 160_000,
    onSuccess: (r, v) => opts.onSuccess && opts.onSuccess((r && (r as any).answer) as T, v),
    onError: (e) => opts.onError && opts.onError(e),
  });
}

/** A studio picture or file under this app's base (/cards/studio-file/<app>/<root>/<path>). */
export const studioFileSrc = (app: string, root: Root, path: string) => import.meta.env.BASE_URL.replace(/\/?$/, "/") + "studio-file/" + app + "/" + root + "/" + path;

// ---------- words (the legacy studio's own) ----------
export const usd = (v: unknown) => "$" + (Number(v) || 0).toFixed(Number(v) >= 10 ? 1 : 2);
export const dur = (ms: unknown) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s < 60 ? s + " s" : s < 3600 ? Math.floor(s / 60) + " min " + (s % 60) + " s" : Math.floor(s / 3600) + " h " + Math.round((s % 3600) / 60) + " min";
};
export const ago = (at: unknown) => {
  const t = Date.parse(String(at || ""));
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
};
export const when = (iso: unknown) => {
  const d = new Date(String(iso || ""));
  return isNaN(+d) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
export const narrowNow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 759px)").matches;

// ---------- the studio's layers ----------
/** An element picked in the live frame (Select), sent with the next chat message as a reference. */
export type FrameRef = { sel: string; label?: string; src?: string; tag?: string; text?: string; note?: string; shot?: string; page?: string; comment?: string };
/**
 * The dialogs and drawers a studio can open over itself; every tool opens another's through ctx.open (the Improve menu's
 * Decide in, the inbox's proposals, the Design menu's Add a theme -> the chat ...). One is open at a time.
 */
export type StudioLayer =
  | { kind: "chat"; prefill?: string; refs?: FrameRef[] } // FA-19172: the Agent chat
  | { kind: "lens"; id: string } // FA-19173: an Optimizer (the Improve menu)
  | { kind: "kpis" } // FA-19173: the KPI model
  | { kind: "qa"; mocks?: boolean } // FA-19173: QA agents (API mocks)
  | { kind: "design"; which: "newdesign" | "enhancedesign" } // FA-19173: New Design / Enhance Existing Design
  | { kind: "designs" } // FA-19173: Review Existing Designs
  | { kind: "checklist" } // FA-19173: the requirements (definition of done)
  | { kind: "checkpoints" } // FA-19173: checkpoints and experiments
  | { kind: "inbox" } // FA-19175: the inbox drawer
  | { kind: "details"; tab?: string }; // FA-19175: the Details drawer

/** What the live frame offers the other tools (FA-19174 registers it). */
export interface StageHandle {
  /** the staging app is live in the frame (a web app with a staging copy) */
  live: boolean;
  /** open the Variants canvas */
  variants(): void;
  /** the frame's own app theme state: kind false = one theme (base), else switchable */
  theme: { kind: boolean; base: string } | null;
  /** What changed's Show me: bring these selectors into view in the frame */
  show?(sels: string[]): Promise<unknown>;
  /** Phone (false) or Wide (true) */
  setWidth?(wide: boolean): void;
}

export interface Studio {
  app: string;
  name: string;
  s: StudioData;
  canWrite: boolean;
  /** open a dialog or drawer over the studio (closing whichever was open) */
  open(l: StudioLayer): void;
  close(): void;
  layer: StudioLayer | null;
  /** the studio's status line (role=status), as the legacy studio's say() */
  say(text: string, ok?: boolean): void;
  /** re-read the studio face (the window's own read) */
  refresh(): void;
  stage: StageHandle | null;
  setStage(h: StageHandle | null): void;
}
export const StudioCtx = createContext<Studio | null>(null);
export function useStudio(): Studio {
  const s = useContext(StudioCtx);
  if (!s) throw new Error("useStudio outside the studio");
  return s;
}

/** One item of an action menu (studio-lifecycle.js menu(): {k, label, why, disabled, run, badge, tone, busy}, or a separator / heading). */
export type MenuItem =
  | { k: string; label: string; why?: string | null; disabled?: boolean; busy?: boolean; badge?: string | number | null; tone?: string; run: () => void }
  | { sep: true }
  | { head: string };
