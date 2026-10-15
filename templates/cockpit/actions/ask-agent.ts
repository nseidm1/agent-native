import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { AgentError, askAgent } from "../server/cockpit/agent.js";

/**
 * The "Ask agent" panel: runs the Mac's logged-in Claude Code CLI against this
 * app's own MCP tools (get-cards, get-layout, set-layout) and nothing else.
 * UI only: never an agent or MCP tool, so a run cannot start another run.
 * server/middleware/ask-agent-loopback.ts refuses any non-loopback request.
 */
export default defineAction({
  description:
    "Ask the cockpit's agent (the Mac's Claude Code CLI) a question about the card region; it may rearrange cards through set-layout.",
  schema: z.object({
    question: z.string().min(1).max(2000).describe("The question, at most 2000 characters"),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ question }, ctx) => {
    try {
      return await askAgent(question, ctx?.userEmail);
    } catch (e) {
      // the CLI's own error line (missing, logged out, timed out) reaches the panel
      if (e instanceof AgentError) fail(e.message, { errorCode: "ask_agent_failed", statusCode: e.status });
      throw e;
    }
  },
});
