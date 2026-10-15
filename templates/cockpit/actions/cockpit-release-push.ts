import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Push to remote (FA-19087): push local master to its upstream, the console's act, through the cockpit action release.push. It can take minutes. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Push local master to the remote (the console's own act; ask first). confirm must be true. The cockpit action release.push.",
  schema: z.object({ confirm: z.literal(true).describe("Must be true: the push is the console's act") }),
  needsApproval: true,
  mcpTool: false,
  run: async () => { const r = await forwardAct(COCKPIT_ACTIONS.push, { confirm: true }); await get("release", { fresh: true }).catch(() => null); return r; },
});
