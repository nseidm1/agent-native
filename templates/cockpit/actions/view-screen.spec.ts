import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getCards: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
  writeAppState: vi.fn(),
}));
vi.mock("../server/cockpit/cards.js", () => ({ getCards: mocks.getCards }));

import action from "./view-screen";

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCards.mockResolvedValue({
      at: 1,
      ok: true,
      cards: [{ id: "halo", title: "Halo", tone: "g", headline: "5 of 5 up", sub: "", chip: "" }],
    });
  });

  it("returns navigation, the layout and each card's headline", async () => {
    mocks.readAppState.mockImplementation(async (k: string) => (k === "navigation" ? { view: "cards" } : null));
    const result = (await action.run({})) as any;
    expect(result.navigation).toEqual({ view: "cards" });
    expect(result.layout.bands.map((b: any) => b.title)).toEqual(["Flow", "Work", "Models & compute"]);
    expect(result.cards).toEqual([{ id: "halo", tone: "g", headline: "5 of 5 up" }]);
  });

  it("is marked read-only", () => {
    expect(action.readOnly).toBe(true);
  });
});
