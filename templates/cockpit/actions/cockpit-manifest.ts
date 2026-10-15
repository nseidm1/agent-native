import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { manifest } from "../server/cockpit/client.js";

/**
 * The cockpit client's own manifest: every resource cockpit-read can read and
 * every action cockpit-act can run, with their descriptions and input
 * schemas. Read live, so a resource or action the cockpit adds is available
 * here with no change to this app (FA-19027).
 */
export default defineAction({
  description:
    "List what the cockpit offers through its client: every resource (name, description, freshness) that cockpit-read reads, and every action (name, description, whether it writes, its input schema) that cockpit-act runs. Read live from the cockpit's manifest.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => {
    const m = await manifest();
    return {
      version: m.version,
      resources: m.resources.map((r) => ({ name: r.name, description: r.description, maxAgeMs: r.freshness?.maxAgeMs ?? null })),
      actions: m.actions.map((a) => ({ name: a.name, description: a.description, write: a.write, input: a.schema })),
    };
  },
});
