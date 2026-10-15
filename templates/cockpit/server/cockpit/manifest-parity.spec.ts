/**
 * FA-19027: this app's tool surface is checked against the cockpit's manifest.
 * Every resource it reads and every action it runs BY NAME must be one the
 * manifest publishes: always against the committed snapshot
 * (shared/cockpit-manifest.json, written by scripts/sync-manifest.ts), and
 * against the live manifest when the cockpit answers. A resource or action the
 * cockpit ADDS needs no change here: cockpit-read and cockpit-act take any
 * manifest name, and cockpit-manifest lists them live.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COCKPIT_ACTION_NAMES_USED } from "../../shared/cockpit-detail";
import { manifest } from "./client";
import { HOME_RESOURCES } from "./home";
import { STATE_RESOURCES } from "./state";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const snap = JSON.parse(readFileSync(path.join(HERE, "..", "..", "shared", "cockpit-manifest.json"), "utf8"));

/** Every resource name this app reads (board/card/{fa} is the template board.ts fills). */
export const RESOURCES_USED = [...new Set([...STATE_RESOURCES, ...HOME_RESOURCES, "halomodels", "appdata", "estimate", "board/card/{fa}"])];
/** Every action name this app runs: the dialog writes, the request images and the ping. */
export const ACTIONS_USED = [...COCKPIT_ACTION_NAMES_USED, "board.attach", "ping"];

function missing(m: { resources: { name: string }[]; actions: { name: string }[] }) {
  const rs = new Set(m.resources.map((r) => r.name));
  const as = new Set(m.actions.map((a) => a.name));
  return { resources: RESOURCES_USED.filter((n) => !rs.has(n)), actions: ACTIONS_USED.filter((n) => !as.has(n)) };
}

describe("the manifest carries every name this app uses", () => {
  it("against the committed snapshot", () => {
    expect(missing(snap)).toEqual({ resources: [], actions: [] });
  });

  it("every action this app's code names through act() or forwardAct() is a manifest action", () => {
    const root = path.join(HERE, "..", "..");
    const names = new Set<string>();
    for (const rel of ["server/cockpit/request-card.ts", "actions/cockpit-ping.ts"]) {
      for (const m of readFileSync(path.join(root, rel), "utf8").matchAll(/\bact(?:<[^>]*>)?\("([^"]+)"/g)) names.add(m[1]);
    }
    expect([...names].sort()).toEqual(["board.attach", "ping"]);
    for (const n of names) expect(ACTIONS_USED).toContain(n);
  });

  it("against the live cockpit, when it answers", async (ctx) => {
    let live;
    try {
      live = await manifest(true);
    } catch {
      ctx.skip();
      return;
    }
    expect(missing(live)).toEqual({ resources: [], actions: [] });
  });
});
