import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: a Halo model on/off. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Turn a Halo model on or off (the cockpit action halo.setModel).",
  schema: z.object({
    id: z.string().regex(/^[\w.-]{1,80}$/).describe("The model id from the halo card"),
    enabled: z.boolean(),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardAct(COCKPIT_ACTIONS["halo-model"], { id: a.id, enabled: a.enabled }),
});
