import { describe, expect, it } from "vitest";

import { jevBuildCard, jevCard, jevReplay, jevTable, jevWindow } from "./jev";

const g0 = { runs: 4, skipped: 0, withFiles: 2, usdSaved: null, leadFedSessions: 0, p50ms: 4000, p95ms: 9000, cost: { wallMin: 3, usdWhy: "not metered" } };
const j0 = { verdicts: 0, lifts: 0, escalations: 0, holds: 0, refused: 0, sessionsAvoided: 0, usdAvoided: 0, minutesSaved: 0 };
const savings = {
  at: "2026-10-15T04:49:58.673Z",
  window: "local midnight",
  today: { usdSaved: 0, jev: j0, jevgrep: g0 },
  week: { usdSaved: 1.11, jev: { ...j0, verdicts: 48, lifts: 6 }, jevgrep: g0 },
  days: [
    { day: "2026-10-14T04:00:00.000Z", usdSaved: 1.11, jevUsd: 1.1086, jgUsd: null, jgRuns: 4, lifts: 6 },
    { day: "2026-10-15T04:00:00.000Z", usdSaved: 0, jevUsd: 0, jgUsd: null, jgRuns: 0, lifts: 0 },
  ],
  series: {
    live: [{ date: "2026-10-14", workload: "route", usdSaved: 3.3, source: "live" }],
    replay: [
      { date: "2026-10-14", workload: "route", n: 10, accuracy: 1, tau: "0.67/0.41", usdSaved: 1.6, costUsd: 0.1, source: "replay" },
      { date: "2026-10-15", workload: "kitfail", n: 5, usdSaved: null, source: "replay" },
    ],
  },
  workloads: [],
  replayCost: { usd: 0.141453, judgments: 220345 },
  workloadTable: {
    headline: { liveUsdPerDay: 0.4865, liveDays: 7, replayUsdPerDay: 1.596, replayWorkloads: ["route"] },
    replayCost: { usd: 0.141453, judgments: 220345 },
    rows: [{ workload: "route", liveSay: "saved $3.30 est. · detail", replaySay: "would have saved $1.60", accuracy: 1, tau: "0.67/0.41", n: 73, calibrated: true, calibratedAt: "2026-10-08T23:48:00Z", historySay: "replayed: 3 days" }],
  },
  price: { sessionUsd: 0.21, n: 461, sessionsPerRound: 2 },
  leadEffect: { sessions: 133, withLeads: 6, late: 30, minN: 5, perSession: null, confidence: "no number", classes: [{ cls: "system/fix/M", nLeads: 0, nNone: 19, matched: false, saved: { usd: null } }] },
  failures: { today: { neverAsked: 0, notes: { neverAsked: "direct-edit fixer runs" } }, week: { neverAsked: 770 } },
  opportunities: { today: [{ where: "a", uses: "neither", n: 1, usd: 0.5 }, { where: "b", uses: "x", n: 2, usd: 3, usdWhy: "upper bound" }], week: [] },
  jevState: { runsInLane: false, why: "retired" },
  levers: { tier: { moves: 0, verifiedUsd: 0, unverifiedUsd: 0, trial: { n: 0 }, jev: { n: 0 }, policy: { n: 0 } }, points: [{ state: "live" }, { state: "shadow" }], jevgrep: { usdSaved: -2.35 }, projection: { projected: 0, ifTierHolds: 0 } },
};
const build = { line: "JEV assimilation build: 2 assimilate", ageMin: 5, rows: [{ repo: "a/b", lever: "tier", state: "measured", units: [{ id: "A3", state: "measured", sha: "7032f97", effect: "live 10-09" }] }, { repo: "c/d", lever: "tier", state: "queued", units: [] }] };
const home = {
  savedAll: { jevToday: { headline: "1.6% saved today", vs: "$0.01 saved of $0.62 without it", why: "w" } },
  saveForecast: { total: { days: 9, claude: 100, jev: 3, halo: 11, perDay: { claude: 10 } }, days: [{ day: "2026-10-14", jev: { usd: 2 } }] },
};
const sys = { groups: [{ rows: [{ id: "claude.savedShare", value: "0.5%", target: "50%", drivers: ["jev.savedUsd"], tone: "r" }, { id: "claude.savedShare.jev", value: "0%" }] }] };

