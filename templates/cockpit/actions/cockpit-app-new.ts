import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Apps (FA-19087): start a new studio app through the cockpit action apps.new. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Start a new studio app from a name and its brief. The cockpit action apps.new.",
  schema: z.object({ name: z.string().min(1).max(80), description: z.string().min(1).max(20000) }),
  needsApproval: true,
  mcpTool: false,
  run: async (input) => { const r = await forwardAct(COCKPIT_ACTIONS["app-new"], input); await get("board", { fresh: true }).catch(() => null); return r; },
});
