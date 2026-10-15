import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Console questions (FA-19087): answer, overrule, snooze, unsnooze, undo or drop a console question through the cockpit actions questions.*. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Act on a console question: verb answer | overrule (option and/or text) | snooze (minutes) | unsnooze | undo | drop (reason). The cockpit actions questions.<verb>.",
  schema: z.object({ verb: z.enum(["answer", "overrule", "snooze", "unsnooze", "undo", "drop"]).describe("What to do"), id: z.string().max(80).describe("The question id"), option: z.string().max(400).optional(), text: z.string().max(4000).optional(), minutes: z.number().max(100000).optional(), reason: z.string().max(500).optional() }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ verb, ...input }) => { const r = await forwardAct(COCKPIT_ACTIONS.question + "." + verb, input); await get("questions", { fresh: true }).catch(() => null); return r; },
});
