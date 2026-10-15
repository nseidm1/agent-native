/**
 * The cockpit client against a stand-in cockpit on a free loopback port:
 * resources are etag-cached (a 304 reuses the copy), an action's input is
 * checked against the manifest schema before anything is sent, a write goes
 * out with Origin equal to Host (the cockpit's write gate), and the change
 * stream marks exactly the named resources for a re-read.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __resetClientForTests, act, checkSchema, ClientError, events, get, streamConnected } from "./client";

const P = "/api/client/v1";
const MANIFEST = {
  version: "1",
  prefix: P,
  resources: [
    { name: "score", path: P + "/resources/score", description: "s", schema: { type: "object" } },
    { name: "board/card/{fa}", path: P + "/resources/board/card/{fa}", description: "c", schema: { type: "object" } },
  ],
  actions: [
    { name: "ping", path: P + "/actions/ping", description: "p", write: false, schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", maxLength: 200 } } } },
    { name: "board.cardAction", path: P + "/actions/board.cardAction", description: "b", write: true, schema: { type: "object", additionalProperties: false, required: ["fa", "action"], properties: { fa: { type: "string", maxLength: 12 }, action: { type: "string", enum: ["pause", "archive"] } } } },
  ],
};

let server: http.Server;
let score = { landed: 1 };
let etag = "e1";
const seen: { method: string; url: string; host?: string; origin?: string; inm?: string; body?: string }[] = [];
const streams = new Set<http.ServerResponse>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, host: req.headers.host, origin: req.headers.origin as string, inm: req.headers["if-none-match"] as string, body });
      const send = (code: number, obj: unknown, h: Record<string, string> = {}) => {
        res.writeHead(code, { "content-type": "application/json", ...h });
        res.end(JSON.stringify(obj));
      };
      if (req.url === P + "/manifest") return send(200, MANIFEST);
      if (req.url === P + "/resources/score") {
        if (req.headers["if-none-match"] === '"' + etag + '"') {
          res.writeHead(304, { etag: '"' + etag + '"' });
          return res.end();
        }
        return send(200, { resource: "score", etag, at: 5, data: score }, { etag: '"' + etag + '"' });
      }
      if (req.url === P + "/resources/board/card/FA-7") return send(200, { resource: "board/card/FA-7", etag: "c7", at: 6, data: { fa: "FA-7" } });
      if (req.url === P + "/actions/ping") return send(200, { ok: true, result: { echo: JSON.parse(body).text } });
      if (req.url === P + "/actions/board.cardAction") return send(409, { ok: false, error: "not allowed now" });
      if (req.url === P + "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("retry: 3000\n\n");
        res.write("event: hello\ndata: " + JSON.stringify({ etags: { score: etag }, at: 1 }) + "\n\n");
        streams.add(res);
        res.on("close", () => streams.delete(res));
        return;
      }
      send(404, { error: "no" });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.COCKPIT_CLIENT_URL = "http://127.0.0.1:" + (server.address() as AddressInfo).port + P;
  __resetClientForTests();
});
afterAll(async () => {
  for (const s of streams) s.end();
  delete process.env.COCKPIT_CLIENT_URL;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("the cockpit client", () => {
  it("reads a resource, then re-validates it with its etag and reuses the copy on a 304", async () => {
    const a = await get("score", { fresh: true });
    expect(a.data).toEqual({ landed: 1 });
    const b = await get("score", { fresh: true });
    expect(b.data).toBe(a.data);
    const last = seen.filter((s) => s.url === P + "/resources/score").pop()!;
    expect(last.inm).toBe('"e1"');
  });

  it("fills a resource template from the name (board/card/FA-7)", async () => {
    expect((await get("board/card/FA-7")).data).toEqual({ fa: "FA-7" });
  });

  it("refuses an unknown resource and an input that does not fit the action's schema, sending nothing", async () => {
    await expect(get("nope")).rejects.toBeInstanceOf(ClientError);
    const before = seen.length;
    await expect(act("board.cardAction", { fa: "FA-7", action: "delete" })).rejects.toThrow(/not one of/);
    await expect(act("ping", { text: "x", extra: 1 })).rejects.toThrow(/unknown extra/);
    expect(seen.slice(before).some((s) => s.url.includes("/actions/"))).toBe(false);
  });

  it("runs an action with Origin equal to Host and hands back the cockpit's own refusal", async () => {
    expect(await act("ping", { text: "hi" })).toEqual({ echo: "hi" });
    const p = seen.filter((s) => s.url === P + "/actions/ping").pop()!;
    expect(p.method).toBe("POST");
    expect(p.origin).toBe("http://" + p.host);
    const e = await act("board.cardAction", { fa: "FA-7", action: "pause" }).catch((x) => x);
    expect(e).toBeInstanceOf(ClientError);
    expect([e.status, e.message]).toEqual([409, "not allowed now"]);
  });

  it("the change stream says hello, then names what changed, and the next read refetches only that", async () => {
    const got: string[][] = [];
    const off = events((e) => got.push([e.kind, ...e.resources]));
    for (let i = 0; i < 50 && !streamConnected(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(streamConnected()).toBe(true);
    await get("score", { fresh: true });
    const n0 = seen.filter((s) => s.url === P + "/resources/score").length;
    await get("score"); // live stream, nothing changed: answered from the cache
    expect(seen.filter((s) => s.url === P + "/resources/score").length).toBe(n0);
    score = { landed: 2 };
    etag = "e2";
    for (const s of streams) s.write("event: changed\ndata: " + JSON.stringify({ resources: ["score"], etags: { score: "e2" }, at: 2 }) + "\n\n");
    for (let i = 0; i < 50 && !got.some((g) => g[0] === "changed"); i++) await new Promise((r) => setTimeout(r, 20));
    expect(got).toContainEqual(["changed", "score"]);
    expect((await get("score")).data).toEqual({ landed: 2 });
    off();
  });

  it("checkSchema covers the manifest's subset", () => {
    expect(checkSchema({ type: "object", required: ["a"], properties: { a: { type: "number", maximum: 3 } } }, { a: 4 })).toEqual(["$.a is over 3"]);
    expect(checkSchema({ type: ["string", "null"] }, null)).toEqual([]);
  });
});
