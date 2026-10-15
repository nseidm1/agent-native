/**
 * FA-19087: the full cockpit's home view, built from client resource data alone (buildHome is pure).
 * Each piece says what the legacy renderer it ports said, and an absent resource gives "no data" words, never a throw.
 */
import { describe, expect, it } from "vitest";

import { buildHome } from "./home";

const D = {
  status: { driver: { up: true, throttled: true }, lander: { up: true }, halo: { up: 6, total: 6 }, locks: { masterIntervene: true, dispatcher: false, haloClient: true }, queue: [1, 2] },
  score: { landed: 3, lastHour: 1, byHour: [0, 1, 2], velocity: { netMinutes: -5, net: -2, queueTasks: 10, windows: [{ net: -2 }, { net: 1 }, { net: 0 }, { net: 3 }] }, week: { rate: { pctPerUsd: 0.1 }, today: 5 } },
  modes: { scoreModes: { all: { fragment: { pods: 81, share: 0.34, cards: 10, landed: 2 }, direct: { pods: 157, share: 0.66, cards: 10, landed: 2 } }, today: { fragment: { pods: 0, share: 0 }, direct: { pods: 0, share: 0 } } } },
  home: {
    faces: { overview: { headline: "Production off", detail: "next FA-19072" }, doorLanding: { headline: "97% door", detail: "d" }, speed: { headline: "6 of 15 over target", detail: "s", flag: true } },
    landedRate: { perHour: 69, today: 700, byKind: { hot: 1, system: 2, production: 0 }, byWho: { door: 1, master: 1, roster: 1 } },
    velocityBar: { bar: 41, couldRun: 11, boundText: "the comfort line binds" },
    commitsToday: { n: 784, lastHour: 49, byHour: [1, 2, 3, 4] },
    keyCards: { wt: { headline: "14 worktrees · 2 idle", detail: "10 live" }, rg: { headline: "99.5% features proven", detail: "803 of 807", flag: true } },
    savedAll: { jevToday: { headline: "8.8% saved today", vs: "$37 saved", share: 0.09 }, haloToday: { headline: "10.3% saved today", vs: "$44 saved" }, balancerToday: { headline: "1.4% saved today", vs: "$1", share: 0.014 } },
    officeFacts: { refusals: { share: 0.27, refused: 3, committed: 8, top: ["scaffold", 2] }, commits: { usd: 0.49, targetUsd: 1, today: 783, usdToday: 380, p10Min: 0.2, p50Min: 0.5, p90Min: 1.8, targetMin: 1, n: 69, ticks: [0.5], recent: { n: 69, hours: 2, p50Min: 0.6 } } },
    officeShape: { now: { byKind: { door: 3, subagent: 2, engine: 1, roster: 2, lander: 1 } }, balance: { running: 7 } },
  },
  office: { data: { limit: 7, landedToday: 784, queue: { n: 0 }, commits: { pending: 1 }, halo: { up: 6, total: 6, busy: 1 }, workers: [] } },
  budget: { auto: true, pctPerDay: null, line: "pace" },
  account: { chip: { tone: "ok", label: "noah@noahseidman.com", halo: { short: "Halo ✓", match: true, text: "Halo: same" } } },
  master: { replies: [{ at: "2026-10-10T08:47:00.441Z" }] },
  release: { ahead: 472, upstream: "origin/master" },
  android: { state: "ready", adb: true, devices: [{ state: "device", model: "SM" }] },
};

describe("buildHome", () => {
  const h = buildHome(D as any, 1792000000000);
  it("the header: status pill, account with the Halo match, push count and master reply times", () => {
    expect(h.header.status).toEqual({ text: "Paused (Mac busy)", tone: "a" });
    expect(h.header.account?.label).toBe("noah@noahseidman.com");
    expect(h.header.account?.halo).toEqual({ text: "Halo ✓", match: true });
    expect(h.header.push?.ahead).toBe(472);
    expect(h.header.master?.replyAts).toHaveLength(1);
    expect(h.header.phone?.word).toBe("ready");
  });
  it("the lane switches and the Budget", () => {
    expect(h.lane).toEqual({ unlocked: true, production: false, client: true });
    expect(h.budget?.shown).toBe("Auto");
  });
  it("the office's six tiles count from the shape (door + subagent + engine + roster of balance.running)", () => {
    expect(h.office.tiles?.map((t) => t.n)).toEqual([8, 0, 1, 784, 6, 27]);
    expect(h.office.tiles?.[0].suffix).toBe("/7");
  });
  it("the faces, the mode face and the key tiles say what the legacy tiles say", () => {
    expect(h.faces.map((f) => f.headline)).toEqual(["Production off", "97% door", "6 of 15 over target"]);
    expect(h.faces[2].flag).toBe(true);
    expect(h.mode?.head).toBe("🎯 Direct · 66%");
    const t = Object.fromEntries(h.tiles.map((x) => [x.id, x]));
    expect(t.kVel.value).toBe("69.0");
    expect(t.kVel.icon).toBe("🐢▼");
    expect(t.kVel.net).toBe("net −5 min · 30 min");
    expect(t.kLanded.value).toBe("784");
    expect(t.kJev.value).toBe("8.8% saved today");
    expect(t.kHalo.value).toBe("10.3% saved today");
    expect(t.kBalancer.value).toBe("1.4% saved today");
    expect(t.kWt.value).toBe("14 worktrees · 2 idle");
    expect(t.kRg.tone).toBe("a");
    expect(t.kUsd.value).toBe("0.05%");
    expect(t.kMin.value).toBe("0.6 min");
  });
  it("no resources at all: every piece says it has no data, nothing throws", () => {
    const e = buildHome({}, 1);
    expect(e.header.status.text).toBe("Reading…");
    expect(e.office.head).toBe("office loading…");
    expect(e.faces.every((f) => f.headline === "-")).toBe(true);
    expect(e.tiles).toHaveLength(9);
  });
});
