import { describe, expect, it } from "vitest";

import { CARD_IDS } from "../../shared/cockpit";
import { mapState } from "./cards";

describe("mapState", () => {
  it("returns all 14 cards, tone d and no data, for an empty state, never throwing", () => {
    for (const j of [null, {}, { scorecard: 5, board: "x", halo: [] }]) {
      const cards = mapState(j);
      expect(cards.map((c) => c.id)).toEqual([...CARD_IDS]);
      for (const c of cards) expect(c.tone).toBe("d");
    }
  });

  it("maps the scorecard, board, jobs and halo in the cockpit's words", () => {
    const now = Date.parse("2026-10-15T01:00:00Z");
    const cards = mapState(
      {
        scorecard: { landed: 12, byHour: [1, 3, 8], units: { today: { n: 14 } }, velocity: { finishedPerHour: 9 } },
        sysKpis: { groups: [{ rows: [{ id: "velocity.finishedPerHour", target: "8 units" }] }] },
        board: { counts: { "in-progress": 2, todo: 3, reopened: 1, pending: 4, recommendations: 0 } },
        jobs: { live: [{ state: "running" }], finished: [], todayN: 7, todayUsd: 1.5 },
        status: { halo: { up: 5, total: 5, failed: [] } },
        halo: { vitals: { ok: true, load: [8], cpus: 32, gpu_busy_percent: 40, mem_info_gtt_used: 1, mem_info_gtt_total: 4 } },
      },
      now,
    );
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    expect(by.score).toMatchObject({ tone: "g", headline: "12 released today", chip: "9 units/hour · target 8", spark: [1, 3, 8] });
    expect(by.board).toMatchObject({ tone: "a", headline: "10 open cards", sub: "1 blocked, waiting on you" });
    expect(by.jobs).toMatchObject({ tone: "g", headline: "1 running", sub: "7 finished today · $1.50" });
    expect(by.halo.meters).toEqual([
      { label: "CPU", pct: 25 },
      { label: "GPU", pct: 40 },
      { label: "MEM", pct: 25 },
    ]);
  });

  it("marks the forge stale when its file is more than 10 minutes old", () => {
    const now = Date.parse("2026-10-15T01:00:00Z");
    const [forge] = mapState({ status: { forgeAutonomy: { at: "2026-10-15T00:40:00Z", today: { rate: 1 } } } }, now).filter((c) => c.id === "forge");
    expect(forge).toMatchObject({ tone: "d", headline: "Stale" });
  });
});
