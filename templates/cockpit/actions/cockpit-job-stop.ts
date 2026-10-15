import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: stop a job. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Stop a running agent job, or cancel a waiting one (the cockpit action jobs.stop).",
  schema: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).describe("The job name from the jobs card"),
    id: z.string().regex(/^rq-[a-z0-9-]+$/).optional().describe("The request id, when stopping one request"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardAct(COCKPIT_ACTIONS["job-stop"], { name: a.name, ...(a.id ? { id: a.id } : {}) }),
});
