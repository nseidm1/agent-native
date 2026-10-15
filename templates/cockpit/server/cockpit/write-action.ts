import { fail } from "@agent-native/core/action";

import { act, ClientError } from "./client.js";

/**
 * Run one cockpit action through the client, by its manifest name. The
 * cockpit's refusal (403 read-only, 409 not allowed now, 400 bad input) comes
 * back as this action's own error, in the cockpit's words.
 * server/middleware/ask-agent-loopback.ts refuses any non-loopback caller
 * before this runs.
 */
export async function forwardAct(name: string, input: Record<string, unknown>): Promise<{ ok: true; answer: unknown }> {
  try {
    const answer = await act(name, input);
    return { ok: true, answer };
  } catch (e) {
    if (e instanceof ClientError) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      fail(e.message, { errorCode: "cockpit_write_failed", statusCode: status });
    }
    throw e;
  }
}
