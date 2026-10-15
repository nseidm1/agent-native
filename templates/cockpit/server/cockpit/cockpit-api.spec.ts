import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loopbackOnlyRefusal } from "../middleware/ask-agent-loopback";
import { CockpitWriteError, cockpitPost } from "./cockpit-api";

/** A stub of the cockpit's write gate: what cockpit.mjs writeAllowed checks, and what it was sent. */
let seen: { path?: string; host?: string; origin?: string; type?: string; body?: string }[] = [];
let base = "";
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ path: req.url, host: req.headers.host, origin: req.headers.origin, type: req.headers["content-type"], body });
    let originHost = "";
    try {
      originHost = new URL(String(req.headers.origin)).host;
    } catch {
      originHost = "";
    }
    const allowed = originHost === req.headers.host && /application\/json/.test(String(req.headers["content-type"]));
    if (!allowed) {
      res.writeHead(403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "This device can only view the cockpit." }));
    }
    if (req.url === "/api/board/card-action") {
      res.writeHead(409, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "FA-9 is not in progress, so it cannot be paused" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, echo: JSON.parse(body || "{}") }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + (stub.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => stub.close(() => r())));

describe("cockpit writes", () => {
  it("send a same-origin JSON POST the cockpit's write gate accepts", async () => {
    seen = [];
    const r = await cockpitPost("/api/halo/models/qwen2.5-3b", { enabled: false }, base);
    expect(r).toEqual({ ok: true, echo: { enabled: false } });
    expect(seen[0].path).toBe("/api/halo/models/qwen2.5-3b");
    expect(seen[0].origin).toBe(base);
    expect(new URL(seen[0].origin as string).host).toBe(seen[0].host);
    expect(seen[0].type).toBe("application/json");
  });

  it("return the cockpit's own refusal words and status", async () => {
    const e = await cockpitPost("/api/board/card-action", { fa: "FA-9", action: "pause" }, base).catch((x) => x);
    expect(e).toBeInstanceOf(CockpitWriteError);
    expect(e.status).toBe(409);
    expect(e.message).toBe("FA-9 is not in progress, so it cannot be paused");
  });

  it("refuse a path outside /api/ or one that climbs", async () => {
    for (const p of ["/etc/passwd", "/api/../x", "http://evil/api/x", "/api/a b"]) {
      await expect(cockpitPost(p, {}, base)).rejects.toThrow(/bad cockpit path/);
    }
  });

  it("answer loopback callers only, and honour the front's peer header only to narrow", () => {
    const p = "/cards/_agent-native/actions/cockpit-board-card-action";
    expect(loopbackOnlyRefusal(p, "127.0.0.1", undefined)).toBeNull();
    expect(loopbackOnlyRefusal(p, "127.0.0.1", "::1")).toBeNull();
    expect(loopbackOnlyRefusal(p, "100.64.1.2", undefined)).toMatch(/loopback requests only/);
    expect(loopbackOnlyRefusal(p, "127.0.0.1", "100.64.1.2")).toMatch(/read-only on this device/);
    expect(loopbackOnlyRefusal("/_agent-native/actions/ask-agent", "10.0.0.1", undefined)).toMatch(/loopback/);
    // reads stay open
    expect(loopbackOnlyRefusal("/_agent-native/actions/get-card-detail", "100.64.1.2", "100.64.1.2")).toBeNull();
  });
});