describe("FA-19132: the JEV + JevGrep savings window", () => {
  it("leads with the legacy jvHead / jvWhy / jvFace lines", () => {
    const d = jevWindow(savings, build, home, sys, 1, true);
    expect(d.headline).toBe("No measured saving yet today");
    expect(d.tone).toBe("a");
    expect(d.sub).toMatch(/^JEV: 0 verdicts today \(it does not run in the maintenance lane\) · JevGrep: no number · computed \d\d:\d\d, window: local midnight$/);
    expect(d.lead).toBe(
      "JEV · 0 lifts · $0.00 avoided · no $ yet · JevGrep · 2/4 runs gave leads · 50% hit · $ not measured · Tier: 0 runs off Opus today ~$0.00 (trial 0 / JEV 0 / policy 0) · Points: 1/2 live · JevGrep $-2.35 vs own no-lead runs · Projected $0.00/day ($0.00 if tier holds)",
    );
    expect(d.chips).toEqual([{ t: "1.6% saved today" }]);
  });
  it("carries the Claude-spend KPI with its JEV part, drivers and the if-online line", () => {
    const c = jevWindow(savings, build, home, sys, 1, true).sections[0];
    expect(c.title).toBe("Claude spend avoided by Halo + JEV");
    expect(c.sub).toBe("0.5% (target 50%)");
    expect(c.text).toBe("JEV part: 0% · drivers: jev.savedUsd · if online (9 d): JEV 3.0%, together 14.0%, 36.0 points short of 50% = $4 a day");
  });
  it("keeps live and replay apart, per workload and per day", () => {
    const m = jevReplay(savings);
    expect(m.has).toBe(true);
    expect(m.replayUsd).toBe(1.6);
    expect(m.days.find((x) => x.day === "2026-10-15")!.insufficient).toBe(1);
    expect(jevCard(savings).rp).toBe("would have saved $1.60 (replay, 2 days)");
    const t = jevTable(savings);
    expect(t.head).toMatch(/^Going forward: \$0.49\/day saved live \(7 days; estimates vs the incumbent\) · replay-implied \$1.60\/day/);
    expect(t.rows[0][6]).toBe("calibrated 10-08 23:48");
    const sec = jevWindow(savings, build, home, sys, 1, true).sections.find((s) => s.title === "Live vs replay per workload")!;
    expect(sec.rows![0].cells[1]).toEqual({ t: "saved $3.30 est. …", title: "saved $3.30 est. · detail" });
    expect(sec.rows![0].cells.length).toBe(7);
    expect(sec.rows![0].note).toBe("History: replayed: 3 days");
  });
  it("draws the per-day pairs: live beside the forecast, never added", () => {
    const b = jevWindow(savings, build, home, sys, 1, true).sections.find((s) => s.kind === "bars")!;
    expect(b.bars!.map((x) => x.value)).toEqual(["$1.11", "$2.00", "$0.00", "n/a"]);
    expect(b.bars![1].frac).toBe(1);
  });
  it("lists the opportunities by potential $, today open and 7 days collapsed", () => {
    const secs = jevWindow(savings, build, home, sys, 1, true).sections;
    const today = secs.find((s) => s.title === "Opportunities · today")!;
    expect(today.rows!.map((r) => r.cells[0])).toEqual(["b", "a"]);
    expect(today.rows![0].cells[3]).toEqual({ t: "$3.00 ⓘ", title: "upper bound" });
    const week = secs.find((s) => s.title === "Opportunities · 7 days")!;
    expect(week.collapsed).toBe(true);
    expect(week.rows).toEqual([]);
    expect(week.empty).toBe("none listed for this window");
  });
  it("shows the library build state with its tones", () => {
    const b = jevBuildCard(build);
    expect(b.head + " · " + b.why).toBe("JEV assimilation build: 2 assimilate · synced 5 min ago");
    expect(b.rows[0].units).toBe("A3 measured 7032f97");
    expect(b.rows.map((r: { tone?: string }) => r.tone)).toEqual(["g", undefined]);
    expect(jevBuildCard({ error: "down" }).head).toBe("Build state not available");
    const long = { ...build, rows: [{ repo: "e/f", lever: "tier", state: "rejected", units: [{ id: "A5", state: "rejected", why: "x".repeat(399) + "…" }] }] };
    expect(jevWindow(savings, long, home, sys, 1, true).sections.find((x) => x.title === "Not shown yet")!.text).toBe("1 build note is cut at 400 characters by the cockpit client (jevbuild units[].why); the full text shows once the client carries it.");
  });
  it("says the data is not there yet rather than failing", () => {
    const d = jevWindow({ error: "HTTP 502" }, null, {}, {}, 1, false, "jevsavings: down");
    expect(d.headline).toBe("Savings data not available yet");
    expect(d.sub).toBe("the jevsavings resource answered: HTTP 502");
    expect(d.sections.find((s) => s.title === "Breakdown")!.empty).toBe("Savings data not available yet");
    expect(d.sections[0].sub).toBe("not measured yet");
  });
});
