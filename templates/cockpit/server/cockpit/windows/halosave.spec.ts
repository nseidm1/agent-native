import { describe, expect, it } from "vitest";

import { balancerWindow } from "./balancer";
import { fcHalo, halosaveWindow, hsCard } from "./halosave";

const power = {
  measured: true,
  latest: { at: "2026-10-15T04:48:05.590Z", w: 12.449, busy: 0 },
  idle: { w: 40.139, label: "median package watts with no model slot busy (n=6056)" },
  today: { samples: 288, hours: 4.8138, kwhPackage: 0.17891, box: { usd: 0.0311, lo: 0.03, hi: 0.0322 }, modelWork: { usd: 0.0088, lo: 0.0085, hi: 0.0091 } },
  cumulative: { box: { usd: 1.6164, lo: 1.5607, hi: 1.6722 } },
  rate: { usdPerKwh: 0.145, lo: 0.14, hi: 0.15, source: "console" },
  overhead: { factor: 1.2, label: "ESTIMATE" },
  label: "Halo package power",
  source: "maint/ui/halo-power.jsonl",
  bars: [{ day: "2026-10-15", usd: 0.0311 }],
};
const halo = {
  at: "2026-10-15T04:49:01.726Z",
  pricing: "the same tokens at the incumbent's price",
  net: { today: 0.8386, cumulative: 13.8232, label: "Claude $ avoided (live) - Halo box power $" },
  live: { today: 0.87, cumulative: 15.44, callsToday: 65, calls: 1240, tokens: 5680381 },
  shadow: { today: 0, cumulative: 6.31, calls: 554, tokens: 1994611 },
  load: { liveShareToday: 0.0191, claudeUsdToday: 44.578, liveShareOfSpend: 0.00214, claudeUsd: 7176.2 },
  unearned: { usd: 0, label: "live Halo rows of a use that has not earned live: not counted" },
  lab: { rows: 10923, label: "lab / eval / test rows: measurement runs, not counted" },
  bars: [{ day: "2026-10-14", live: 9.98, shadow: 0.008 }, { day: "2026-10-15", live: 0.87, shadow: 0 }],
  uses: [
    { job: "tool:draft-test", model: "qwen3.8-flash-next", replaces: "sonnet", basis: "b", state: "live", live: { n: 526, usd: 14.78 }, shadow: { n: 0, usd: 0 }, agreement: null },
    { job: "qwen:qa-judge", model: "qwen3.8-flash-next", replaces: "sonnet", state: "shadow", live: { n: 0, usd: 0 }, shadow: { n: 333, usd: 2.57 }, agreement: { what: "paid judge findings Qwen also found", n: 101, k: 7, p: 0.07, lo: 0.03, hi: 0.14 } },
  ],
  power,
  sources: ["maint/halo-usage.jsonl", "halo/uses.mjs"],
};
const F = { since: "2026-10-07", runs: 4860, total: { days: 9, claude: 100, jev: 3, halo: 11, haloShare: 0.0382, perDay: { halo: 30.7, claude: 10 } }, days: [{ day: "2026-10-14", halo: { usd: 5 } }] };
const home = { saveForecast: F, savedAll: { haloToday: { headline: "0.0% saved today", vs: "$0.00 saved of $0.61 without it", why: "w" }, balancer: { headline: "$206.66 saved", vs: "8.3% under $2,489 without it", sinceTxt: "since 10-11", share: 0.083 } } };
const sys = { groups: [{ rows: [{ id: "claude.savedShare", value: "0.5%", target: "50%", drivers: ["halo.netUsd"] }, { id: "claude.savedShare.halo", value: "0.5%" }] }] };

