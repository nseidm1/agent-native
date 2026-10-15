import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Claude account (FA-19087): start a sign-in, a swap or the Halo login through the cockpit action account.start. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Start a Claude sign-in, an account swap or the Halo login (kind signin | swap | halo; email optional). The cockpit action account.start.",
  schema: z.object({ kind: z.enum(["signin", "swap", "halo"]).describe("What to start"), email: z.string().max(200).optional().describe("The account email, when known") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ kind, email }) => { const r = await forwardAct(COCKPIT_ACTIONS["account-start"], email ? { kind, email } : { kind }); await get("account", { fresh: true }).catch(() => null); return r; },
});
