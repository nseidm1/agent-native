import { fail } from "@agent-native/core/action";

import { CockpitWriteError, cockpitPost } from "./cockpit-api.js";

/**
 * Forward one dialog write to the cockpit. The cockpit's refusal (403 read-only,
 * 409 not allowed now, 400 bad input) comes back as this action's own error,
 * in the cockpit's words. server/middleware/ask-agent-loopback.ts refuses any
 * non-loopback caller before this runs.
 */
export async function forwardWrite(path: string, body: unknown): Promise<{ ok: true; answer: unknown }> {
  try {
    const answer = await cockpitPost(path, body);
    return { ok: true, answer };
  } catch (e) {
    if (e instanceof CockpitWriteError) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      fail(e.message, { errorCode: "cockpit_write_failed", statusCode: status });
    }
    throw e;
  }
}
