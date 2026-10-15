import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Issues (FA-19087): retry an issue, move it to another tier or close it through the cockpit action issues.act. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Act on an issue: do retry | tier (tier haiku | sonnet | opus | human) | close (reason). The cockpit action issues.act.",
  schema: z.object({ id: z.string().max(80).describe("The issue id"), do: z.enum(["retry", "tier", "close"]), tier: z.enum(["haiku", "sonnet", "opus", "human"]).optional(), reason: z.string().max(500).optional() }),
  needsApproval: true,
  mcpTool: false,
  run: async (input) => { const r = await forwardAct(COCKPIT_ACTIONS.issue, input); await get("issues", { fresh: true }).catch(() => null); return r; },
});
