import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Overview strictness (FA-19087): turn ONE production gate on or off through the cockpit action strict.set. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Turn one production gate on or off (drafterFloor, auditors, review, suite, kick, shipping, releaseGate, batch, brief, sendBack); turning releaseGate off needs confirm true. The cockpit action strict.set.",
  schema: z.object({ gate: z.enum(["drafterFloor", "auditors", "review", "suite", "kick", "shipping", "releaseGate", "batch", "brief", "sendBack"]).describe("The gate"), on: z.boolean().describe("On or off"), confirm: z.boolean().optional().describe("Required true to turn releaseGate off") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ gate, on, confirm }) => { const r = await forwardAct(COCKPIT_ACTIONS.strict, { gate, on, ...(confirm ? { confirm: true } : {}) }); await get("status", { fresh: true }).catch(() => null); return r; },
});
