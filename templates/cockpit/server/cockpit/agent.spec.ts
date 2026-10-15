import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({ readAppState: vi.fn(), writeAppState: vi.fn() }));

import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { existsSync, readdirSync } from "node:fs";

import { ALLOWED_TOOLS, askAgent, buildArgs, buildMcpConfig, decodeImage, isLoopbackAddress, readRuleFor } from "./agent";

describe("ask-agent bounds", () => {
  it("accepts loopback addresses only", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(ip)).toBe(true);
    for (const ip of [undefined, "", "10.0.0.5", "192.168.1.2", "127.0.0.2", "::ffff:10.0.0.1", "localhost"]) {
      expect(isLoopbackAddress(ip)).toBe(false);
    }
  });

  it("allows exactly the cockpit's read tools and set-layout, never a write, and disables every built-in tool", () => {
    expect(ALLOWED_TOOLS).toEqual([
      "mcp__cockpit__get-cards",
      "mcp__cockpit__get-card-detail",
      "mcp__cockpit__get-board",
      "mcp__cockpit__get-board-card",
      "mcp__cockpit__cockpit-manifest",
      "mcp__cockpit__cockpit-read",
      "mcp__cockpit__get-layout",
      "mcp__cockpit__set-layout",
    ]);
    const args = buildArgs("--dangerously-skip-permissions", "/x/mcp.json");
    for (const w of ["cockpit-act", "cockpit-board-card-action", "cockpit-halo-model", "cockpit-job-start"]) {
      expect(args[args.indexOf("--disallowedTools") + 1]).toContain("mcp__cockpit__" + w);
    }
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(ALLOWED_TOOLS.join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("mcp__cockpit__ask_app");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    // the question is a positional after "--", never read as a flag
    expect(args.slice(-2)).toEqual(["--", "--dangerously-skip-permissions"]);
    expect(args.filter((a) => a === "--dangerously-skip-permissions")).toHaveLength(1);
  });

  it("MI-388: a viewer that may not apply is never offered set-layout, and is told so", () => {
    const args = buildArgs("move halo to the top", "/x/mcp.json", [], { layoutWrites: false });
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(ALLOWED_TOOLS.filter((t) => !t.endsWith("__set-layout")).join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("mcp__cockpit__set-layout");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toMatch(/not paired/);
    const full = buildArgs("move halo to the top", "/x/mcp.json");
    expect(full[full.indexOf("--allowedTools") + 1]).toContain("mcp__cockpit__set-layout");
    expect(full[full.indexOf("--disallowedTools") + 1]).not.toContain("set-layout");
  });

  it("names the signed-in owner to the app's own MCP endpoint", () => {
    const cfg = buildMcpConfig("dev@local.test");
    expect(cfg.mcpServers.cockpit.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/_agent-native\/mcp$/);
    expect(cfg.mcpServers.cockpit.headers).toEqual({ "x-agent-native-owner-email": "dev@local.test" });
  });

  it("reports a missing CLI as its own error line and logs the run", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cockpit-agent-test-"));
    process.env.COCKPIT_DATA_DIR = dir;
    process.env.COCKPIT_CLAUDE_BIN = path.join(dir, "no-such-claude");
    await expect(askAgent("move halo", "dev@local.test")).rejects.toThrow(/Claude CLI not found at/);
    const log = JSON.parse(readFileSync(path.join(dir, "ask-agent.log"), "utf8").trim());
    expect(log).toMatchObject({ question: "move halo", exit: null, layoutChanged: false });
    await expect(askAgent("x".repeat(2001), "dev@local.test")).rejects.toThrow(/2000 characters/);
    delete process.env.COCKPIT_DATA_DIR;
    delete process.env.COCKPIT_CLAUDE_BIN;
  });

  it("adds Read for exactly the attached image paths, and only when there are some", () => {
    const none = buildArgs("hi", "/x/mcp.json");
    expect(none[none.indexOf("--tools") + 1]).toBe("");
    const p = "/data/cockpit-agent/images/0123abcd.png";
    const args = buildArgs("what colour?", "/x/mcp.json", [p]);
    expect(args[args.indexOf("--tools") + 1]).toBe("Read");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe([...ALLOWED_TOOLS, `Read(/${p})`].join(","));
    expect(args[args.length - 1]).toBe(`what colour?\n\nAttached images: ${p} - view them with the Read tool.`);
    // a path that could widen the rule is refused, never allow-listed
    for (const bad of ["/a/*.png", "/a/(x).png", "/a/b c.png", "/a/../etc/passwd", "relative.png", "/a/x,Bash.png"]) {
      expect(() => readRuleFor(bad)).toThrow(/not safe/);
    }
  });

  it("checks each image by magic bytes and size before anything is written", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(decodeImage({ name: "a.png", data: png.toString("base64") }, 0).ext).toBe("png");
    expect(() => decodeImage({ name: "a.png", data: Buffer.from("not an image at all").toString("base64") }, 0)).toThrow(
      /not a PNG, JPEG, WebP or GIF/,
    );
    expect(() => decodeImage({ name: "a.png", data: "@@@@" }, 0)).toThrow(/not valid base64/);
    expect(() => decodeImage({ name: "a.png", data: "" }, 0)).toThrow(/empty/);
    const big = Buffer.alloc(6 * 1024 * 1024);
    png.copy(big);
    expect(() => decodeImage({ name: "big.png", data: big.toString("base64") }, 0)).toThrow(/larger than 5 MB/);
  });

  it("refuses a bad image without spawning, and deletes attachments after a failed run", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cockpit-agent-img-"));
    process.env.COCKPIT_DATA_DIR = dir;
    process.env.COCKPIT_CLAUDE_BIN = path.join(dir, "no-such-claude");
    await expect(askAgent("colour?", "dev@local.test", [{ name: "x.txt", data: Buffer.from("hello").toString("base64") }])).rejects.toThrow(
      /not a PNG/,
    );
    expect(existsSync(path.join(dir, "ask-agent.log"))).toBe(false); // refused before the run began
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
    await expect(askAgent("colour?", "dev@local.test", [{ name: "a.png", data: png }])).rejects.toThrow(/Claude CLI not found/);
    expect(readdirSync(path.join(dir, "images"))).toEqual([]);
    const log = JSON.parse(readFileSync(path.join(dir, "ask-agent.log"), "utf8").trim());
    expect(log).toMatchObject({ question: "colour?", images: 1 });
    await expect(askAgent("x", "dev@local.test", Array(4).fill({ name: "a.png", data: png }))).rejects.toThrow(/At most 3/);
    delete process.env.COCKPIT_DATA_DIR;
    delete process.env.COCKPIT_CLAUDE_BIN;
  });
});
