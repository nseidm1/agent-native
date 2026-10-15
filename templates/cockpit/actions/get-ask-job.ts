import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dataDir } from "../server/cockpit/agent.js";
import { applyBusy, applyPaths, readJob } from "../server/cockpit/apply/job.js";

/**
 * An applied Ask agent change (FA-19080): its phases (worktree, agent, scope,
 * typecheck, tests, build, screenshot, commit, live, restart), the agent's
 * own summary, the commit, and any refusal. No id: the newest job. The panel
 * polls it while a change runs and reloads once the region restarted
 * (serverPid moves).
 */
export default defineAction({
  description: "Read an applied Ask agent change by id, or the newest one: status, phases, the agent's summary, commit, and any error.",
  schema: z.object({ id: z.string().regex(/^(ask|undo)-[a-z0-9-]{6,60}$/).optional().describe("The job id; the newest when left out") }),
  http: { method: "GET" },
  readOnly: true,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ id }) => {
    const P = applyPaths(dataDir());
    return { job: readJob(P, id), busy: applyBusy(), serverPid: process.pid };
  },
});
