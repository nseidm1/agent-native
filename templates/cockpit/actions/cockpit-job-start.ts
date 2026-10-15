import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/** A cockpit dialog write: start an agent job. Loopback callers only (server/middleware/ask-agent-loopback.ts); the agent must ask first. */
export default defineAction({
  description: "Start a one-off agent job in the cockpit (the cockpit action jobs.start): kind is a job kind id from the jobs card, text is the job in plain words, with an optional spending cap in dollars and time cap in minutes.",
  schema: z.object({
    kind: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).describe("Job kind id, e.g. ui-builder"),
    text: z.string().min(1).max(4000).describe("The job, in plain words"),
    maxUsd: z.number().positive().max(100).optional().describe("Spending cap in dollars"),
    maxMin: z.number().int().positive().max(600).optional().describe("Time cap in minutes"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async (a) => forwardAct(COCKPIT_ACTIONS["job-start"], { kind: a.kind, text: a.text, ...(a.maxUsd != null ? { maxUsd: a.maxUsd } : {}), ...(a.maxMin != null ? { maxMin: a.maxMin } : {}) }),
});
