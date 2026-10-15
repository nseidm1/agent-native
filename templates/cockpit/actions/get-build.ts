import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { buildId } from "../server/cockpit/build-id.js";

export default defineAction({
  description: "This cockpit app's build id (FA-19135): it changes when the region restarts on a new build, which the page shows as the 'cockpit updated' bar.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: false,
  run: async () => ({ build: buildId() }),
});
