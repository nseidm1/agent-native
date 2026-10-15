import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { forwardWrite } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: turn the production data Funnel on. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Turn on public collection of production app data through the Tailscale Funnel (POST /api/env/_data {action: funnel-on, confirm: true}).",
  schema: z.object({
    confirm: z.literal(true).describe("Must be true: turning public collection on is deliberate"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardWrite("/api/env/_data", { action: "funnel-on", confirm: a.confirm }),
});
