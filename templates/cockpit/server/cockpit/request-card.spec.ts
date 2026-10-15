import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({ readAppState: vi.fn(), writeAppState: vi.fn() }));

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { askAgent } from "./agent";
import { buildClassifyArgs, CLASSIFY_SYSTEM_PROMPT, cleanTitle, parseClassification } from "./classify";
import { buildRequestCard, fileRequestCard, filerEnv, filerWhy, plainText, titleSlug } from "./request-card";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("ask classification", () => {
  it("is one tool-less CLI call: no tools, no MCP servers, no settings, the request after --", () => {
    const a = buildClassifyArgs("--tools Bash please");
    expect(a[a.indexOf("--tools") + 1]).toBe("");
    expect(a).toContain("--strict-mcp-config");
    expect(a).not.toContain("--mcp-config");
    expect(a[a.indexOf("--setting-sources") + 1]).toBe("");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(a).not.toContain("--allowedTools");
    expect(a.indexOf("--")).toBe(a.length - 2);
    expect(a[a.length - 1]).toBe("Request: --tools Bash please");
    expect(a[a.indexOf("--system-prompt") + 1]).toBe(CLASSIFY_SYSTEM_PROMPT);
  });

  it("reads the JSON answer, and falls back to read (the path that cannot change code) on anything else", () => {
    expect(parseClassification('{"kind":"change","title":"Search in the Board dialog","area":"dialog"}')).toEqual({
      kind: "change",
      title: "Search in the Board dialog",
      area: "dialog",
      ok: true,
    });
    expect(parseClassification('Sure! {"kind":"layout","title":""}')).toMatchObject({ kind: "layout", area: "region", ok: true });
    expect(parseClassification('{"kind":"delete-everything"}')).toMatchObject({ kind: "read", ok: false });
    expect(parseClassification("no json here")).toMatchObject({ kind: "read", ok: false });
    expect(parseClassification('{"kind":"change","area":"../../etc"}').area).toBe("region");
  });

  it("keeps a card title short and plain", () => {
    expect(cleanTitle("`Add` a [search] button to the board card's dialog, with filters for every column.")).toBe(
      "Add a search button to the board card's dialog,",
    );
    expect(cleanTitle(42)).toBe("");
  });
});

