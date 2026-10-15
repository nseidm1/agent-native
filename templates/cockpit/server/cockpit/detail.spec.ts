import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CARD_IDS } from "../../shared/cockpit";
import { type CardDetail, DETAIL_MAX_CHARS, DETAIL_MAX_ROWS } from "../../shared/cockpit-detail";
import { buildDetail } from "./detail";

/** Every string in a detail, for the bound checks. */
function strings(d: unknown, out: string[] = []): string[] {
  if (typeof d === "string") out.push(d);
  else if (Array.isArray(d)) for (const x of d) strings(x, out);
  else if (d && typeof d === "object") for (const [k, v] of Object.entries(d)) if (k !== "options") strings(v, out);
  return out;
}

function checkBounds(d: CardDetail) {
  for (const s of d.sections) {
    expect((s.rows || []).length).toBeLessThanOrEqual(DETAIL_MAX_ROWS);
    expect((s.items || []).length).toBeLessThanOrEqual(DETAIL_MAX_ROWS);
  }
  for (const t of strings(d.sections)) expect(t.length).toBeLessThanOrEqual(DETAIL_MAX_CHARS);
}

describe("card detail", () => {
  it("builds all 14 dialogs from an empty or odd state without throwing", () => {
    for (const j of [null, {}, { scorecard: 5, board: "x", halo: [], events: "no" }]) {
      for (const id of CARD_IDS) {
        const d = buildDetail(id, j);
        expect(d.id).toBe(id);
        expect(Array.isArray(d.sections)).toBe(true);
      }
    }
  });

  it("caps rows at 200 and strings at 300 characters", () => {
    const long = "x".repeat(5000);
    const ev = Array.from({ length: 450 }, (_, i) => ({ at: 1_792_000_000_000 + i, cls: "info", text: long, w: { kind: "work", icon: "🔧", text: long } }));
    const d = buildDetail("events", { events: ev });
    expect(d.sections[0].rows).toHaveLength(200);
    expect(d.sections[0].more).toBe(250);
    checkBounds(d);
  });

  it("offers each board card exactly the actions its column allows", () => {
    const board = {
      columns: [
        { id: "recommendations", name: "Recommendations" },
        { id: "in-progress", name: "In progress" },
        { id: "reopened", name: "Reopened" },
      ],
      cards: [
        { fa: "FA-1", title: "a rec", col: "recommendations", pr: "high" },
        { fa: "FA-2", title: "working", col: "in-progress" },
        { fa: "FA-3", title: "paused", col: "reopened", paused: true },
        { fa: "bad id", title: "no actions", col: "in-progress" },
        { id: "kid", fa: "FA-4", title: "a sub-card", col: "in-progress", parent: "FA-2" },
      ],
    };
    const d = buildDetail("board", { board });
    const acts = (title: string) =>
      d.sections
        .flatMap((s) => s.rows || [])
        .find((r) => r.cells.some((c) => (typeof c === "string" ? c : c.t) === title))
        ?.actions?.map((a) => a.args.action);
    expect(acts("a rec")).toEqual(["backlog", "promote", "archive"]);
    expect(acts("a sub-card")).toEqual(["pause", "archive"]);
    const archive = d.sections.flatMap((s) => s.rows || []).flatMap((r) => r.actions || []).find((a) => a.args.fa === "FA-4" && a.args.action === "archive");
    expect(archive?.confirm).toBe("Archive FA-4? It moves to Archived; nothing is deleted.");
    expect(acts("working")).toEqual(["pause", "archive"]);
    expect(acts("paused")).toEqual(["resume", "archive"]);
    expect(acts("no actions")).toBeUndefined();
    for (const s of d.sections) for (const r of s.rows || []) for (const a of r.actions || []) expect(a.kind).toBe("board-card");
  });

  it("modes takes its work class and window from the arguments", () => {
    const win = (cards: number) => ({ cards, modes: { fragment: { cards, landed: 1 } }, verdicts: { better: { lead: "fragment", text: "fragment ahead" } } });
    const dm = { default: "7d", windows: { "7d": win(9), today: win(2) }, byClass: { hot: { windows: { "7d": win(5), today: win(1) } } } };
    expect(buildDetail("modes", { draftingModes: dm }).lead).toMatch(/All work · 7 days .* 9 cards \+ units/);
    const hot = buildDetail("modes", { draftingModes: dm }, { cls: "hot", window: "today" });
    expect(hot.lead).toMatch(/Hot fixes · Today .* 1 units/);
    expect(hot.filters?.map((f) => f.value)).toEqual(["hot", "today"]);
  });

  it("offers the halo toggles only from the live model list, and funnel-on only while it is off", () => {
    const halo = buildDetail("halo", { halo: { vitals: { ok: true }, servers: [] }, status: { halo: { up: 1, total: 1 } } }, {
      haloModels: [{ id: "qwen2.5-3b", name: "Qwen 3B", state: "running", enabled: true }, { id: "big", name: "Big", state: "stopped", enabled: false }],
    });
    const acts = halo.sections.flatMap((s) => s.rows || []).flatMap((r) => r.actions || []);
    expect(acts.map((a) => [a.args.id, a.args.enabled])).toEqual([["qwen2.5-3b", false], ["big", true]]);
    const on = buildDetail("appkpis", { appKpis: { rows: [] } }, { appData: { funnel: { on: false, text: "off" } } });
    expect(on.actions?.map((a) => a.kind)).toEqual(["funnel-on"]);
    expect(buildDetail("appkpis", { appKpis: { rows: [] } }, { appData: { funnel: { on: true } } }).actions).toEqual([]);
  });

  // the live cockpit's state, when a copy is on hand (COCKPIT_STATE_FILE): every dialog builds, inside the bounds
  const file = process.env.COCKPIT_STATE_FILE;
  it.runIf(!!file && existsSync(file))("builds every dialog from a real /api/state, inside the bounds", () => {
    const j = JSON.parse(readFileSync(file as string, "utf8"));
    for (const id of CARD_IDS) {
      const d = buildDetail(id, j);
      expect(d.ok, id + ": " + d.error).toBe(true);
      expect(d.sections.length, id).toBeGreaterThan(0);
      checkBounds(d);
      expect(JSON.stringify(d).length, id).toBeLessThan(400_000);
    }
  });
});
