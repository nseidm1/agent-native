import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/**
 * A home-column write (FA-19087): the Budget stepper through the cockpit action budget.set.
 * Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first.
 */
export default defineAction({
  description:
    "Set the cockpit's Budget: pctPerDay 1..100 (% of the weekly account limit the fleet may use per day) or auto true (derived from what is left of the week). The cockpit action budget.set.",
  schema: z.object({
    pctPerDay: z.number().min(1).max(100).optional().describe("% of the weekly limit per day"),
    auto: z.boolean().optional().describe("true = Auto"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ pctPerDay, auto }) => {
    const r = await forwardAct(COCKPIT_ACTIONS.budget, auto ? { auto: true } : { pctPerDay: pctPerDay as number });
    // the budget is a live read the change stream does not name: re-read it now so the stepper shows the saved value
    await get("budget", { fresh: true }).catch(() => null);
    return r;
  },
});
