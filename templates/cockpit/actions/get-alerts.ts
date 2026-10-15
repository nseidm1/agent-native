import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getAlerts } from "../server/cockpit/alerts.js";

export default defineAction({
  description:
    "Read the cockpit's alert toasts (FA-19135): fleet blockers, parked blockers, lane contradictions, service-health and lane-check alerts each with its remedy's true state, and the Budget pace flags and notes - the words the toasts show, in the legacy page's order.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => getAlerts(),
});
