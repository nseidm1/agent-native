import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { get } from "../server/cockpit/client.js";

export const READ_MAX_CHARS = 60_000;

/**
 * Read any cockpit resource by its manifest name (cockpit-manifest lists them):
 * status, score, jobs, halo, board/cards, board/card/FA-123 and whatever the
 * cockpit adds later, with no change to this app (FA-19027). The answer is
 * the resource's own data; one larger than the bound comes back as its top
 * level with each field cut, and says so.
 */
export default defineAction({
  description:
    "Read one cockpit resource by its manifest name (see cockpit-manifest), e.g. status, score, jobs, halo, hygiene, board/cards or board/card/FA-123. Answers { resource, at, ok, data }; data over 60000 characters is cut per field and marked truncated.",
  schema: z.object({
    resource: z.string().regex(/^[a-z][a-z0-9]*(\/[A-Za-z0-9._-]+){0,2}$/).describe("The resource name from cockpit-manifest"),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async ({ resource }) => {
    const r = await get(resource);
    const text = JSON.stringify(r.data);
    if (text.length <= READ_MAX_CHARS) return { resource, at: r.at, ok: r.ok, error: r.error, data: r.data };
    const d = r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>) : {};
    const per = Math.max(500, Math.floor(READ_MAX_CHARS / Math.max(1, Object.keys(d).length)));
    const cut = Object.fromEntries(Object.entries(d).map(([k, v]) => {
      const s = JSON.stringify(v) ?? "null";
      return [k, s.length > per ? s.slice(0, per) + "…" : v];
    }));
    return { resource, at: r.at, ok: r.ok, error: r.error, truncated: { chars: text.length, perField: per }, data: cut };
  },
});
