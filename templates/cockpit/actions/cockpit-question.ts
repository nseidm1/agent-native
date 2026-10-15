import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { get } from "../server/cockpit/client.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** Console questions (FA-19087): answer, overrule, snooze, unsnooze, undo or drop a console question through the cockpit actions questions.*. Loopback callers, or a phone the cockpit's write gate admits (MI-370); the agent must ask first. */
export default defineAction({
  description:
    "Act on a console question: verb answer | overrule (option and/or text) | snooze (minutes) | unsnooze | undo | drop (reason). The cockpit actions questions.<verb>.",
  schema: z.object({ verb: z.enum(["answer", "overrule", "snooze", "unsnooze", "undo", "drop"]).describe("What to do"), id: z.string().max(80).describe("The question id"), option: z.union([z.number().int().min(0).max(100), z.string().max(400)]).optional().describe("The choice: its index in the question's options, or its label"), text: z.string().max(4000).optional(), minutes: z.number().max(100000).optional(), reason: z.string().max(500).optional() }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ verb, option, ...input }) => {
    // MI-373: the cockpit reads a choice as its option INDEX; a label (an overrule's select) is resolved here from the question itself
    let idx: number | undefined = typeof option === "number" ? option : undefined;
    if (typeof option === "string") {
      const r = await get<{ items?: { id: string; options?: { label?: string }[] }[]; recent?: { id: string; options?: { label?: string }[] }[] }>("questions", { fresh: true });
      const q = [...(r.data.items || []), ...(r.data.recent || [])].find((x) => x.id === input.id);
      const k = q && q.options ? q.options.findIndex((o) => o && o.label === option) : -1;
      if (k < 0) throw new Error("No choice “" + option + "” on that question any more");
      idx = k;
    }
    const r = await forwardAct(COCKPIT_ACTIONS.question + "." + verb, idx === undefined ? input : { ...input, option: idx });
    await get("questions", { fresh: true }).catch(() => null);
    return r;
  },
});
