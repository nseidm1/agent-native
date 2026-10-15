import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { CARD_IDS } from "../shared/cockpit.js";
import { getCardDetail } from "../server/cockpit/card-detail.js";

export default defineAction({
  description:
    "Read one cockpit card's detail (what its click window shows): stats, tables and lists built from the cockpit client's resources, in the cockpit's own words. Bounded: lists at most 200 rows, strings at most 300 characters. For modes, cls (all | hot | system | production) and window (today | 7d | all) pick the work class and window.",
  schema: z.object({
    id: z.enum(CARD_IDS).describe("The card id"),
    cls: z.enum(["all", "hot", "system", "production"]).optional().describe("modes only: the work class"),
    window: z.enum(["today", "7d", "all"]).optional().describe("modes only: the window"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async ({ id, cls, window }) => getCardDetail(id, { cls, window }),
});
