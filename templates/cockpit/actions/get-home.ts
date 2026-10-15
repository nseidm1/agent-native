import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getHome } from "../server/cockpit/home.js";

export default defineAction({
  description:
    "Read the full cockpit's top bar and home column (FA-19087): the status pill, account, push and phone chips; the lane switches (lock, Production, Client); the Budget; the office tiles; the overview, door-to-landing and speed faces; the drafting-mode face; and the key-number tiles (velocity, JEV, landed today, Halo, Balancer, worktrees, features proven, cost and time per commit) with their charts. Built server-side from the cockpit client's resources.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => getHome(),
});
