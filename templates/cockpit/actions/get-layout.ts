import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readLayout } from "../server/cockpit/layout.js";

export default defineAction({
  description:
    "Read the card region's layout: bands (id, title, ordered card ids), hidden card ids, and per-card size ('s' | 'm' | 'l'; 'l' spans both columns on desktop).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => readLayout(),
});
