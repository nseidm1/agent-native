/**
 * FA-19027's judge in this app: the cockpit client (server/cockpit/client.ts)
 * is the ONLY file that knows where the cockpit is or names one of its routes.
 * Every other file of this app (code, scripts, checks and its own docs) fails
 * this test if it names an "/api/" path or the cockpit's port 5217; the client
 * itself names no cockpit route but /api/client/v1. Vendored framework guidance
 * (.agents/, .claude/), dependencies and build output are not this app's files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT = new Set(["server/cockpit/client.ts", "server/cockpit/client.spec.ts", "server/cockpit/client-only.spec.ts"]);
const SKIP_DIRS = new Set(["node_modules", ".agents", ".claude", ".generated", ".output", ".react-router", "build", "data", "dist", "public", ".git"]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|html)$/;
const NAMES = /\/api\/|:5217\b|\b5217\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT.test(name) && st.size < 2_000_000) out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out;
}

describe("FA-19027: only the cockpit client names a cockpit route", () => {
  const files = walk(APP);

  it("walks this app's own files", () => {
    expect(files).toContain("server/cockpit/cards.ts");
    expect(files).toContain("app/components/cockpit/BoardDialog.tsx");
    expect(files.length).toBeGreaterThan(40);
  });

  it("no file but the client names /api/ or :5217", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (CLIENT.has(f)) continue;
      const lines = readFileSync(path.join(APP, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        if (NAMES.test(l)) offenders.push(f + ":" + (i + 1) + ": " + l.trim().slice(0, 120));
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the client names no cockpit route but /api/client/v1", () => {
    const src = readFileSync(path.join(APP, "server/cockpit/client.ts"), "utf8");
    const routes = [...src.matchAll(/\/api\/[A-Za-z0-9_./{}-]*/g)].map((m) => m[0]);
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.startsWith("/api/client/v1")).toBe(true);
  });
});
