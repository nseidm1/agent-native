import { describe, expect, it } from "vitest";

import { agentsWindow, exFoot, exHeader, fineAge, modeLabel } from "./agents";
import { queueWindow } from "./queue";

const NOW = 1_800_000_000_000;
const shape = {
  mode: "maintenance",
  who: {
    rows: [
      { id: "sub:1", kind: "subagent", fa: "FA-18951", cardKind: "hot", title: "Fork: Ask agent", model: "inherit", host: "Mac", startedAt: NOW - 8_700_000, state: "working", usd: null },
      {
        id: "door:2",
        kind: "door",
        name: "ui-builder",
        fa: "FA-2",
        title: "Build it",
        step: "proving",
        startedAt: NOW - 20 * 60e3,
        estMin: 5,
        tier: "sonnet",
        attempt: 2,
        host: "Halo",
        usd: 0.004,
        subagents: [{ id: "s1", type: "Explore", title: "find the code", state: "done", startedAt: NOW - 65_000, model: "haiku" }],
      },
      { id: "m", kind: "master", title: "Master", host: "Mac", usd: 0, ageMs: 5000 },
    ],
    groups: ["subagent", "door", "master"],
    totals: { subagent: { n: 179 }, engine: { n: 0 }, lander: { n: 8, hot: 0 }, doors: { n: 11, halo: 8, mac: 3, usd: 0.61 }, haloVsPaid: { halo: 2, paid: 3, haloShare: 0.4, of: "door mechanical steps" } },
    header: { used: 0, free: 0, next: [{ fa: "FA-9", title: "a very long title that goes past twenty-eight" }], sinceLandMin: 2, queued: 1, failed: 0, remedies: { "restarted-cockpit": 1 } },
  },
};

describe("FA-19131: Who's working", () => {
  it("lists every row and its subagents with the legacy words, grouped by kind", () => {
    const d = agentsWindow(shape, 1, true, undefined, NOW);
    expect(d.headline).toBe("Everyone working: 3 · production off");
    const rows = d.sections[1].rows!.map((r) => r.cells.map((c) => (typeof c === "string" ? c : c.t)));
    expect(rows[0]).toEqual(["App subagents", "FA-18951 hot · Fork: Ask agent", "working", "2h 25m", "inherit", "Mac", "-"]);
    expect(rows[1]).toEqual(["ui-builder", "FA-2 Build it", "proving", "20m 00s", "try 2 · sonnet", "Halo", "$0.004"]);
    expect(d.sections[1].rows![1].tone).toBe("r"); // 4x its 5 min estimate
    expect(rows[2]).toEqual(["Subagent · Explore", "↳ find the code", "done", "1m 05s", "haiku", "Halo", "-"]);
    expect(rows[3]).toEqual(["Master", "Master", "-", "5s", "-", "Mac", "-"]);
  });
  it("says the header line and the day's totals", () => {
    expect(exHeader(shape.who.header).map((s) => s.label + " " + s.value)).toEqual([
      "Slots 0 in use, 0 free",
      "Next FA-9 a very long title that goes…",
      "Last landing 2 min ago",
      "Commit queue 1",
      "Last 30 min none failed · 1 restarted cockpit",
    ]);
    expect(exFoot(shape.who.totals)).toBe("Today: 11 door runs (8 on the Halo, 3 on the Mac, $0.61) · 179 subagent runs · 8 landed (0 hot) · Halo share of door mechanical steps 40% (2 of 5)");
    expect(fineAge(42_000)).toBe("42s");
    expect(modeLabel("production")).toBe("production on");
  });
  it("says nobody is working, and a missing shape is an error, never a throw", () => {
    expect(agentsWindow({ who: { rows: [] } }, 1, true).sections[1].rows).toEqual([]);
    expect(agentsWindow(null, 1, false).error).toMatch(/not in the home reading/);
  });
});

describe("FA-19131: the commit queue", () => {
  it("shows the cockpit's queue text whole, with the counts as the headline", () => {
    const d = queueWindow({ view: { queued: [{}], landed: [{}, {}] }, text: "QUEUED FOR COMMIT (1)\n  a  b" }, 1, true);
    expect(d.headline).toBe("1 set queued for commit · 2 landed today");
    expect(d.sections[0]).toMatchObject({ kind: "text", text: "QUEUED FOR COMMIT (1)\n  a  b" });
  });
  it("says when the queue view is not available", () => {
    expect(queueWindow(null, 1, false, "down").sections[0].text).toBe("The queue view is not available: down");
  });
});
