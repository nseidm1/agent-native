/**
 * Writes shared/cockpit-manifest.json from the cockpit's live manifest, through
 * the client (FA-19027). The snapshot is what server/cockpit/manifest-parity.spec.ts
 * checks this app's resource and action names against when the cockpit is not
 * running; nothing reads it at run time (the agent's cockpit-manifest,
 * cockpit-read and cockpit-act read the live manifest).
 *
 *   pnpm script sync-manifest     (or: tsx scripts/sync-manifest.ts)
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { manifest } from "../server/cockpit/client.js";

export default async function main() {
  const m = await manifest(true);
  const snap = {
    version: m.version,
    resources: m.resources.map((r) => ({ name: r.name, description: r.description })),
    actions: m.actions.map((a) => ({ name: a.name, write: a.write, schema: a.schema })),
  };
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "cockpit-manifest.json");
  writeFileSync(out, JSON.stringify(snap, null, 1) + "\n");
  console.log("wrote " + out + ": " + snap.resources.length + " resources, " + snap.actions.length + " actions");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
