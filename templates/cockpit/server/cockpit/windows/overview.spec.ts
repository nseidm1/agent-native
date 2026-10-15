import { describe, expect, it } from "vitest";

import { strictChip, strictLevel, strictSteps, wantFlip, wantLevel } from "../../../shared/cockpit-strict";
import { dur, landCardNote, mName, overviewWindow } from "./overview";

const ALL = { drafterFloor: true, auditors: true, review: true, suite: true, kick: true, shipping: true, releaseGate: true, batch: true, brief: true, sendBack: true };
const status = {
  driver: { up: true, uptimeMs: 20945000, max: 1, paused: null, maintenance: true, draining: false, throttled: true },
  lander: { up: true, state: "idle", halt: false },
  landCheck: { on: true, running: [], queue: [] },
  halo: { up: 6, total: 6, failed: [], haloDrafters: 0, vitalsOk: true },
  switches: { haloDrafters: false, profile: null, relevanceApply: false, modeOverrides: {} },
  frontier: { effective: { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" } },
  queue: [],
  capacity: {
    cardsAtOnce: 2,
    idle: {
      slots: 2,
      reasons: [
        { text: "new work is paused while the Mac is busy", cards: [] },
        { text: "7 cards with no agent", cards: ["FA-1", "FA-2"] },
      ],
    },
  },
  strict: ALL,
};

describe("FA-19130: the Overview window", () => {
  it("says what the legacy Overview says: chips, hint, idle reasons and the pills, in order", () => {
    const d = overviewWindow({ status, jobs: { schedules: [] }, home: { hotRedGreen: { share: 1, of: 304 } } }, 1, true);
    expect(d.chips.map((c) => c.t)).toEqual(["Production", "paused (Mac busy)", "releases idle", "pre-release check on", "Halo 6 running of 6 enabled", "0 in the work list"]);
    expect(d.tone).toBe("a");
    expect(d.lead).toBe("Up to 2 cards can be worked on at once. New work is paused because the Mac is busy.");
    expect(d.sections[0].items!.map((i) => i.text)).toEqual(["new work is paused while the Mac is busy", "7 cards with no agent (FA-1 FA-2)"]);
    const pills = d.sections[1].stats!;
    expect(pills.map((p) => p.label)[0]).toBe("Maintenance driver");
    expect(pills[0]).toMatchObject({ value: "paused (Mac busy) · for 5h49m · up to 1 cards at once", tone: "a" });
    expect(pills.map((p) => p.value).slice(1)).toEqual([
      "idle",
      "on · nothing being checked · 0 waiting",
      "6 running of 6 enabled · 0 writers",
      "off",
      "default",
      "preview only",
      "none",
      "Opus 5.5",
      "Sonnet 5.5",
      "Haiku 5.5",
      "0 in the work list (being worked included)",
    ]);
    expect(d.sections.map((s) => s.title).slice(2)).toEqual(["Hot system fixes", "System cards", "Production cards"]);
    expect(d.sections[2].items![d.sections[2].items!.length - 1].text).toBe("Today: 100% of 304 hot commits proven red/green.");
    expect(d.sections[3].sub).toMatch(/· starting: the land-card job is not registered yet$/);
    expect(d.strict).toEqual(ALL);
  });
  it("leaves the idle box out when no slot is idle, and reads a missing status as stopped", () => {
    const d = overviewWindow({}, 1, false, "down");
    expect(d.tone).toBe("r");
    expect(d.sections[0].title).toBe("The lane now");
    expect(d.strict).toBeNull();
    expect(d.sections[d.sections.length - 1].text).toMatch(/not in the status reading yet/);
  });
  it("names the land-card job's last run", () => {
    expect(landCardNote({ schedules: [{ name: "land-card", enabled: false }] })).toBe("starting: the land-card job is registered but switched off");
    expect(landCardNote({ schedules: [{ name: "land-card", enabled: true, lastEnd: "2026-10-15T03:55:29Z", lastStatus: "fail" }] })).toMatch(/^land-card last ran \d\d:\d\d \(fail\)$/);
  });
  it("keeps the legacy helpers' words", () => {
    expect(dur(59_000)).toBe("59s");
    expect(dur(125_000)).toBe("2m05s");
    expect(dur(3 * 86400e3)).toBe("3d0h");
    expect(mName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(mName(null)).toBe("—");
  });
});

describe("FA-19130: production strictness (the stepper)", () => {
  it("reads the level, and custom when set by hand", () => {
    expect(strictLevel(ALL)).toBe(7);
    expect(strictChip(ALL)).toEqual({ text: "Strictness 7 of 7", tone: "s" });
    const three = wantLevel(ALL, 3);
    expect(strictLevel(three)).toBe(3);
    expect(strictLevel({ ...ALL, batch: false })).toBeNull();
    expect(strictChip({ ...ALL, batch: false }).text).toBe("Strictness 6 of 7 · custom");
    expect(strictChip(wantLevel(ALL, 0))).toEqual({ text: "Strictness 0 of 7", tone: "a" });
  });
  it("sends one write per gate that changes: ons safest first, offs least-safe first", () => {
    expect(strictSteps(ALL, ALL)).toEqual([]);
    expect(strictSteps(ALL, wantLevel(ALL, 5))).toEqual([
      { gate: "sendBack", on: false },
      { gate: "brief", on: false },
      { gate: "drafterFloor", on: false },
    ]);
    const zero = wantLevel(ALL, 0);
    expect(strictSteps(zero, wantLevel(zero, 2))).toEqual([
      { gate: "releaseGate", on: true },
      { gate: "shipping", on: true },
    ]);
    expect(strictSteps(ALL, wantFlip(ALL, ["suite", "kick"]))).toEqual([
      { gate: "kick", on: false },
      { gate: "suite", on: false },
    ]);
  });
});
