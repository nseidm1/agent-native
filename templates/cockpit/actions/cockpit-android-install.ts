import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Phone app (FA-19087): build and install the phone app on the attached phone through the cockpit action android.install. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Build and install the phone app on the attached phone (serial: the device). The cockpit action android.install.",
  schema: z.object({ serial: z.string().max(80).optional().describe("The device serial") }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ serial }) => { const r = await forwardAct(COCKPIT_ACTIONS["android-install"], serial ? { serial } : {}); await get("android", { fresh: true }).catch(() => null); return r; },
});
