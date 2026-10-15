import { describe, expect, it } from "vitest";

import { addedLinesFromDiff, checkScope, parsePorcelainZ, pathAllowed } from "./scope";

const ok = (path: string, added: string[] = ["export const x = 1;"]) => ({ path, status: "M", added });

describe("FA-19080: the Ask agent's frontend write scope", () => {
  it("allows the frontend: app, public and shared/presentation", () => {
    for (const p of [
      "templates/cockpit/app/components/cockpit/OfficeCard.tsx",
      "templates/cockpit/app/global.css",
      "templates/cockpit/app/routes/_index.tsx",
      "templates/cockpit/public/icons/rocket.svg",
      "templates/cockpit/shared/presentation/office.ts",
    ]) expect(pathAllowed(p), p).toBe(true);
  });

  it("refuses the system side, configs and anything outside the app", () => {
    for (const p of [
      "templates/cockpit/server/cockpit/client.ts",
      "templates/cockpit/server/plugins/agent-chat.ts",
      "templates/cockpit/server/middleware/ask-agent-loopback.ts",
      "templates/cockpit/actions/cockpit-act.ts",
      "templates/cockpit/actions/get-cards.ts",
      "templates/cockpit/shared/cockpit-detail.ts",
      "templates/cockpit/shared/cockpit.ts",
      "templates/cockpit/shared/cockpit-manifest.json",
      "templates/cockpit/shared/presentation",
      "templates/cockpit/package.json",
      "templates/cockpit/vite.config.ts",
      "templates/cockpit/vitest.config.ts",
      "templates/cockpit/app/entry.server.tsx",
      "templates/cockpit/app/../server/x.ts",
      "packages/core/src/index.ts",
      "pnpm-lock.yaml",
      "/Users/nseidm1/Portfolio/tools/lane/maint/ui/index.html",
      "../Portfolio/tools/x.mjs",
    ]) expect(pathAllowed(p), p).toBe(false);
  });

  it("refuses the whole change when one path is outside, naming it", () => {
    const v = checkScope([ok("templates/cockpit/app/a.tsx"), ok("templates/cockpit/server/cockpit/client.ts")]);
    expect(v.ok).toBe(false);
    expect(v.refusals.join("\n")).toMatch(/server\/cockpit\/client\.ts: outside the frontend write scope/);
  });

  it("refuses added lines that turn frontend code into server code or a second path to the system", () => {
    const bad = [
      'import { readFile } from "node:fs/promises";',
      'import http from "http";',
      'const cp = await import("child_process");',
      'import { get } from "../../../server/cockpit/client";',
      'import act from "../../../actions/cockpit-act";',
      'import { createAgentChatPlugin } from "@agent-native/core/server";',
      "export async function loader() { return null; }",
      "export const action = async () => null;",
      "const k = process.env.SECRET;",
      'eval("1")',
      'const f = new Function("return 1");',
      'await fetch("/cards/x")',
      "const ws = new WebSocket(u);",
      'const u = "http://127.0.0.1:' + ["52", "07"].join("") + '/";',
      'const r = "/' + 'api/client/v1/resources/office";',
      "const p = " + ["52", "17"].join("") + ";",
    ];
    for (const line of bad) {
      const v = checkScope([ok("templates/cockpit/app/components/cockpit/X.tsx", [line])]);
      expect(v.ok, line).toBe(false);
    }
  });

  it("passes ordinary UI code, action hooks and SVG namespaces", () => {
    const v = checkScope([
      ok("templates/cockpit/app/components/cockpit/OfficeCard.tsx", [
        'import { useActionQuery } from "@agent-native/core/client/hooks";',
        'import { CARD_TITLES } from "@shared/cockpit";',
        'import { Icon } from "./icons";',
        'import { tone } from "../../../shared/presentation/office";',
        'const q = useActionQuery("cockpit-read", { resource: "office" });',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" />',
      ]),
      ok("templates/cockpit/app/global.css", [".of-tile { box-shadow: 0 0 12px var(--neon); }"]),
    ]);
    expect(v.refusals).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("reads porcelain -z output, renames giving both paths", () => {
    const out = " M templates/cockpit/app/a.tsx\0?? templates/cockpit/app/b.tsx\0R  templates/cockpit/app/c.tsx\0templates/cockpit/server/c.tsx\0";
    expect(parsePorcelainZ(out)).toEqual([
      { path: "templates/cockpit/app/a.tsx", status: "M" },
      { path: "templates/cockpit/app/b.tsx", status: "??" },
      { path: "templates/cockpit/app/c.tsx", status: "R" },
      { path: "templates/cockpit/server/c.tsx", status: "D" },
    ]);
  });

  it("reads the added lines of a -U0 diff per file", () => {
    const diff = [
      "diff --git a/templates/cockpit/app/a.tsx b/templates/cockpit/app/a.tsx",
      "--- a/templates/cockpit/app/a.tsx",
      "+++ b/templates/cockpit/app/a.tsx",
      "@@ -1 +1,2 @@",
      "-old",
      "+new one",
      "+new two",
    ].join("\n");
    expect(addedLinesFromDiff(diff).get("templates/cockpit/app/a.tsx")).toEqual(["new one", "new two"]);
  });
});
