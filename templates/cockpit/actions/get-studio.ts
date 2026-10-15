import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { ClientError, STUDIO_ROOTS, studioGet } from "../server/cockpit/client.js";

/**
 * FA-19087 (FA-19172..FA-19175): one of an app studio's own reads, through the cockpit client (MI-379) - the Agent chat and its
 * live reply (app chat, chat/live), the live frame's info and variants (app frame/_/info, frame/_/variants), the comments, the
 * designs, a lens (app lens/<id>), the KPIs, the launch scorecard, the jobs in flight (app live), the staged changes, QA (qa,
 * qa/checklist, qa/mocks, qa/quote with n/model), the deploy (env, env/ready, env/autopilot, env/checkpoints), the model
 * state (studio qwen). Only what the cockpit's allow-list carries answers; its refusal comes back in its own words.
 */
export default defineAction({
  description:
    "Read one of an app studio's own reads by root (app | qa | env | studio) and path: app chat, chat/live, frame/_/info, frame/_/variants, comments, designs, lens/<id>, kpis, launch, live, staged, lifecycle; qa '', checklist, mocks, quote (n, model); env '', ready, ready/plan, promote, autopilot, checkpoints; studio qwen, actions.",
  schema: z.object({
    app: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).describe("The app id"),
    root: z.enum(STUDIO_ROOTS).describe("Which of the studio's route families"),
    path: z.string().max(200).default("").describe("The route within it ('' for its root)"),
    n: z.coerce.number().int().min(1).max(99).optional().describe("qa quote: the number of QA agents"),
    model: z.string().max(24).optional().describe("qa quote: the judge model"),
    focus: z.string().max(200).optional().describe("qa quote: the flows to focus on (comma-separated)"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async ({ app, root, path, n, model, focus }) => {
    try {
      return await studioGet(app, root, path || "", { ...(n ? { n } : {}), ...(model ? { model } : {}), ...(focus ? { focus } : {}) });
    } catch (e) {
      if (e instanceof ClientError) fail(e.message, { errorCode: "studio_read_failed", statusCode: e.status >= 400 && e.status < 600 ? e.status : 502 });
      throw e;
    }
  },
});
