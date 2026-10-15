import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: a board card action. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Pause, resume, backlog, promote or archive a board card (the cockpit action board.cardAction).",
  schema: z.object({
    fa: z.string().regex(/^FA-\d{1,6}$/).describe("The card, e.g. FA-123"),
    action: z.enum(["pause", "resume", "backlog", "promote", "archive"]),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardAct(COCKPIT_ACTIONS["board-card"], { fa: a.fa, action: a.action }),
});
