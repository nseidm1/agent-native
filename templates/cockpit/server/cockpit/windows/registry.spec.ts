import { describe, expect, it } from "vitest";

import { NATIVE_WINDOWS, WINDOW_IDS } from "../../../shared/cockpit-windows";
import { getWindow, nativeWindows } from "./registry";

describe("FA-19087: the window registry", () => {
  it("renders natively exactly the windows that have a builder", () => {
    expect([...nativeWindows()].sort()).toEqual([...NATIVE_WINDOWS].sort());
    for (const id of NATIVE_WINDOWS) expect(WINDOW_IDS).toContain(id);
  });
  it("answers a window with no builder with a document that says so, never a throw", async () => {
    const missing = WINDOW_IDS.find((id) => !NATIVE_WINDOWS.includes(id));
    if (!missing) return;
    const d = await getWindow(missing);
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/not rendered here yet/);
  });
});
