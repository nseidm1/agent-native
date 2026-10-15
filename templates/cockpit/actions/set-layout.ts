import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { CARD_IDS } from "../shared/cockpit.js";
import { writeLayout } from "../server/cockpit/layout.js";

const band = z.object({
  id: z.string().describe("Band id: lowercase letters, digits or dashes"),
  title: z.string().describe("Band title shown in the region"),
  cards: z.array(z.string()).describe("Card ids in display order"),
});

export default defineAction({
  description: `Replace the card region's whole layout. Send every band with its ordered card ids; a known card left out of every band and of hidden is appended to the last band. Every id must be one of: ${CARD_IDS.join(", ")}; an unknown id is refused with an error and nothing is written. Read get-layout first and change only what was asked.`,
  schema: z.object({
    bands: z.array(band).min(1).max(8),
    hidden: z.array(z.string()).optional().describe("Card ids to hide"),
    size: z
      .record(z.string(), z.enum(["s", "m", "l"]))
      .optional()
      .describe("Per-card size; 'l' spans both columns on desktop"),
  }),
  mcpTool: true,
  run: async (args) => writeLayout(args),
});
