import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getBoard } from "../server/cockpit/board.js";

export default defineAction({
  description:
    "Read the whole board: every column (id, name, the board's count) and every open card (FA id, title, column, priority, estimate, parent, children, links, paused, triaged, blocked, chips, app, lane stage). Read through the cockpit client's board and board/cards resources.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => getBoard(),
});