describe("FA-19133: the Halo savings window", () => {
  it("leads with the legacy hsHead, hsWhy and the face line the tile writes", () => {
    const d = halosaveWindow(halo, home, sys, 1, true);
    expect(d.headline).toBe("$0.84 saved today on the Halo (Claude $0.87 avoided − power $0.03)");
    expect(d.tone).toBe("g");
    expect(d.sub).toBe("the same tokens at the incumbent's price · net = Claude $ avoided (live) - Halo box power $");
    expect(d.lead).toBe(
      "$0.84 net of power · Claude $0.87 avoided − power $0.03 · 65 local calls today · since Oct 7: 3.8% of Claude $ (~$31/day, replay of 4860 runs) · shadow $0.00 today (shadow, not counted) · load off Claude today: 1.9% of lane model work · $15.44 live since the first row",
    );
    expect(d.sections[0].text).toBe("Halo part: 0.5% · drivers: halo.netUsd · if online (9 d): Halo 11.0%, together 14.0%, 36.0 points short of 50% = $4 a day");
  });
  it("puts today and cumulative side by side, the shadow apart", () => {
    const s = halosaveWindow(halo, home, sys, 1, true).sections.find((x) => x.title === "Claude $ avoided, power and shadow")!;
    const flat = s.rows!.map((r) => r.cells.map((c) => (typeof c === "string" ? c : c.t)).join(" | "));
    expect(flat[1]).toBe("Power $ (the whole box) | $0.03 [$0.03–$0.03] | $1.62 [$1.56–$1.67]");
    expect(flat[3]).toBe("Live calls handled on the Halo | 65 | 1240 calls · 5680381 tokens");
    expect(flat[5]).toBe("Shadow: would save if live (never added to live) | $0.00 | $6.31 · 554 calls · 1994611 tokens");
  });
  it("lists every use with its agreement, and the last days newest first", () => {
    const secs = halosaveWindow(halo, home, sys, 1, true).sections;
    const u = secs.find((x) => x.title.startsWith("Per use"))!;
    expect(u.rows![1].note).toBe("paid judge findings Qwen also found: 7% (7/101) [3–14%]");
    expect(u.rows![0].note).toBe("no agreement measured");
    expect(u.rows![0].cells[3]).toEqual({ t: "live", tone: "g" });
    const days = secs.find((x) => x.title === "Per day · last 7 days")!;
    expect(days.rows![0].cells[0]).toBe("2026-10-15");
    expect(days.rows![0].cells[3]).toBe("$0.03");
    expect(days.rows![1].cells[3]).toBe("not measured");
  });
  it("draws live beside the forecast's Halo $ per day", () => {
    const b = halosaveWindow(halo, home, sys, 1, true).sections.find((x) => x.kind === "bars")!;
    expect(b.bars!.map((x) => x.value)).toEqual(["$9.98", "$5.00", "$0.87", "$0.00"]);
    expect(fcHalo(hsCard(halo), F).bars[0].shadow).toBe(5);
  });
  it("says the data is not there yet rather than failing", () => {
    const d = halosaveWindow(null, {}, {}, 1, false, "halosave: down");
    expect(d.headline).toBe("Halo savings data not available yet");
    expect(d.tone).toBe("d");
    expect(d.sections.find((x) => x.title === "Per day · last 7 days")!.rows).toEqual([]);
  });
});

describe("FA-19133: the Balancer window", () => {
  const bal = {
    ok: true,
    txt: "1.1%",
    share: 0.011,
    why: "today: saved $0.50",
    since: "2026-10-11",
    at: "2026-10-15T04:40:16.712Z",
    bars: [{ day: "2026-10-14", usd: 5.375, share: 0.013 }, { day: "2026-10-15", usd: 0.5015, share: 0.0111 }],
    byExecutor: [{ name: "Halo rung", units: 2466, savedUsd: 13.2275, actualUsd: 0, misses: 0, detail: [{ name: "0.5b", units: 1304, savedUsd: 8.476 }] }, { name: "Haiku", units: 974, savedUsd: 50.2197, actualUsd: 6.836, misses: 109, detail: [] }],
    byWho: [{ name: "master", units: 170, savedUsd: 188.8586, actualUsd: 68.2079, misses: 46 }],
  };
  it("leads with the all-history saving and lists who did and who routed the work", () => {
    const d = balancerWindow(bal, home, 1, true);
    expect(d.headline).toBe("$206.66 saved by the balancer · 8.3% under $2,489 without it · since 10-11");
    expect(d.tone).toBe("g");
    const ex = d.sections.find((s) => s.title === "By executor")!;
    expect(ex.rows!.map((r) => r.cells.join(" | "))).toEqual(["Halo rung | 2466 | $13.23 | $0.00 | 0", "Haiku | 974 | $50.22 | $6.84 | 109"]);
    const rungs = d.sections.find((s) => s.title === "Within Halo rung")!;
    expect(rungs.rows!.map((r) => r.cells.map((c) => (typeof c === "string" ? c : c.t)).join(" | "))).toEqual(["0.5b | 1304 | $8.48"]);
    expect(d.sections.find((s) => s.title === "By who routed")!.rows![0].cells).toEqual(["master", "170", "$188.86", "$68.21", "46"]);
    expect(d.sections.find((s) => s.title === "Per day · last 7 days")!.rows![0].cells).toEqual(["2026-10-15", "$0.50", "1.1%"]);
    expect(d.sections.find((s) => s.title === "Source")!.text).toBe(
      "Source: run/balancer-backfill.json (estimate/balancer-backfill.mjs), since 2026-10-11, written 2026-10-15 04:40Z. Share = saved / (saved + that day's Claude spend); a missed unit counts against the saving.",
    );
    expect(d.sections[0].bars!.map((b) => b.value)).toEqual(["$5.38", "$0.50"]);
  });
  it("says the data is not there yet rather than failing", () => {
    const d = balancerWindow(null, {}, 1, false);
    expect(d.headline).toBe("Balancer savings data not available yet");
    expect(d.sections.find((s) => s.title === "By executor")!.rows).toEqual([]);
  });
});
