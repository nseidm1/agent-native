import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { forwardWrite } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: a Halo model on/off. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Turn a Halo model on or off (POST /api/halo/models/<id> {enabled}).",
  schema: z.object({
    id: z.string().regex(/^[\w.-]{1,80}$/).describe("The model id from the halo card"),
    enabled: z.boolean(),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardWrite("/api/halo/models/" + a.id, { enabled: a.enabled }),
});
