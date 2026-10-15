/**
 * The cockpit's own HTTP API (tools/lane/maint/ui/cockpit.mjs, 127.0.0.1:5217
 * by default): GET reads for the dialogs (halo models, the production data
 * panel) and the POST writes the dialogs offer. A write is sent exactly as the
 * cockpit's write gate (writeAllowed) expects: a JSON POST from loopback whose
 * Origin host equals its Host. Only paths built here are ever sent.
 */
import http from "node:http";

import { COCKPIT_STATE_URL } from "./cards.js";

export const COCKPIT_API = (() => {
  try {
    return new URL(process.env.COCKPIT_API_URL || COCKPIT_STATE_URL).origin;
  } catch {
    return "http://127.0.0.1:5217";
  }
})();
export const WRITE_TIMEOUT_MS = 150_000;

export class CockpitWriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CockpitWriteError";
  }
}

/** A GET from the cockpit API, or null when it does not answer in time. */
export async function cockpitGet(path: string, timeoutMs = 5000): Promise<any | null> {
  try {
    const r = await fetch(COCKPIT_API + path, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** POST a JSON body to the cockpit; the parsed answer on 2xx, a CockpitWriteError with the cockpit's own words otherwise. */
export function cockpitPost(path: string, body: unknown, base = COCKPIT_API): Promise<any> {
  if (!/^\/api\/[A-Za-z0-9._\/-]+$/.test(path) || path.includes("..")) return Promise.reject(new CockpitWriteError("bad cockpit path", 400));
  const u = new URL(base);
  const payload = Buffer.from(JSON.stringify(body ?? {}));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: u.hostname,
        port: u.port || 80,
        path,
        method: "POST",
        headers: {
          host: u.host,
          origin: u.origin,
          "content-type": "application/json",
          "content-length": payload.length,
          "user-agent": "cockpit-region (agent-native)",
        },
        timeout: WRITE_TIMEOUT_MS,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (raw.length < 200_000) raw += c;
        });
        res.on("end", () => {
          let j: any = null;
          try {
            j = raw ? JSON.parse(raw) : {};
          } catch {
            j = null;
          }
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) return resolve(j ?? { ok: true, text: raw.slice(0, 300) });
          const why = (j && (j.error || j.why || j.message)) || raw.slice(0, 300) || "HTTP " + status;
          reject(new CockpitWriteError(String(why).slice(0, 300), status));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("the cockpit did not answer within " + WRITE_TIMEOUT_MS / 1000 + " s")));
    req.on("error", (e) => reject(e instanceof CockpitWriteError ? e : new CockpitWriteError("cockpit unreachable: " + e.message, 502)));
    req.end(payload);
  });
}
