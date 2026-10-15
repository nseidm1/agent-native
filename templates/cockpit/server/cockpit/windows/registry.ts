/**
 * FA-19087: the window registry. get-window reads one window by id; each builder reads the cockpit client
 * (../client.ts) and returns a WindowDetail. A window with no builder yet answers a document that says so
 * (and the page keeps opening the legacy window for it), never a throw.
 */
import type { WindowArgs, WindowDetail, WindowId } from "../../../shared/cockpit-windows.js";
import { WINDOW_TITLES } from "../../../shared/cockpit-windows.js";

export type WindowBuilder = (args: WindowArgs) => Promise<WindowDetail>;

/** One line per window: its builder module (each exports default a WindowBuilder). */
const BUILDERS: Partial<Record<WindowId, () => Promise<WindowBuilder>>> = {
  push: () => import("./push.js").then((m) => m.default),
  overview: () => import("./overview.js").then((m) => m.default),
  agents: () => import("./agents.js").then((m) => m.default),
  queue: () => import("./queue.js").then((m) => m.default),
};

/** The ids with a builder: the page renders these natively, the rest still open the legacy window. */
export const nativeWindows = (): WindowId[] => Object.keys(BUILDERS) as WindowId[];

export async function getWindow(id: WindowId, args: WindowArgs = {}): Promise<WindowDetail> {
  const load = BUILDERS[id];
  if (!load) return blankWindow(id, "This window is not rendered here yet.");
  try {
    return await (await load())(args);
  } catch (e) {
    return blankWindow(id, "Could not build this window: " + (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

export function blankWindow(id: WindowId, error: string): WindowDetail {
  return { id, title: WINDOW_TITLES[id], tone: "d", headline: "", sub: "", chips: [], at: Date.now(), ok: false, error, sections: [] };
}
