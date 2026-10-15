import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

/**
 * FA-19087 phone writes parity (MI-370): whether this viewer's cockpit writes will be admitted. An HTTP viewer is
 * answered by server/middleware/ask-agent-loopback.ts, by the same rule its writes are gated by (this Mac, or a
 * phone the cockpit's own write gate admits, which the cockpit's front marks); the agent itself runs on this Mac.
 */
export default defineAction({
  description: "Whether this viewer may run the cockpit's writes (the lane switches, Budget, card actions): { canWrite, via }. This Mac always may; a phone may where the cockpit's own write gate admits it.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  run: async () => ({ canWrite: true, via: "this Mac" }),
});
