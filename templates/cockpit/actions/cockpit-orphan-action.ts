import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { forwardWrite } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: an orphan remedy. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Land, discard (archive, with a reason) or hand to another agent an orphaned piece of work from the work-state ledger (POST /api/orphans/<id>/<action>).",
  schema: z.object({
    id: z.string().regex(/^[\w.:-]{1,80}$/).describe("The ledger item id"),
    action: z.enum(["land", "discard", "hand"]),
    agent: z.string().regex(/^[\w-]{1,60}$/).optional().describe("hand: the agent to hand it to"),
    reason: z.string().max(500).optional().describe("discard: why (required)"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardWrite("/api/orphans/" + a.id + "/" + a.action, { ...(a.agent ? { agent: a.agent } : {}), ...(a.reason ? { reason: a.reason } : {}) }),
});
