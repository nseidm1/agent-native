import { describe, expect, it } from "vitest";

import { appsWindow, cardLine, previewOf, requestLine, studioPart, thumbOf, type AppsPartData, type BoardApps } from "./apps";
import { inboxOf, tileChip } from "./studio";

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
      { id: "market", staging: { exists: true, sha: "abc", running: false }, thumb: { state: "ready", url: "/pics/market/0123456789ab.jpg" } },
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
  it("words the preview as the legacy overlay, and a missing dialog", () => {
    expect(previewOf({ id: "x", staging: { exists: true, running: true }, thumb: { state: "ready" } }, false)).toEqual({ state: "live", title: "", sub: "" });
    expect(previewOf({ id: "x", staging: { exists: true, running: true }, thumb: { state: "rendering", url: "/a/x/0123456789ab.jpg" } }, false).title).toBe("");
    expect(previewOf({ id: "x", staging: { exists: true, running: true }, thumb: { state: "rendering" } }, false).title).toBe("Rendering the preview…");
    expect(previewOf({ id: "x" }, true).title).toBe("Staging status unavailable");
    expect(cardLine({ id: "x", counts: { reopened: 1 }, dirs: ["x/"], inRepo: true, lastLanded: { fa: "FA-1", at: "bad" } }).chips).toEqual([{ t: "1 reopened", tone: "a" }]);
  });
  it("FA-19157: a tile carries its staging picture (the region route) and the autopilot chip", () => {
    const d = appsWindow(board, dialog, 1, true, undefined, { market: { ap: { state: "off" }, p: { total: 41, verified: 25, failing: 5 } } });
    const p = d.part as unknown as AppsPartData;
    expect(p.tiles[1].thumb).toBe("app-thumb/market/0123456789ab.jpg");
    expect(p.tiles[0].thumb).toBeNull();
    expect(p.tiles[1].pilot && p.tiles[1].pilot.text).toBe("25 of 41 verified");
    expect(p.tiles[0].pilot).toBeNull();
    expect(d.sections.find((x) => x.title === "Not shown here yet")).toBeUndefined();
    expect(thumbOf({ id: "Bad/..", thumb: { url: "/x/0123456789ab.jpg" } })).toBeNull();
    expect(thumbOf({ id: "ok", thumb: { url: "/x/notasha.jpg" } })).toBeNull();
  });
  it("FA-19175: the inbox carries this app's console questions and how many more wait (studio-lifecycle.js inboxTop)", () => {
    const qs = { n: 5, items: [{ id: "cq-1", app: "family-office", question: "Ship it?", priority: "blocking" }, { id: "cq-2", app: "other", question: "Other?" }, { id: "cq-3", app: "family-office", question: "Name?" }] };
    const x = inboxOf({ inbox: { needsYou: 1, proposals: 2 } }, { promotion: { phase: "awaiting-signature" } }, qs, "family-office");
    expect(x).toMatchObject({ need: 4, proposals: 2, text: "4 need you", more: 3 });
    expect(x.qs).toEqual([
      { id: "cq-1", question: "Ship it?", priority: "blocking" },
      { id: "cq-3", question: "Name?", priority: "normal" },
    ]);
    expect(inboxOf(null, null, null, "family-office")).toMatchObject({ need: 0, text: "Inbox", qs: [], more: 0 });
  });
  it("FA-19157: tileChip says what the legacy tile chip says", () => {
    expect(tileChip({ state: "running" }, { total: 4, verified: 2 })).toMatchObject({ text: "Building 2 of 4", tone: "run", spin: true });
    expect(tileChip({ state: "waiting", decisionsOpen: [{ text: "Pick a fee" }] }, { total: 4, verified: 2 })).toMatchObject({ text: "Needs your decision", tone: "a", open: true });
    expect(tileChip({ state: "green" }, { total: 19, verified: 19 })!.text).toBe("Green");
    expect(tileChip({ state: "off" }, { total: 4, verified: 2, failing: 1 })).toMatchObject({ text: "2 of 4 verified", tone: "r" });
    expect(tileChip(null, { total: 0 })).toBeNull();
  });
  it("FA-19157: with an app the window is that app's studio", () => {
    const now = Date.parse("2026-10-15T06:00:00Z");
    const s = studioPart(
      { id: "family-office", name: "Family Office", dirs: ["docs/", "server.js"], platform: "web", staging: { exists: true, sha: "4009b98fcc12", running: true }, thumb: { state: "ready", url: "/t/family-office/4009b98fcc12.jpg" } },
      { staging: { sha: "4009b98fcc12aa", short: "4009b98fcc", built: "2026-10-14T14:00:00Z", running: true, url: "http://192.168.50.2:5310/", ahead: [1, 2] }, production: { sha: "833e", short: "833e88613f", url: "https://x.example/", at: "2026-09-29T12:00:00Z" }, autopilot: { state: "off", text: "Build it: not started" } },
      { build: { progress: { total: 4, verified: 2, failing: 2, detail: "2 failing" }, tone: "r" }, quality: { qa: { green: false, at: "2026-10-09T01:36:27Z" }, measure: { at: "2026-10-09T13:32:19Z" }, text: "53 open findings", tone: "a" }, launch: { pct: 8, red: 12, tone: "r" }, live: { production: "none", text: "No data yet", tone: "" }, inbox: { needsYou: 0, proposals: 0 } },
      { progress: { total: 4, verified: 2, text: "2 of 4 requirements verified" }, items: [{ id: "rq-1", text: "Who is it for", status: "context" }] },
      { staging: { changes: [{ id: "sc-1", title: "Build the 3 unbuilt answers", state: "done", label: "live in staging", endedAt: "2026-10-09T00:20:55Z" }] }, rec: { activity: [{ at: "2026-10-08T20:14:43Z", what: "Staging change queued" }] } },
      { items: [{ app: "family-office" }, { app: "other" }] },
      [],
      now,
    );
    expect(s.chip).toBe("App · docs/, server.js");
    expect(s.identity.text).toBe("Staging 4009b98fcc · 16 h ago Production 833e88613f (opens the production site) · 16 d ago");
    expect(s.tiles.map((t) => [t.label, t.v, t.s, t.need])).toEqual([
      ["Build", "2 of 4 verified", "2 failing", true],
      ["Quality", "53 open findings", "Measured 6 d ago", false],
      ["Launch ready", "8%", "12 items left", false],
      ["Deploy", "Idle", "Last 16 d ago", false],
      ["Live", "No data yet", "Until production data flows", false],
    ]);
    expect(s.inbox).toMatchObject({ need: 1, text: "1 needs you" });
    expect(s.thumb).toBe("app-thumb/family-office/4009b98fcc12.jpg");
    expect(s.staging).toMatchObject({ running: true, ahead: 2, url: "http://192.168.50.2:5310/" });
    expect(s.changes[0]).toMatchObject({ what: "Build the 3 unbuilt answers", state: "live in staging", tone: "g" });
    expect(s.activity[0].text).toBe("Staging change queued");
    const w = appsWindow(board, dialog, 1, true, undefined, {}, s);
    expect([w.title, w.headline, (w.part as any).studio.app]).toEqual(["Family Office", "app studio", "family-office"]);
  });
});
