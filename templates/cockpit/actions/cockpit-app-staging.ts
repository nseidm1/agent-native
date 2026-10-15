import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Apps (FA-19087): start an app's staging preview through the cockpit action apps.staging. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Start a studio app's staging preview. The cockpit action apps.staging.",
  schema: z.object({ app: z.string().max(80) }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ app }) => { const r = await forwardAct(COCKPIT_ACTIONS["app-staging"], { app }); await get("appdialog", { fresh: true }).catch(() => null); return r; },
});