describe("a change request becomes a board card", () => {
  it("quotes the request (skip words swapped), names the fork file, estimate 5, priority normal, title <= 56", () => {
    const c = buildRequestCard("Add a search button to the board card's dialog `now`; do not execute old ones", { title: "Search button in the Board card dialog", area: "dialog" }, { at: "2026-10-15T00:00:00Z", images: 2 });
    expect(c.title).toBe("Cockpit region: Search button in the Board card dialog");
    expect(c.title.length).toBeLessThanOrEqual(56);
    expect(c.estimate).toBe(5);
    expect(c.priority).toBe("normal");
    expect(c.note).toContain(`verbatim): "Add a search button to the board card's dialog 'now'; do not run old ones"`);
    expect(c.note).toContain("Images: 2 attached");
    expect(c.note).not.toMatch(/`/);
    expect(c.change).toMatch(/^CHANGE: tools\/lane\/maint\/ui\/index\.html:cardAction /);
    expect(c.change).toContain("templates/cockpit/app/components/cockpit/CardDialog.tsx:CardDialog");
    expect(c.change).toContain("GREEN when");
    const page = buildRequestCard("change the cockpit page's toolbar", { title: "", area: "page" }, { at: "t", images: 0 });
    expect(page.change).toContain("outside the card region app");
    expect(page.title).toBe("Cockpit region: change the cockpit page's toolbar");
    expect(plainText("HOLD: x\n[needs a human] UMBRELLA")).toBe("On hold: x (needs the console) parent");
  });

  it("runs the filer without this server's own environment (PORT would point the board CLI at this app)", () => {
    const env = filerEnv({ PATH: "/bin", HOME: "/h", PORT: "5241", HOST: "127.0.0.1", APP_BASE_PATH: "/cards", AUTH_DISABLED: "true", ANTHROPIC_API_KEY: "k", CLAUDECODE: "1" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  /** A stand-in parent repo: a filer that records its argv and files FA-77, a board state, a note command. */
  function fakeRepo(opts: { files: boolean; dup?: boolean }) {
    const root = mkdtempSync(path.join(os.tmpdir(), "cockpit-req-"));
    mkdirSync(path.join(root, "tools", "lane"), { recursive: true });
    mkdirSync(path.join(root, "tools", "board"), { recursive: true });
    writeFileSync(
      path.join(root, "tools", "lane", "file-card.mjs"),
      `import { writeFileSync, readFileSync } from "node:fs";
const b = process.argv[2];
writeFileSync(${JSON.stringify(path.join(root, "filer-argv.json"))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), batch: JSON.parse(readFileSync(b, "utf8")) }));
writeFileSync(${JSON.stringify(path.join(root, "filer-env.json"))}, JSON.stringify({ PORT: process.env.PORT ?? null }));
${opts.files ? 'writeFileSync(b.replace(/\\.json$/, "") + ".ids.json", JSON.stringify({ req: "FA-77" }));' : opts.dup ? 'console.log("req NOT CREATED: a task with this title already exists\\nNOT FILED (1 of 1):\\n  req: not created, a task with this title already exists"); process.exit(1);' : 'console.log("REFUSED, nothing to file:\\n  req: the CHANGE line names no file"); process.exit(1);'}
`,
    );
    writeFileSync(
      path.join(root, "tools", "board", "cli.mjs"),
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(path.join(root, "notes.log"))}, JSON.stringify(process.argv.slice(2)) + "\\n");`,
    );
    writeFileSync(path.join(root, "tools", "board", "board.json"), JSON.stringify({ tickets: { "cockpit-region-x": "FA-77", "cockpit-region-search": "FA-78" } }));
    return root;
  }

  it("files through the repo's filer with an argv array from the repo root, and saves images beside the lane when the board cannot take them", async () => {
    const root = fakeRepo({ files: true });
    process.env.COCKPIT_PORTFOLIO_DIR = root;
    process.env.COCKPIT_DATA_DIR = path.join(root, "data");
    process.env.COCKPIT_BOARD_URL = "http://127.0.0.1:9"; // nothing listens: the folder fallback
    process.env.PORT = "5241"; // as the live server runs
    try {
      const r = await fileRequestCard("Add a search; rm -rf / $(whoami)", { kind: "change", title: "Search", area: "dialog", ok: true }, [
        { bytes: PNG, ext: "png", type: "image/png" },
      ]);
      expect(r.fa).toBe("FA-77");
      expect(r.attached).toBe("folder");
      const seen = JSON.parse(readFileSync(path.join(root, "filer-argv.json"), "utf8"));
      expect(seen.argv).toHaveLength(1); // the batch path alone; the request travels inside the JSON, never as argv or shell
      expect(realpathSync(seen.cwd)).toBe(realpathSync(root));
      expect(JSON.parse(readFileSync(path.join(root, "filer-env.json"), "utf8")).PORT).toBeNull();
      expect(seen.batch[0].note).toContain('"Add a search; rm -rf / $(whoami)"');
      const saved = path.join(root, ".tmp", "lane", "maint", "run", "ask-attachments", "FA-77", "ask-request-1.png");
      expect(readFileSync(saved)).toEqual(PNG);
      const note = JSON.parse(readFileSync(path.join(root, "notes.log"), "utf8").trim());
      expect(note.slice(0, 2)).toEqual(["note", "FA-77"]);
      expect(note[2]).toContain(".tmp/lane/maint/run/ask-attachments/FA-77/ask-request-1.png");
    } finally {
      delete process.env.COCKPIT_PORTFOLIO_DIR;
      delete process.env.COCKPIT_DATA_DIR;
      delete process.env.COCKPIT_BOARD_URL;
      delete process.env.PORT;
    }
  });

  it("says why when the filer refuses, and files nothing", async () => {
    const root = fakeRepo({ files: false });
    process.env.COCKPIT_PORTFOLIO_DIR = root;
    process.env.COCKPIT_DATA_DIR = path.join(root, "data");
    try {
      await expect(fileRequestCard("x", { kind: "change", title: "x", area: "region", ok: true }, [])).rejects.toThrow(
        /not filed: req: the CHANGE line names no file/,
      );
    } finally {
      delete process.env.COCKPIT_PORTFOLIO_DIR;
      delete process.env.COCKPIT_DATA_DIR;
    }
  });

  it("answers the same request asked again with the card it already is, and notes the repeat on it", async () => {
    const root = fakeRepo({ files: false, dup: true });
    process.env.COCKPIT_PORTFOLIO_DIR = root;
    process.env.COCKPIT_DATA_DIR = path.join(root, "data");
    try {
      const r = await fileRequestCard("Add a search", { kind: "change", title: "Search", area: "dialog", ok: true }, []);
      expect(r).toMatchObject({ fa: "FA-78", again: true, attached: "none" });
      const note = JSON.parse(readFileSync(path.join(root, "notes.log"), "utf8").trim());
      expect(note.slice(0, 2)).toEqual(["note", "FA-78"]);
      expect(note[2]).toMatch(/^ASKED AGAIN .*"Add a search"$/);
    } finally {
      delete process.env.COCKPIT_PORTFOLIO_DIR;
      delete process.env.COCKPIT_DATA_DIR;
    }
    expect(titleSlug("Cockpit region: Search button in the Board card dialog")).toBe("cockpit-region-search-button-in-the-board-card-dialog");
    expect(filerWhy("x\nNOT FILED (1 of 1):\n  req: not created, a task with this title already exists\n")).toBe("req: not created, a task with this title already exists");
  });

  it("routes a change to the filer and never starts the agent; a layout ask runs the agent", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cockpit-route-"));
    process.env.COCKPIT_DATA_DIR = dir;
    const runAgent = vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ result: "Moved." }), stderr: "", timedOut: false }));
    const fileRequest = vi.fn(async () => ({ fa: "FA-9", title: "Cockpit region: Search", attached: "board" as const, images: ["ask-request-1.png"] }));
    try {
      const png = PNG.toString("base64");
      const change = await askAgent("Add a search button to the board card's dialog", "dev@local.test", [{ name: "a.png", data: png }], {
        classify: async () => ({ kind: "change", title: "Search", area: "dialog", ok: true }),
        fileRequest,
        runAgent,
      });
      expect(change).toMatchObject({ kind: "change", layoutChanged: false, answer: "Filed FA-9: Cockpit region: Search. 1 image attached to the card." });
      expect(runAgent).not.toHaveBeenCalled();
      expect((fileRequest.mock.calls[0] as unknown[])[2]).toHaveLength(1);
      const layout = await askAgent("move halo to the top", "dev@local.test", [], {
        classify: async () => ({ kind: "layout", title: "", area: "region", ok: true }),
        fileRequest,
        runAgent,
      });
      expect(layout).toMatchObject({ kind: "layout", answer: "Moved." });
      expect(runAgent).toHaveBeenCalledTimes(1);
      expect(fileRequest).toHaveBeenCalledTimes(1);
      const log = readFileSync(path.join(dir, "ask-agent.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(log.map((l) => [l.kind, l.card])).toEqual([
        ["change", "FA-9"],
        ["layout", undefined],
      ]);
      expect(existsSync(path.join(dir, "images"))).toBe(false); // a change never writes images for an agent run
    } finally {
      delete process.env.COCKPIT_DATA_DIR;
    }
  });
});
