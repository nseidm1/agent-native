import { describe, expect, it } from "vitest";

import { appsWindow, cardLine, previewOf, requestLine, type AppsPartData, type BoardApps } from "./apps";

describe("FA-19129: the Apps picker window", () => {
  const board: BoardApps = {
    mode: "maintenance",
    list: [
      { id: "family-office", name: "Family Office", description: "The Pages app", dirs: ["docs/", "server.js"], inRepo: true, counts: { todo: 2, "in-progress": 1 }, lastLanded: null, requests: [{ id: "q1", at: "2026-10-08T09:15:02Z", kind: "feature", title: "Pin it", route: "filing", status: "filed", fa: "FA-16567" }] },
      { id: "market", name: "Market", description: "", dirs: ["market/"], inRepo: false, counts: {}, requests: [{ id: "q2", kind: "feature", title: "Rename", route: "filing", status: "not filed", why: "REFUSED: owed replies" }] },
    ],
  };
  const dialog = {
    ok: true,
    apps: [
      { id: "family-office", staging: { exists: false, sha: null, running: false }, thumb: { state: "none" } },
      { id: "market", staging: { exists: true, sha: "abc", running: false }, thumb: { state: "ready", url: "/x.png" } },
    ],
  };
  it("draws one tile per app with the legacy words", () => {
    const d = appsWindow(board, dialog, 1, true);
    const p = d.part as unknown as AppsPartData;
    expect(p.tiles.map((t) => t.name)).toEqual(["Family Office", "Market"]);
    const fo = p.tiles[0];
    expect([fo.previewTitle, fo.previewSub, fo.staging]).toEqual(["No staging copy yet", "The staging copy is cut when the studio first opens it.", "No staging copy yet"]);
    expect(fo.chips).toEqual([{ t: "2 to do", tone: undefined }, { t: "1 in progress", tone: "g" }]);
    expect(fo.last).toBe("No release through the lane yet · folder docs/, server.js");
    const mk = p.tiles[1];
    expect(mk.desc).toBe("market/");
    expect([mk.previewTitle, mk.canStart, mk.staging]).toEqual(["Staging not running", true, "Staging stopped"]);
    expect(mk.chips).toEqual([{ t: "no open cards", tone: "d" }]);
    expect(mk.last).toBe("No release through the lane yet · folder market/ in its staging copy, on master after Promote");
    expect(d.headline).toBe("2 apps · 1 request not filed");
    expect(d.chips[0].t).toBe("Studio changes build in staging · Promote to production files production cards");
  });
  it("says each request's filing state", () => {
    expect(requestLine({ id: "a", route: "filing", status: "not filed", why: "REFUSED" }).line).toMatch(/· Not filed: REFUSED$/);
    expect(requestLine({ id: "a", route: "backlog" }).line).toMatch(/In the production backlog$/);
    expect(requestLine({ id: "a", route: "filing", status: "filing" }).tone).toBe("a");
  });
  it("words the preview without the picture, and a missing dialog", () => {
    expect(previewOf({ id: "x", staging: { exists: true, running: true }, thumb: { state: "ready" } }, false).title).toBe("Staging preview ready");
    expect(previewOf({ id: "x" }, true).title).toBe("Staging status unavailable");
    expect(cardLine({ id: "x", counts: { reopened: 1 }, dirs: ["x/"], inRepo: true, lastLanded: { fa: "FA-1", at: "bad" } }).chips).toEqual([{ t: "1 reopened", tone: "a" }]);
  });
});
