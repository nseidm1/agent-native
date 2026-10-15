import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getCards } from "../server/cockpit/cards.js";

export default defineAction({
  description:
    "Read the cockpit's 14 status cards as a compact model: id, title, tone (g good, a attention, r broken, d no data), headline, sub line, chip, and an optional sparkline or meters. Mapped server-side from the cockpit client's bounded resources (etag-cached, refreshed on the client's change stream).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => getCards(),
});
