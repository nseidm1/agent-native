import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: release now or switch auto-release. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Release every landed system card now, or switch auto-release on or off (the cockpit actions release.now and release.auto): send {} to release now, {auto: true|false} to switch.",
  schema: z.object({
    auto: z.boolean().optional().describe("Switch auto-release; leave out to release now"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => (a.auto === undefined ? forwardAct(COCKPIT_ACTIONS.release + ".now", {}) : forwardAct(COCKPIT_ACTIONS.release + ".auto", { auto: a.auto })),
});
