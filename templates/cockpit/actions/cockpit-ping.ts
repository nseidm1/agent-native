import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { act, streamConnected } from "../server/cockpit/client.js";

/** The client round trip, end to end: the cockpit's ping action echoes the text back (it writes nothing). */
export default defineAction({
  description: "Check the cockpit client end to end: runs the cockpit's ping action, which echoes the text back, and says how long it took and whether the change stream is up.",
  schema: z.object({ text: z.string().min(1).max(200).default("ping") }),
  readOnly: true,
  mcpTool: false,
  run: async ({ text }) => {
    const t0 = Date.now();
    const r = await act<any>("ping", { text });
    return { echo: r && typeof r === "object" ? (r.text ?? r.echo ?? r) : r, ms: Date.now() - t0, live: streamConnected() };
  },
});
