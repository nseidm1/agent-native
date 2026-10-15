import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { dataDir } from "../server/cockpit/agent.js";
import { applyPaths, startUndo } from "../server/cockpit/apply/job.js";
import { liveDeps } from "../server/cockpit/apply/runtime.js";

/**
 * The one-click Undo of an applied Ask agent change (FA-19080): reverts its
 * commit in the fork, so the live tree is the previous live commit's, then
 * rebuilds and restarts the region (server/cockpit/apply/job.ts runUndo).
 * Loopback only (server/middleware/ask-agent-loopback.ts), UI only: never an
 * agent or MCP tool.
 */
export default defineAction({
  description: "Undo an applied Ask agent change (the newest live one, or the one named): revert its commit, rebuild, restart the region.",
  schema: z.object({ id: z.string().regex(/^ask-[a-z0-9-]{6,60}$/).optional().describe("The applied job to undo; the newest live one when left out") }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ id }) => {
    const P = applyPaths(dataDir());
    try {
      const j = startUndo(P, id, liveDeps(P, async () => null));
      return { job: { id: j.id, status: j.status } };
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e), { errorCode: "undo_refused", statusCode: 409 });
    }
  },
});
