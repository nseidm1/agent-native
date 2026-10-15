/**
 * FA-19136 (FA-19087's final step): the agent-native cockpit renders every window itself, so nothing in this app opens
 * the legacy page any more - no LegacyWindow, no "cockpit-open-legacy" event, no link or frame to the front's /legacy/
 * fallback path (the front serves that page only while agent-native is down). The parity checks under e2e/ still load the
 * legacy page on purpose (they compare against it), so they are not this app's UI and are not walked.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = "server/cockpit/legacy-retired.spec.ts";
const ROOTS = ["app", "server", "shared", "actions"];
const TEXT = /\.(ts|tsx|js|jsx|mjs|css|html)$/;
const BANNED = /LegacyWindow|cockpit-open-legacy|["'`(=]\/legacy\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(path.relative(APP, p).split(path.sep).join("/"));
  }
  return out;
}

describe("FA-19136: the legacy page is retired from the agent-native cockpit", () => {
  const files = ROOTS.flatMap((r) => walk(path.join(APP, r)));
  it("walks the app's UI and server code", () => {
    expect(files).toContain("app/components/cockpit/Cockpit.tsx");
    expect(files).toContain("app/components/cockpit/windows/StudioView.tsx");
  });
  it("has no LegacyWindow and opens nothing on the legacy page", () => {
    expect(files).not.toContain("app/components/cockpit/LegacyWindow.tsx");
    const hits: string[] = [];
    for (const f of files) {
      if (f === SELF) continue;
      readFileSync(path.join(APP, f), "utf8")
        .split("\n")
        .forEach((l, i) => {
          if (BANNED.test(l)) hits.push(f + ":" + (i + 1) + ": " + l.trim().slice(0, 120));
        });
    }
    expect(hits).toEqual([]);
  });
});
