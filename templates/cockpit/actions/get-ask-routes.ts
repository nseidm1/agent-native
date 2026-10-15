import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dataDir } from "../server/cockpit/agent.js";
import { applyPaths, readJob } from "../server/cockpit/apply/job.js";
import { readRouteKpi } from "../server/cockpit/ask-routes.js";

/**
 * THE ASK AGENT'S ROUTING KPI (FA-19087): how often the classifier's first label was wrong. Read from the region's own
 * state (ask-routes.jsonl, with ask-agent.log backfilled before it), an applied change's outcome resolved from its job.
 * The fork's own data: nothing here reads the system, so client.ts is not involved.
 */
export default defineAction({
  description:
    "The Ask agent's routing KPI: the misroute rate (a part escalated, a change that needed the system side, a dead end, an undone change, the same request re-asked within 10 minutes, or a failed classifier), its reasons, and the recent routes.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  run: async () => {
    const P = applyPaths(dataDir());
    return readRouteKpi(dataDir(), (id) => {
      try {
        return readJob(P, id)?.status ?? null;
      } catch {
        return null;
      }
    });
  },
});
