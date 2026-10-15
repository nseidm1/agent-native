import { describe, expect, it } from "vitest";

import { CARD_IDS, DEFAULT_LAYOUT, LayoutError, layoutOrDefault, validateLayout } from "./cockpit";

describe("validateLayout", () => {
  it("accepts the default layout and covers all 14 cards once", () => {
    const l = validateLayout(DEFAULT_LAYOUT);
    expect(l.bands.flatMap((b) => b.cards).sort()).toEqual([...CARD_IDS].sort());
  });

  it("refuses an unknown card id with the known ids in the message", () => {
    const bad = { ...DEFAULT_LAYOUT, bands: [{ id: "flow", title: "Flow", cards: ["score", "nope"] }] };
    expect(() => validateLayout(bad)).toThrow(LayoutError);
    expect(() => validateLayout(bad)).toThrow(/unknown card id: nope\. Known ids: score/);
  });

  it("refuses an unknown id in hidden and size too", () => {
    expect(() => validateLayout({ bands: DEFAULT_LAYOUT.bands, hidden: ["x"] })).toThrow(/unknown card id: x/);
    expect(() => validateLayout({ bands: DEFAULT_LAYOUT.bands, size: { y: "l" } })).toThrow(/unknown card id: y/);
  });

  it("refuses a duplicate card and a bad size", () => {
    expect(() => validateLayout({ bands: [{ id: "a", title: "A", cards: ["score", "score"] }] })).toThrow(/more than once/);
    expect(() => validateLayout({ bands: DEFAULT_LAYOUT.bands, size: { halo: "xl" } })).toThrow(/'s', 'm' or 'l'/);
  });

  it("appends cards left out of every band to the last band", () => {
    const l = validateLayout({ bands: [{ id: "a", title: "A", cards: ["halo"] }], hidden: ["events"] });
    expect(l.bands[0].cards[0]).toBe("halo");
    expect(l.bands[0].cards).toHaveLength(13);
    expect(l.hidden).toEqual(["events"]);
  });

  it("falls back to the default for a stored value that no longer validates", () => {
    expect(layoutOrDefault({ bands: [] })).toEqual(DEFAULT_LAYOUT);
    expect(layoutOrDefault(null)).toEqual(DEFAULT_LAYOUT);
  });
});
