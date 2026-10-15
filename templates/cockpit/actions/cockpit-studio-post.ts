import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { COCKPIT_ACTIONS } from "../shared/cockpit-detail.js";
import { forwardAct } from "../server/cockpit/write-action.js";

/**
 * FA-19087 (FA-19172..FA-19175): one of an app studio's own writes through the cockpit action studio.post (MI-379): the Agent
 * chat (chat/send, chat/stop, chat/plan/<id>[/approve|/cancel]), a staged change's Undo / Retry / Stop, the menus' jobs and
 * their dialogs (ask, newdesign/draw|apply, designs/swap, lens/<id>/run|accept|decline|decide, kpis, QA run, mocks), the live
 * frame's tools (frame/_/src|tweak|ask|recolor, comments) and the deploy (env promote, ready, rollback, autopilot,
 * checkpoints). Behind the cockpit's write gate exactly as the legacy studio is: loopback callers, or a phone the gate admits
 * (MI-370). The agent must ask first; several of these spend money or change the app.
 */
export default defineAction({
  description:
    "Run one of an app studio's own writes (root app | qa | env, its path and JSON body), e.g. app chat/send {text, model}, app staged/<id>/undo, env promote, qa run. The cockpit action studio.post; only its allow-listed routes answer.",
  schema: z.object({
    app: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/).describe("The app id"),
    root: z.enum(["app", "qa", "env"]).describe("Which of the studio's route families"),
    path: z.string().max(200).describe("The route within it"),
    body: z.record(z.string(), z.any()).default({}).describe("The JSON body the legacy studio sends"),
  }),
  needsApproval: true,
  mcpTool: false,
  run: async ({ app, root, path, body }) => forwardAct(COCKPIT_ACTIONS["studio-post"], { app, root, path, body: body || {} }),
});
