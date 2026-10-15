import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({ readAppState: vi.fn(), writeAppState: vi.fn() }));

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { askAgent, CANNOT_LAYOUT } from "./agent";
import { backfillRows, readRouteKpi, routeKpi, type RouteRow, similarity } from "./ask-routes";
import {
  type AskPart,
  boardActsIn,
  buildClassifyArgs,
  type Classification,
  CLASSIFY_SYSTEM_PROMPT,
  classifyPrompt,
  layoutExpressible,
  namedFas,
  normFa,
  normVerb,
  parseClassification,
} from "./classify";

/** The three misfires of 2026-10-15 (FA-19213, the twice-sent phone move, FA-19221), verbatim. */
const MISFIRE_CANCEL = "Cancel 19211, just move it above the lane card";
const MISFIRE_PHONE =
  "On the phone layout (narrow widths) only, move the Ask agent button and its panel to the very top of the page, above the Lane card, so it is the first thing after the top bar. Keep the desktop layout as it is.";
const MISFIRE_HEADER = "Make the header one line on desktop";

const part = (p: Partial<AskPart> & Pick<AskPart, "kind">): AskPart => ({ text: "", title: "", area: "region", width: "any", ...p });
const cls = (parts: AskPart[], ok = true): Classification => {
  const lead = parts.find((p) => p.kind !== "board");
  return { kind: lead && lead.kind !== "board" ? lead.kind : "read", title: lead?.title ?? "", area: lead?.area ?? "region", parts, ok };
};

