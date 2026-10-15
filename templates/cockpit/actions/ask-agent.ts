import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { ASK_AGENT_MAX_BODY_BYTES, MAX_ASK_IMAGES } from "../shared/ask-images.js";
import { AgentError, askAgent } from "../server/cockpit/agent.js";
import { askerCanApply } from "../server/middleware/ask-agent-loopback.js";

/**
 * The "Ask agent" panel. Each ask is first split into parts by a tool-less CLI call
 * (server/cockpit/classify.ts; FA-19087: each part takes its own path, a layout part
 * set-layout cannot express escalates to change, a board card action is offered as a
 * one-tap confirm and never filed): a frontend "change" is APPLIED live by
 * agent-native's code agent behind the gates (server/cockpit/apply/job.ts,
 * FA-19080; the panel follows it with get-ask-job and offers undo-ask-change);
 * a "system" request is filed as a board card with its images
 * (server/cockpit/request-card.ts) and never executed; layout and read
 * run the Mac's logged-in Claude Code CLI against this
 * app's own MCP tools (get-cards, get-card-detail, get-layout, set-layout) and nothing else;
 * UI only: never an agent or MCP tool, so a run cannot start another run.
 * server/middleware/ask-agent-loopback.ts admits this Mac and, through the cockpit's front, a remote viewer:
 * a PAIRED phone (the front's x-cockpit-write: verified mark, Portfolio MI-388) applies changes exactly as this
 * Mac does; an unpaired one gets reads, an unchanged layout and its change requests filed as cards.
 * Up to 3 images ride along as base64; the body bound is sized to exactly
 * three 5 MB images plus the question (ASK_AGENT_MAX_BODY_BYTES), and each
 * image is checked by its magic bytes server-side (server/cockpit/agent.ts).
 */
export default defineAction({
  description:
    "Ask the cockpit's agent (the Mac's Claude Code CLI): a tool-less classifier splits the request into parts and picks each part's path; a layout or read part runs the agent (it may rearrange the 14 region cards through set-layout), and a layout part set-layout cannot express escalates to the change path; a frontend change is applied live by agent-native's code agent once its gates pass (followed with get-ask-job); a board card action (cancel, pause, resume, backlog, promote) is returned as an offer the viewer taps (cockpit-board-card-action); a request that needs the system side is filed as a board card with its images and never executed. Every ask is logged for the routing KPI (get-ask-routes).",
  schema: z.object({
    question: z.string().min(1).max(2000).describe("The question, at most 2000 characters"),
    images: z
      .array(
        z.object({
          name: z.string().max(200),
          // the size is checked in agent.ts decodeImage, so a too-large image gets a plain "larger than 5 MB"
          data: z.string(),
        }),
      )
      .max(MAX_ASK_IMAGES)
      .optional()
      .describe("Up to 3 PNG, JPEG, WebP or GIF images, base64, 5 MB each"),
  }),
  maxBodyBytes: ASK_AGENT_MAX_BODY_BYTES,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ question, images }, ctx) => {
    try {
      // MI-388: this Mac or a paired phone (the front's mark) applies; any other remote viewer reads and files, and never moves the layout
      const canApply = askerCanApply(ctx?.requestHeaders?.get("x-cockpit-peer"), ctx?.requestHeaders?.get("x-cockpit-write"));
      return await askAgent(question, ctx?.userEmail, images ?? [], { canApply });
    } catch (e) {
      // the CLI's own error line (missing, logged out, timed out) reaches the panel
      if (e instanceof AgentError) fail(e.message, { errorCode: "ask_agent_failed", statusCode: e.status });
      throw e;
    }
  },
});
