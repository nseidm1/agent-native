import { defineNitroPlugin, recordChange } from "@agent-native/core/server";

import { events } from "../cockpit/client.js";

/**
 * FA-19027: the region's liveness. The cockpit client keeps ONE change stream
 * to the cockpit (it names the resources a rebuild moved); each event becomes
 * a framework "cockpit" change, which the page hears on its own sync transport
 * (useDbSync in CardRegion) and answers by re-reading its queries, whose reads
 * the client answers from its etag cache or with a 304. COCKPIT_LIVE=0 turns
 * it off (the page then falls back to its slow query intervals).
 */
export default defineNitroPlugin(() => {
  if (process.env.COCKPIT_LIVE === "0") return;
  events((e) => {
    if (e.kind === "down" || (e.kind === "changed" && !e.resources.length)) return;
    recordChange({ source: "cockpit", type: "change", key: e.kind === "hello" ? "hello" : e.resources.slice(0, 12).join(",") });
  });
});
