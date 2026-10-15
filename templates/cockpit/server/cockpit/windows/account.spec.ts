import { describe, expect, it } from "vitest";

import { DETAIL_MAX_CHARS } from "../../../shared/cockpit-detail";
import { accountWindow, compact, holdLine, whoLine } from "./account";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const base = {
  status: { loggedIn: true, email: "a@b.c", plan: "max" },
  budget: { state: "ok", windows: { five_hour: { util: 0.12, resetsAt: NOW / 1000 + 3600 }, seven_day: { util: 0.33, resetsAt: NOW / 1000 + 86400 * 3 } } },
  fresh: { at: NOW - 60e3, stale: false },
  chip: { tone: "ok", label: "a@b.c", words: "33% of this week used", halo: { short: "Halo ✓", text: "Halo: same account (a@b.c)", match: true } },
  flow: null,
  hold: null,
  lifted: null,
};

describe("FA-19125: the Claude account window", () => {
  it("says who the Mac is signed in as, the Halo beside it and the plan usage windows", () => {
    const d = accountWindow(base, 1, true, undefined, NOW);
    expect(d.headline).toBe("Mac: signed in as a@b.c (Max)");
    expect(d.sub).toBe("Halo: same account (a@b.c)");
    expect(d.tone).toBe("g");
    const u = d.sections[0];
    expect(u.title).toBe("Plan usage");
    expect(u.sub).toMatch(/^as of /);
    expect(d.sections[1].items![0].text).toMatch(/^33% of this week used as of /);
    expect(u.stats!.map((s) => s.label + " " + s.value)).toEqual(["5 hours 12%", "This week 33%"]);
    expect(u.stats![0].sub).toMatch(/^resets /);
    expect(d.chips.map((c) => c.t)).toEqual([expect.stringMatching(/^33% wk as of /), "Halo ✓"]);
    expect(d.part).toMatchObject({ flow: null, loggedIn: true, email: "a@b.c", haloMatch: true, holdKind: null });
  });
  it("words the signed-out and unknown logins as the legacy dialog does", () => {
    expect(whoLine({ loggedIn: false })).toBe("No Claude account is signed in on this Mac.");
    expect(whoLine(null)).toBe("Could not read the claude login on this Mac yet.");
  });
  it("says the lane is paused for an out account, and when it resumes", () => {
    const v = { ...base, hold: { kind: "out", why: "weekly limit", until: NOW + 3600e3 }, interrupted: [1, 2] };
    const h = holdLine(v, NOW)!;
    expect(h.tone).toBe("r");
    expect(h.text).toMatch(/^The lane is paused \(weekly limit\): no new work starts; 2 interrupted job\(s\) wait to resume where they stopped\. It resumes by itself when the budget resets/);
    const d = accountWindow(v, 1, true, undefined, NOW);
    expect(d.sections.map((s) => s.title)).toEqual(["Plan usage", "Budget", "Lane paused", "What this changes"]);
    expect(d.part).toMatchObject({ holdKind: "out" });
  });
  it("shows a recent resume for 30 minutes only", () => {
    const v = { ...base, lifted: { at: NOW - 5 * 60e3, resumed: 3, email: "a@b.c", why: "swap done" } };
    expect(holdLine(v, NOW)!.text).toMatch(/: 3 paused job\(s\) picked up where they stopped on a@b\.c \(swap done\)\.$/);
    expect(holdLine({ ...v, lifted: { ...v.lifted, at: NOW - 31 * 60e3 } }, NOW)).toBeNull();
  });
  it("carries a running flow to the part and keeps every string bounded", () => {
    const flow = { kind: "swap", steps: [{ id: "signin", label: "Sign in", state: "waiting", reason: "x".repeat(900) }], signin: { url: "https://claude.ai/x", mode: "paste" } };
    const d = accountWindow({ ...base, flow, chip: { ...base.chip, tone: "busy", words: "w".repeat(900) } }, 1, true, undefined, NOW);
    expect(d.tone).toBe("a");
    expect((d.part as any).flow.steps[0].id).toBe("signin");
    for (const s of d.sections) for (const t of [s.sub || "", ...(s.items || []).map((i) => i.text)]) expect(t.length).toBeLessThanOrEqual(DETAIL_MAX_CHARS);
  });
  it("compacts the budget like the header chip", () => {
    expect(compact({ state: "out", outUntil: NOW + 3600e3 }, NOW)).toMatch(/^out until /);
    expect(compact({ state: "unknown" }, NOW)).toBe("");
    expect(compact(base.budget, NOW)).toBe("33% wk");
  });
});
