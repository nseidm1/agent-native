import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { forwardAct } from "../server/cockpit/write-action.js";

/**
 * Run any cockpit action by its manifest name (cockpit-manifest lists them and
 * their input schemas), so an action the cockpit adds is usable with no change
 * to this app (FA-19027). The input is checked against the manifest's schema
 * before it is sent. Loopback callers only (server/middleware/ask-agent-loopback.ts),
 * the agent must ask first, and it is never an MCP tool: the Ask agent stays
 * cards-only.
 */
export default defineAction({
  description:
    "Run one cockpit action by its manifest name (see cockpit-manifest), with its input, e.g. board.cardAction {fa, action}. The input is checked against the action's schema; the cockpit's own refusal comes back in its words.",
  schema: z.object({
    name: z.string().regex(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/).describe("The action name from cockpit-manifest"),
    input: z.record(z.string(), z.unknown()).default({}).describe("The action's input, per its schema"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ name, input }) => forwardAct(name, input),
});
