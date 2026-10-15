import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Claude account (FA-19087): enter the one-time sign-in code through the cockpit action account.code (never echoed back). Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Enter the one-time code the sign-in page showed. The cockpit action account.code; the code is never echoed back.",
  schema: z.object({ code: z.string().min(1).max(400).describe("The one-time code") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ code }) => { const r = await forwardAct(COCKPIT_ACTIONS["account-code"], { code }); await get("account", { fresh: true }).catch(() => null); return r; },
});