describe("the parts classifier (FA-19087)", () => {
  it("asks for a list of parts and teaches the current scope with the three misfires as examples", () => {
    expect(CLASSIFY_SYSTEM_PROMPT).toContain('{"parts":[');
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/layout = ONLY reordering, hiding, showing or sizing the 14 region cards/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/change = anything in the cockpit's UI that frontend code can do/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/system = ONLY new data or a new action behind the client/);
    expect(CLASSIFY_SYSTEM_PROMPT).toMatch(/Never file a card about a card/);
    expect(CLASSIFY_SYSTEM_PROMPT).not.toMatch(/the card region's own user interface/);
    const example = (req: string) => {
      const line = CLASSIFY_SYSTEM_PROMPT.split("\n").find((l) => l.startsWith(`"${req}"`));
      expect(line, req).toBeTruthy();
      return JSON.parse(line!.slice(line!.indexOf("-> ") + 3)).parts as AskPart[];
    };
    expect(example(MISFIRE_CANCEL).map((p) => [p.kind, p.fa, p.action])).toEqual([
      ["board", "FA-19211", "archive"],
      ["change", undefined, undefined],
    ]);
    expect(example("On phone widths only, move the Ask agent button and its panel to the very top, above the Lane card. Keep desktop as it is.")[0]).toMatchObject({ kind: "change", width: "phone" });
    expect(example(MISFIRE_HEADER)[0]).toMatchObject({ kind: "change", area: "page", width: "desktop" });
    expect(example("Cancel FA-00000, and make the Waiting tile glow brighter").map((p) => p.kind)).toEqual(["board", "change"]);
  });

  it("names the cards a request mentions (with their titles) and its attached images, after --", () => {
    expect(namedFas(MISFIRE_CANCEL)).toEqual(["FA-19211"]);
    expect(namedFas("look at FA-12 and pause 3456")).toEqual(["FA-12", "FA-3456"]);
    expect(namedFas("drop 500 px of padding")).toEqual([]);
    const a = buildClassifyArgs(MISFIRE_CANCEL, [{ fa: "FA-19211", title: "Cockpit region: On mobile move ask agent to a button" }], 1);
    expect(a[a.length - 1]).toBe(classifyPrompt(MISFIRE_CANCEL, [{ fa: "FA-19211", title: "Cockpit region: On mobile move ask agent to a button" }], 1));
    expect(a[a.length - 1]).toBe(`Request: ${MISFIRE_CANCEL}\n(with 1 image attached)\nCards named in the request:\nFA-19211: Cockpit region: On mobile move ask agent to a button`);
    expect(a.indexOf("--")).toBe(a.length - 2);
  });

  it("reads parts, normalises the board verb and card, and keeps a part with no card off the board path", () => {
    const c = parseClassification(
      '{"parts":[{"kind":"board","text":"Cancel 19211","fa":"19211","action":"cancel"},{"kind":"change","text":"Move the Ask agent above the Lane card on phones","title":"Ask agent above Lane","area":"page","width":"phone"}]}',
      MISFIRE_CANCEL,
    );
    expect(c.ok).toBe(true);
    expect(c.kind).toBe("change");
    expect(c.parts!.map((p) => [p.kind, p.fa, p.action, p.width])).toEqual([
      ["board", "FA-19211", "archive", "any"],
      ["change", undefined, undefined, "phone"],
    ]);
    expect(parseClassification('{"parts":[{"kind":"board","text":"cancel it"}]}', "cancel it").parts![0].kind).toBe("read");
    expect(normFa("fa 77")).toBe("FA-77");
    expect(normFa("FA-x")).toBeNull();
    expect(normVerb("Cancel")).toBe("archive");
    expect(normVerb("delete")).toBeNull();
  });

  it("never files a card about a card: a dropped board part is restored, a system part that is only a board action is removed", () => {
    // the FA-19213 misfire, as the old classifier saw it: the whole message as one system request
    const c = parseClassification('{"parts":[{"kind":"system","text":"Cancel 19211","title":"Cancel 19211"},{"kind":"change","text":"Move it above the Lane card"}]}', MISFIRE_CANCEL);
    expect(c.parts!.map((p) => p.kind)).toEqual(["board", "change"]);
    expect(c.parts![0]).toMatchObject({ fa: "FA-19211", action: "archive" });
    expect(boardActsIn("please pause FA-123 and resume 4567")).toEqual([
      { fa: "FA-123", action: "pause", text: "pause FA-123" },
      { fa: "FA-4567", action: "resume", text: "resume 4567" },
    ]);
    // an unreadable answer still offers the board action, and reads the rest
    const f = parseClassification("no json", "Cancel FA-00000, and make the Waiting tile glow brighter");
    expect(f.ok).toBe(false);
    expect(f.parts!.map((p) => p.kind)).toEqual(["board", "read"]);
  });

  it("knows what set-layout cannot express: another element, a width, a card id outside the 14", () => {
    expect(layoutExpressible({ text: "Move the Halo card above AI models", cards: ["halo", "models"], width: "any" })).toEqual({ ok: true });
    expect(layoutExpressible({ text: MISFIRE_PHONE, width: "any" })).toMatchObject({ ok: false, why: expect.stringMatching(/width/) });
    expect(layoutExpressible({ text: "move halo up", width: "phone" })).toMatchObject({ ok: false });
    expect(layoutExpressible({ text: "move it to the top", cards: ["ask"], width: "any" })).toMatchObject({ ok: false, why: expect.stringMatching(/not one of the 14/) });
    expect(layoutExpressible({ text: "put the Ask agent above the Lane card", width: "any" })).toMatchObject({ ok: false });
    expect(CANNOT_LAYOUT.exec("CANNOT_LAYOUT: the Ask agent is not a card\nso nothing moved")?.[1]).toBe("the Ask agent is not a card");
  });
});

describe("routing each part (FA-19087)", () => {
  const setup = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cockpit-parts-"));
    process.env.COCKPIT_DATA_DIR = dir;
    const runAgent = vi.fn(async (..._a: unknown[]) => ({ code: 0, stdout: JSON.stringify({ result: "Moved." }), stderr: "", timedOut: false }));
    const fileRequest = vi.fn(async (..._a: unknown[]) => ({ fa: "FA-9", title: "Cockpit region: x", attached: "none" as const, images: [] as string[] }));
    const apply = vi.fn((input: { question: string; fa?: string }) => ({ id: "ask-20261015090000-abc123", status: "running" as const, input }) as never);
    const routes = () =>
      readFileSync(path.join(dir, "ask-routes.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as RouteRow);
    return { dir, runAgent, fileRequest, apply, routes };
  };

  it("splits a mixed request: the board part is a one-tap offer, the change part applies, nothing is filed", async () => {
    const { runAgent, fileRequest, apply, routes } = setup();
    const cardTitles = vi.fn(async (fas: string[]) => fas.map((fa) => ({ fa, title: "Cockpit region: On mobile move ask agent to a button" })));
    const classify = vi.fn(async (..._a: unknown[]) =>
      cls([
        part({ kind: "board", text: "Cancel FA-19211", fa: "FA-19211", action: "archive" }),
        part({ kind: "change", text: "On phone widths, move the Ask agent above the Lane card", title: "Ask agent above the Lane card", area: "page", width: "phone" }),
      ]),
    );
    const r = await askAgent(MISFIRE_CANCEL, "dev@local.test", [], { classify, cardTitles, runAgent, fileRequest, apply });
    expect(classify.mock.calls[0][1]).toEqual([{ fa: "FA-19211", title: "Cockpit region: On mobile move ask agent to a button" }]);
    expect(r.kind).toBe("change");
    expect(r.offers).toEqual([{ kind: "board-card", label: "Archive FA-19211", args: { fa: "FA-19211", action: "archive" }, danger: true }]);
    expect(r.parts.map((p) => [p.kind, p.path])).toEqual([
      ["board", "board"],
      ["change", "change"],
    ]);
    expect(r.answer).toMatch(/^Archive FA-19211: tap the button below/);
    expect(r.answer).toMatch(/Applying "Ask agent above the Lane card"/);
    expect(fileRequest).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    const input = apply.mock.calls[0][0];
    expect(input.question).toMatch(/^On phone widths, move the Ask agent above the Lane card\n\n\(From the console's request "Cancel 19211/);
    expect(input.fa).not.toBe("FA-19211"); // the card being cancelled is not the change's card
    expect(routes()[0].parts.map((p) => [p.kind, p.outcome])).toEqual([
      ["board", "offered"],
      ["change", "applying"],
    ]);
  });

  it("escalates a layout part set-layout cannot express to the change path, before the run and after it (no dead ends)", async () => {
    const { runAgent, fileRequest, apply, routes } = setup();
    // the twice-sent phone move: labelled layout, and set-layout cannot place anything for one width
    const r = await askAgent(MISFIRE_PHONE, "dev@local.test", [], {
      classify: async () => cls([part({ kind: "layout", text: MISFIRE_PHONE })]),
      runAgent,
      fileRequest,
      apply,
    });
    expect(runAgent).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].question).toBe(MISFIRE_PHONE);
    expect(r.kind).toBe("change");
    expect(r.parts[0]).toMatchObject({ kind: "layout", path: "change", trail: ["layout", "change"], escalated: expect.stringMatching(/width/) });
    expect(r.answer).toMatch(/^Set-layout cannot do this \(.*\), so it went on to the change path\. Applying/);

    // the second net: the run itself says set-layout cannot express it
    const cannot = vi.fn(async (..._a: unknown[]) => ({ code: 0, stdout: JSON.stringify({ result: "CANNOT_LAYOUT: Scorecard glow is a style\nNothing moved." }), stderr: "", timedOut: false }));
    const r2 = await askAgent("give the scorecard a pulse", "dev@local.test", [], {
      classify: async () => cls([part({ kind: "layout", text: "give the scorecard a pulse", cards: ["score"] })]),
      runAgent: cannot,
      fileRequest,
      apply,
    });
    expect(cannot).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(r2.parts[0]).toMatchObject({ path: "change", trail: ["layout", "change"], escalated: "Scorecard glow is a style" });

    // an expressible layout part still runs set-layout
    const r3 = await askAgent("move halo above models", "dev@local.test", [], {
      classify: async () => cls([part({ kind: "layout", text: "move halo above models", cards: ["halo", "models"] })]),
      runAgent,
      fileRequest,
      apply,
    });
    expect(r3).toMatchObject({ kind: "layout", answer: "Moved." });
    expect(routes().map((x) => x.parts[0].trail)).toEqual([["layout", "change"], ["layout", "change"], ["layout"]]);
  });

  it("routes the header misfire (FA-19221) with its image to change, never to a card", async () => {
    const { runAgent, fileRequest, apply } = setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString("base64");
    const classify = vi.fn(async (..._a: unknown[]) => cls([part({ kind: "change", text: MISFIRE_HEADER, title: "One-line header on desktop", area: "page", width: "desktop" })]));
    const r = await askAgent(MISFIRE_HEADER, "dev@local.test", [{ name: "h.png", data: png }], { classify, runAgent, fileRequest, apply });
    expect(classify.mock.calls[0][2]).toBe(1); // the classifier is told an image rode along
    expect(r.kind).toBe("change");
    expect(fileRequest).not.toHaveBeenCalled();
    expect((apply.mock.calls[0][0] as unknown as { images: unknown[] }).images).toHaveLength(1);
  });

  it("an unpaired viewer is told a board action needs pairing, and its escalated change is filed", async () => {
    const { runAgent, fileRequest, apply, routes } = setup();
    const r = await askAgent(MISFIRE_CANCEL, "dev@local.test", [], {
      classify: async () => cls([part({ kind: "board", text: "Cancel FA-19211", fa: "FA-19211", action: "archive" }), part({ kind: "layout", text: "move the Ask agent above the Lane card" })]),
      runAgent,
      fileRequest,
      apply,
      canApply: false,
    });
    expect(r.offers).toEqual([]);
    expect(r.answer).toMatch(/^Archive FA-19211 needs a paired device/);
    expect(apply).not.toHaveBeenCalled();
    expect(fileRequest).toHaveBeenCalledTimes(1);
    expect(r.parts[1]).toMatchObject({ path: "filed", trail: ["layout", "filed"] });
    expect(routes()[0].parts.map((p) => p.outcome)).toEqual(["needs-pairing", "filed"]);
  });

  it("a busy apply is said, not thrown, so the other parts still answer; a system part is filed on its own", async () => {
    const { runAgent, fileRequest } = setup();
    const r = await askAgent("pause FA-5, make the halo card teal, and add a refusal-rate field", "dev@local.test", [], {
      classify: async () =>
        cls([
          part({ kind: "board", text: "pause FA-5", fa: "FA-5", action: "pause" }),
          part({ kind: "change", text: "make the halo card teal", title: "Teal halo card" }),
          part({ kind: "system", text: "add a refusal-rate field", title: "Refusal-rate field", area: "data" }),
        ]),
      runAgent,
      fileRequest,
      apply: () => {
        throw new Error("An applied change is already in progress (ask-1); try again when it finishes.");
      },
    });
    expect(r.offers.map((o) => o.label)).toEqual(["Pause FA-5"]);
    expect(r.parts.map((p) => p.path)).toEqual(["board", "change", "filed"]);
    expect(r.answer).toMatch(/already in progress/);
    expect(r.answer).toMatch(/Filed FA-9/);
    expect(fileRequest.mock.calls[0][0]).toBe("add a refusal-rate field");
  });
});

describe("the routing KPI (FA-19087)", () => {
  const row = (at: string, q: string, parts: RouteRow["parts"], ok = true): RouteRow => ({ at, q, ok, parts });
  it("counts escalations, needs-system, dead ends, undone changes, re-asks and failed classifiers as misroutes", () => {
    const rows = [
      row("2026-10-15T09:00:00Z", "move halo above models", [{ kind: "layout", path: "layout", trail: ["layout"], outcome: "moved" }]),
      row("2026-10-15T09:01:00Z", MISFIRE_PHONE, [{ kind: "layout", path: "change", trail: ["layout", "change"], outcome: "applying", job: "j1" }]),
      row("2026-10-15T09:02:00Z", "make the office card blue", [{ kind: "change", path: "change", trail: ["change"], outcome: "applying", job: "j2" }]),
      row("2026-10-15T09:03:00Z", "add a refusal rate", [{ kind: "change", path: "change", trail: ["change"], outcome: "applying", job: "j3" }]),
      row("2026-10-15T09:30:00Z", "hide forge", [{ kind: "layout", path: "layout", trail: ["layout"], outcome: "unchanged" }]),
      row("2026-10-15T09:35:00Z", "hide the forge card please", [{ kind: "layout", path: "layout", trail: ["layout"], outcome: "moved" }]),
      row("2026-10-15T10:00:00Z", "?", [{ kind: "read", path: "read", trail: ["read"], outcome: "answered" }], false),
    ];
    const k = routeKpi(rows, (id) => ({ j1: "live", j2: "undone", j3: "needs-system" })[id] ?? null);
    expect(k.asks).toBe(7);
    expect(k.reasons).toEqual({ escalated: 1, "needs-system": 1, "dead-end": 1, undone: 1, "re-asked": 1, "classifier-failed": 1 });
    expect(k.misrouted).toBe(5); // "hide forge" is both a dead end and re-asked
    expect(k.rate).toBe(0.714);
    expect(k.recent[0].misrouted).toEqual(["classifier-failed"]);
    expect(similarity("hide forge", "hide the forge card please")).toBeGreaterThanOrEqual(0.5);
  });

  it("backfills ask-agent.log before the first route row, and reads the KPI from the data dir", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cockpit-kpi-"));
    const log = [
      { time: "2026-10-15T08:37:08.220Z", question: "On mobile move ask agent to a button on the toolbar", kind: "system", card: "FA-19211" },
      { time: "2026-10-15T08:38:02.542Z", question: MISFIRE_CANCEL, kind: "system", card: "FA-19213" },
      { time: "2026-10-15T08:40:21.818Z", question: MISFIRE_PHONE, kind: "layout", layoutChanged: false },
      { time: "2026-10-15T08:40:53.215Z", question: MISFIRE_PHONE, kind: "layout", layoutChanged: false },
      { time: "2026-10-15T09:10:00.000Z", question: "after", kind: "read" },
    ];
    writeFileSync(path.join(dir, "ask-agent.log"), log.map((l) => JSON.stringify(l)).join("\n") + "\n");
    writeFileSync(path.join(dir, "ask-routes.jsonl"), JSON.stringify(row("2026-10-15T09:10:00.000Z", "after", [{ kind: "read", path: "read", trail: ["read"], outcome: "answered" }])) + "\n");
    expect(backfillRows(log, "2026-10-15T09:10:00.000Z")).toHaveLength(4);
    const k = await readRouteKpi(dir, () => null);
    expect(k.backfill).toEqual({ asks: 4, misrouted: 2, rate: 0.5 }); // the phone move twice: a dead end, and re-asked
    expect(k.live).toEqual({ asks: 1, misrouted: 0, rate: 0 });
  });
});
