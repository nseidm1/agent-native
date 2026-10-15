import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { WINDOW_IDS } from "../shared/cockpit-windows.js";
import { getWindow } from "../server/cockpit/windows/registry.js";

/**
 * FA-19087: one of the cockpit's own windows (Overview, Who's working, the commit queue, JEV, Halo savings,
 * Balancer, the account, push, phone, master, questions, issues and apps windows), built from the cockpit
 * client's resources as a detail document.
 */
export default defineAction({
  description:
    "Read one cockpit window by id (overview, agents, queue, jev, halosave, balancer, account, push, phone, master, questions, issues, apps): stats, tables, lists and bars built from the cockpit client's resources, in the cockpit's own words. Optional filter args per window (view, window, cls, app).",
  schema: z.object({
    id: z.enum(WINDOW_IDS).describe("The window id"),
    view: z.string().max(40).optional().describe("A window's view filter, when it has one"),
    window: z.string().max(20).optional().describe("A time window filter, when it has one"),
    cls: z.string().max(20).optional().describe("A work-class filter, when it has one"),
    app: z.string().max(80).optional().describe("An app id, when the window takes one"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async ({ id, ...args }) => getWindow(id, args),
});
