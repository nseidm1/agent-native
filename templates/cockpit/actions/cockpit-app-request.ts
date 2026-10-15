import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Apps (FA-19087): file a request against an app through the cockpit action apps.request. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "File a request against a studio app (kind feature | fix | polish; title, what, done, where). The cockpit action apps.request.",
  schema: z.object({ app: z.string().max(80), kind: z.enum(["feature", "fix", "polish"]), title: z.string().min(1).max(80), what: z.string().min(1).max(2000), done: z.string().max(400).optional(), where: z.string().max(200).optional() }),
  needsApproval: true,
  mcpTool: false,
  run: async (input) => { const r = await forwardAct(COCKPIT_ACTIONS["app-request"], input); await get("board", { fresh: true }).catch(() => null); return r; },
});
