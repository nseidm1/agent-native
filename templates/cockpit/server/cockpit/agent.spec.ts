import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({ readAppState: vi.fn(), writeAppState: vi.fn() }));

import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALLOWED_TOOLS, askAgent, buildArgs, buildMcpConfig, isLoopbackAddress } from "./agent";

describe("ask-agent bounds", () => {
  it("accepts loopback addresses only", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(ip)).toBe(true);
    for (const ip of [undefined, "", "10.0.0.5", "192.168.1.2", "127.0.0.2", "::ffff:10.0.0.1", "localhost"]) {
      expect(isLoopbackAddress(ip)).toBe(false);
    }
  });

  it("allows exactly the three cockpit MCP tools and disables every built-in tool", () => {
    expect(ALLOWED_TOOLS).toEqual(["mcp__cockpit__get-cards", "mcp__cockpit__get-layout", "mcp__cockpit__set-layout"]);
    const args = buildArgs("--dangerously-skip-permissions", "/x/mcp.json");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(ALLOWED_TOOLS.join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("mcp__cockpit__ask_app");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    // the question is a positional after "--", never read as a flag
    expect(args.slice(-2)).toEqual(["--", "--dangerously-skip-permissions"]);
    expect(args.filter((a) => a === "--dangerously-skip-permissions")).toHaveLength(1);
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
});
