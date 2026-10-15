import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/**
 * A home-column write (FA-19087): set ONE lane switch through the cockpit action locks.set.
 * Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first.
 */
export default defineAction({
  description:
    "Set one of the cockpit's lane switches: switch 'lock' (on = master interventions allowed, i.e. Unlocked), 'production' (on = the dispatcher starts new door runs) or 'client' (on = Halo client calls run; off trips them). The cockpit action locks.set.",
  schema: z.object({
    switch: z.enum(["lock", "production", "client"]).describe("Which switch"),
    on: z.boolean().describe("lock: true = Unlocked (MIs allowed); production / client: true = On"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ switch: sw, on }) => {
    const key = sw === "lock" ? "masterIntervene" : sw === "production" ? "dispatcher" : "haloClient";
    const r = await forwardAct(COCKPIT_ACTIONS["lane-switch"], { [key]: on });
    await get("status", { fresh: true }).catch(() => null);
    return r;
  },
});
