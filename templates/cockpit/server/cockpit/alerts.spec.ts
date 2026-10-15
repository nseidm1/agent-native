import { describe, expect, it } from "vitest";

import { alertToasts } from "./alerts";

const NOW = Date.parse("2026-10-15T05:00:00Z");
const at = "2026-10-15T04:58:00Z";

describe("FA-19135: the forge alert toasts", () => {
  it("words each alert as the legacy page does, with its remedy line", () => {
    const t = alertToasts(
      {
        alertRemedies: { kb: { handled: true, line: "→ fixing on the Halo" } },
        fleetBlockers: { at, active: [{ sig: "kb", agents: ["a1"], remedy: "restarting", tier: "banner" }], parked: [{ sig: "pk", remedy: "until Monday" }] },
        contradictions: { at, found: [{ key: "c1", why: "two masters", act: "page" }, { key: "c2", why: "quiet", act: "log" }] },
        serviceHealth: { at, active: [{ sig: "svc1", why: "board slow", tier: "toast" }] },
        laneChecks: { at, checks: { suite: { active: [{ sig: "lc1", why: "suite red" }] } } },
      },
      { flags: [{ id: "pace-off", why: "over budget" }], notes: [{ id: "swap-not-ready", why: "no second account" }] },
      NOW,
    );
    expect(t.map((x) => x.words)).toEqual([
      "⚠ board slow → remedy not verified yet",
      "⚠ suite red → remedy not verified yet",
      "⛔ Fleet blocker: kb — a1 restarting → fixing on the Halo",
      "⏸ Parked fleet blocker: pk · until Monday",
      "⚠ Lane contradiction: two masters → remedy not verified yet",
      "⚠ Budget pace: pace off — over budget",
      "Budget pace: swap not ready — no second account",
    ]);
    expect(t.map((x) => x.bad)).toEqual([false, true, true, false, true, true, false]);
    expect(t[6].note).toEqual({ id: "swap-not-ready", why: "no second account" });
  });
  it("drops stale alerts (older than 10 minutes) and held remedies in maintenance", () => {
    const old = "2026-10-15T04:40:00Z";
    expect(alertToasts({ fleetBlockers: { at: old, active: [{ sig: "x" }] }, serviceHealth: { at: old, active: [{ sig: "y", why: "w" }] } }, null, NOW)).toEqual([]);
    const held = alertToasts({ driver: { maintenance: true }, serviceHealth: { at, active: [{ sig: "h", why: "w", state: "held", fa: "FA-1" }] } }, null, NOW);
    expect(held).toEqual([]);
  });
});
