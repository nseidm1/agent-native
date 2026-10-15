import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { ASK_AGENT_MAX_BODY_BYTES, MAX_ASK_IMAGES } from "../shared/ask-images.js";
import { AgentError, askAgent } from "../server/cockpit/agent.js";

/**
 * The "Ask agent" panel: runs the Mac's logged-in Claude Code CLI against this
 * app's own MCP tools (get-cards, get-card-detail, get-layout, set-layout) and nothing else;
 * UI only: never an agent or MCP tool, so a run cannot start another run.
 * server/middleware/ask-agent-loopback.ts refuses any non-loopback request.
 * Up to 3 images ride along as base64; the body bound is sized to exactly
 * three 5 MB images plus the question (ASK_AGENT_MAX_BODY_BYTES), and each
 * image is checked by its magic bytes server-side (server/cockpit/agent.ts).
 */
export default defineAction({
  description:
    "Ask the cockpit's agent (the Mac's Claude Code CLI) a question about the card region; it may rearrange cards through set-layout.",
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
      return await askAgent(question, ctx?.userEmail, images ?? []);
    } catch (e) {
      // the CLI's own error line (missing, logged out, timed out) reaches the panel
      if (e instanceof AgentError) fail(e.message, { errorCode: "ask_agent_failed", statusCode: e.status });
      throw e;
    }
  },
});
