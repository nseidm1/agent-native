import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getBoardCard } from "../server/cockpit/board.js";

export default defineAction({
  description:
    "Read one open board card in full: its face plus its body, its notes (the newest 16000 characters), its open questions and its sections. Read through the cockpit client's board/card/<fa> resource.",
  schema: z.object({
    fa: z.string().regex(/^FA-\d{1,6}$/).describe("The card, e.g. FA-123"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async ({ fa }) => getBoardCard(fa),
});
