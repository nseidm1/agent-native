import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Claude account (FA-19087): move the account flow (retry, checkpoint, skip, cancel, dismiss, resume) through the cockpit action account.step. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Move the Claude account flow: retry, checkpoint, skip, cancel, dismiss or resume. The cockpit action account.step.",
  schema: z.object({ act: z.enum(["retry", "checkpoint", "skip", "cancel", "dismiss", "resume"]).describe("The step") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ act }) => { const r = await forwardAct(COCKPIT_ACTIONS["account-step"], { act }); await get("account", { fresh: true }).catch(() => null); return r; },
});
