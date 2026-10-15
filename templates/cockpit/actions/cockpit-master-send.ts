import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Message master (FA-19087): send master a message through the cockpit action master.send. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Send master a message (1 to 4000 characters). The cockpit action master.send.",
  schema: z.object({ text: z.string().min(1).max(4000).describe("The message") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ text }) => { const r = await forwardAct(COCKPIT_ACTIONS["master-send"], { text }); await get("master", { fresh: true }).catch(() => null); return r; },
});
