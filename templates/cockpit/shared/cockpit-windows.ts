/**
 * FA-19087: the cockpit's own windows, rendered by agent-native from the cockpit client (each replaces a legacy
 * window the first pass bridged through LegacyWindow). A window is a detail document, the same shape a card's
 * click window is (shared/cockpit-detail.ts CardDetail: stats, tables, lists, text and bars, with filters and
 * whole-window writes), built server-side by server/cockpit/windows/<id>.ts and read with get-window.
 */
import type { CardDetail } from "./cockpit-detail.js";

/** Every window, by the legacy page's section slug where it has one (popups.js SLUG). */
export const WINDOW_IDS = ["overview", "agents", "queue", "jev", "halosave", "balancer", "account", "push", "phone", "master", "questions", "issues", "apps"] as const;
export type WindowId = (typeof WINDOW_IDS)[number];

export const WINDOW_TITLES: Record<WindowId, string> = {
  overview: "Overview",
  agents: "Who's working",
  queue: "Commit queue",
  jev: "JEV + JevGrep savings",
  halosave: "Halo savings",
  balancer: "Balancer",
  account: "Claude account",
  push: "Push to remote",
  phone: "Phone app",
  master: "Message master",
  questions: "Console questions",
  issues: "Issues",
  apps: "Apps",
};

/** A window's document: a CardDetail whose id is a window id. */
export type WindowDetail = Omit<CardDetail, "id"> & { id: WindowId };

/** Filter arguments a window may take (each window says which in its filters; unknown keys are ignored). */
export type WindowArgs = Record<string, string | undefined>;

export const isWindowId = (s: unknown): s is WindowId => typeof s === "string" && (WINDOW_IDS as readonly string[]).includes(s);

/**
 * The windows agent-native renders itself today; every other one still opens the legacy page's window
 * (LegacyWindow) until its section lands. server/cockpit/windows/registry.spec.ts keeps this equal to the
 * registry's builders, so a window is native exactly when it has one.
 */
export const NATIVE_WINDOWS: readonly WindowId[] = ["push", "overview"];
export const isNativeWindow = (s: unknown): s is WindowId => isWindowId(s) && NATIVE_WINDOWS.includes(s);

/** The header buttons (their legacy ids, TopBar's HeaderOpen) and the window each opens. */
export const HEADER_WINDOWS: Record<string, WindowId> = { acctBtn: "account", usageBtn: "account", appsBtn: "apps", msgBtn: "master", pushBtn: "push", foPhone: "phone" };
