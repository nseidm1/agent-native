/**
 * THE cockpit client (FA-19027). The ONLY file in this app that knows where the
 * cockpit is or what its routes are called: everything else reads and writes
 * through get(), act() and events() below, by the resource and action NAMES the
 * cockpit's manifest publishes (tools/lane/maint/ui/client-api.mjs,
 * GET <base>/manifest). The cockpit's internal state shape never reaches this app.
 *
 *   manifest()            the cockpit's resources and actions, with JSON Schemas (cached; re-read on an unknown name)
 *   get(name)             one resource's data; etag-cached, a 304 reuses the cache; while the change stream is
 *                         connected a resource it has not named as changed is answered from the cache with no request
 *   act(name, input)      one action; the input is checked against the manifest schema before it is sent
 *   events(listener)      the change stream (one SSE connection shared by every listener; reconnects on its own)
 *
 * A write goes out exactly as the cockpit's write gate expects (a JSON POST from loopback whose Origin host equals
 * its Host). The region itself stays read-only from remote: server/middleware/ask-agent-loopback.ts refuses a
 * non-loopback caller before any write action runs, and the cockpit's front (front.mjs cardsAllowed) does too.
 */
import http from "node:http";

/** The client's base URL (COCKPIT_CLIENT_URL overrides it; read on each call so a test can point it elsewhere). */
export const clientBase = () => (process.env.COCKPIT_CLIENT_URL || "http://127.0.0.1:5217/api/client/v1").replace(/\/+$/, "");
const origin = () => new URL(clientBase()).origin;
const prefix = () => new URL(clientBase()).pathname;

export const READ_TIMEOUT_MS = 8000;
export const WRITE_TIMEOUT_MS = 150_000;
const MANIFEST_TTL_MS = 60_000;
/** Without a live change stream, a resource is re-validated (a cheap 304) at most this often. */
const REVALIDATE_MS = 2000;
/** Even with a live stream, nothing is served from cache longer than this. */
const HARD_MAX_AGE_MS = 30_000;

export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  maxLength?: number;
  maxItems?: number;
  maximum?: number;
  items?: JsonSchema;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  description?: string;
};
export interface ManifestResource {
  name: string;
  path: string;
  description: string;
  schema: JsonSchema;
  freshness?: { maxAgeMs?: number; source?: string };
}
export interface ManifestAction {
  name: string;
  description: string;
  schema: JsonSchema;
  write: boolean;
  path: string;
}
export interface Manifest {
  version: string;
  prefix: string;
  resources: ManifestResource[];
  actions: ManifestAction[];
}
export interface Read<T = any> {
  name: string;
  data: T;
  etag: string;
  /** the snapshot time the cockpit stamped (ms), or when this app read it */
  at: number;
  /** false when the cockpit did not answer and this is the last good copy */
  ok: boolean;
  error?: string;
}

export class ClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

// ---------- the one HTTP primitive ----------
interface Raw {
  status: number;
  etag: string;
  body: string;
}
function request(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}, timeoutMs = READ_TIMEOUT_MS): Promise<Raw> {
  if (!path.startsWith(prefix() + "/") || path.includes("..")) return Promise.reject(new ClientError("bad client path", 400));
  const u = new URL(origin());
  const payload = method === "POST" ? Buffer.from(JSON.stringify(body ?? {})) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: u.hostname,
        port: u.port || 80,
        path,
        method,
        timeout: timeoutMs,
        headers: {
          host: u.host,
          origin: u.origin,
          accept: "application/json",
          "user-agent": "cockpit-region (agent-native)",
          ...(payload ? { "content-type": "application/json", "content-length": String(payload.length) } : {}),
          ...extra,
        },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (raw.length < 4_000_000) raw += c;
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, etag: String(res.headers.etag || "").replace(/^W\//, "").replace(/"/g, ""), body: raw }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("the cockpit did not answer within " + Math.round(timeoutMs / 1000) + " s")));
    req.on("error", (e) => reject(e instanceof ClientError ? e : new ClientError("cockpit unreachable: " + e.message, 502)));
    req.end(payload ?? undefined);
  });
}
const parse = (s: string): any => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const why = (r: Raw) => {
  const j = parse(r.body);
  return String((j && (j.error || j.why || j.message)) || r.body.slice(0, 300) || "HTTP " + r.status).slice(0, 300);
};

// ---------- the manifest ----------
let manifestCache: { at: number; m: Manifest } | null = null;
let manifestInflight: Promise<Manifest> | null = null;
export async function manifest(force = false): Promise<Manifest> {
  if (!force && manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.m;
  if (manifestInflight) return manifestInflight;
  manifestInflight = (async () => {
    try {
      const r = await request("GET", prefix() + "/manifest");
      if (r.status !== 200) throw new ClientError("manifest: " + why(r), r.status);
      const m = parse(r.body) as Manifest;
      if (!m || !Array.isArray(m.resources) || !Array.isArray(m.actions)) throw new ClientError("manifest: not a manifest", 502);
      manifestCache = { at: Date.now(), m };
      return m;
    } catch (e) {
      if (manifestCache) return manifestCache.m; // keep the last good one while the cockpit is away
      throw e;
    } finally {
      manifestInflight = null;
    }
  })();
  return manifestInflight;
}
/** The path a resource name resolves to: board/card/FA-1 matches the template board/card/{fa}. */
function resourcePath(m: Manifest, name: string): string | null {
  for (const r of m.resources) {
    if (r.name === name) return r.path;
    if (r.name.includes("{")) {
      const re = new RegExp("^" + r.name.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-z]+\}/gi, "([A-Za-z0-9._-]{1,80})") + "$");
      const mm = re.exec(name);
      if (mm) {
        let i = 1;
        return r.path.replace(/\{[a-z]+\}/gi, () => encodeURIComponent(mm[i++]));
      }
    }
  }
  return null;
}

// ---------- reads ----------
interface Entry {
  read: Read;
  checkedAt: number;
  stale: boolean;
}
const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Read>>();

/** One resource by its manifest name. Never throws for an unreachable cockpit once a good copy exists. */
export async function get<T = any>(name: string, o: { fresh?: boolean } = {}): Promise<Read<T>> {
  const e = entries.get(name);
  const live = stream.connected;
  const age = e ? Date.now() - e.checkedAt : Infinity;
  if (e && !o.fresh && !e.stale && age < HARD_MAX_AGE_MS && (live || age < REVALIDATE_MS)) return e.read as Read<T>;
  const running = inflight.get(name);
  if (running) return running as Promise<Read<T>>;
  const p = (async (): Promise<Read<T>> => {
    try {
      let m = await manifest();
      let path = resourcePath(m, name);
      if (!path) {
        m = await manifest(true);
        path = resourcePath(m, name);
      }
      if (!path) throw new ClientError("the cockpit has no resource " + name, 404);
      const r = await request("GET", path, undefined, e ? { "if-none-match": '"' + e.read.etag + '"' } : {});
      if (r.status === 304 && e) {
        entries.set(name, { read: { ...e.read, ok: true, error: undefined }, checkedAt: Date.now(), stale: false });
        return entries.get(name)!.read as Read<T>;
      }
      if (r.status !== 200) throw new ClientError(name + ": " + why(r), r.status);
      const j = parse(r.body);
      if (!j || !("data" in j)) throw new ClientError(name + ": the cockpit answered no data", 502);
      const read: Read<T> = { name, data: j.data, etag: String(j.etag || r.etag || ""), at: typeof j.at === "number" ? j.at : Date.now(), ok: true };
      entries.set(name, { read, checkedAt: Date.now(), stale: false });
      return read;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (e) return { ...(e.read as Read<T>), ok: false, error: msg };
      throw err instanceof ClientError ? err : new ClientError(msg, 502);
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}

/** Several resources at once; a resource that fails comes back as null in its slot (with ok false on the batch). */
export async function getMany(names: string[]): Promise<{ ok: boolean; at: number; errors: string[]; data: Record<string, any> }> {
  const reads = await Promise.allSettled(names.map((n) => get(n)));
  const data: Record<string, any> = {};
  const errors: string[] = [];
  let at = 0;
  reads.forEach((r, i) => {
    if (r.status === "fulfilled") {
      data[names[i]] = r.value.data;
      at = Math.max(at, r.value.at || 0);
      if (!r.value.ok && r.value.error) errors.push(r.value.error);
    } else {
      data[names[i]] = null;
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  });
  return { ok: errors.length === 0, at: at || Date.now(), errors, data };
}

// ---------- writes ----------
/** A small JSON Schema check (the subset the manifest uses); [] when the value fits. */
export function checkSchema(s: JsonSchema, v: unknown, p = "$"): string[] {
  const isT = (t: string, x: unknown) =>
    t === "null" ? x === null : t === "array" ? Array.isArray(x) : t === "object" ? !!x && typeof x === "object" && !Array.isArray(x)
      : t === "integer" ? Number.isInteger(x) : t === "number" ? typeof x === "number" && Number.isFinite(x) : typeof x === t;
  const ts = ([] as string[]).concat(s.type || []);
  if (ts.length && !ts.some((t) => isT(t, v))) return [p + " is " + (v === null ? "null" : Array.isArray(v) ? "array" : typeof v) + ", want " + ts.join("|")];
  const e: string[] = [];
  if (s.enum && !s.enum.includes(v)) e.push(p + " is not one of " + s.enum.join(", "));
  if (typeof v === "string" && s.maxLength != null && v.length > s.maxLength) e.push(p + " is longer than " + s.maxLength);
  if (typeof v === "number" && s.maximum != null && v > s.maximum) e.push(p + " is over " + s.maximum);
  if (Array.isArray(v)) {
    if (s.maxItems != null && v.length > s.maxItems) e.push(p + " has over " + s.maxItems + " items");
    if (s.items) v.forEach((x, i) => e.push(...checkSchema(s.items!, x, p + "[" + i + "]")));
  }
  if (isT("object", v)) {
    const o = v as Record<string, unknown>;
    for (const k of s.required || []) if (!(k in o)) e.push(p + " is missing " + k);
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in o && o[k] !== undefined) e.push(...checkSchema(sub, o[k], p + "." + k));
    if (s.additionalProperties === false) for (const k of Object.keys(o)) if (!(k in (s.properties || {}))) e.push(p + " has unknown " + k);
  }
  return e;
}

/** Run one cockpit action by name. The input is checked against the manifest first; the cockpit's own refusal comes back in its words. */
export async function act<T = any>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  let m = await manifest();
  let a = m.actions.find((x) => x.name === name);
  if (!a) {
    m = await manifest(true);
    a = m.actions.find((x) => x.name === name);
  }
  if (!a) throw new ClientError("the cockpit has no action " + name, 404);
  const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const bad = checkSchema(a.schema, clean);
  if (bad.length) throw new ClientError(name + ": " + bad.slice(0, 3).join("; "), 400);
  const r = await request("POST", prefix() + "/actions/" + encodeURIComponent(name), clean, {}, a.write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  const j = parse(r.body);
  if (r.status < 200 || r.status > 299 || !j || j.ok === false) throw new ClientError((j && (j.error || j.why)) ? String(j.error || j.why).slice(0, 300) : why(r), r.status >= 400 ? r.status : 502);
  // a write moves state: the next read of every resource re-validates rather than trusting the stream to have caught up
  if (a.write) for (const x of entries.values()) x.stale = true;
  return (j.result ?? j) as T;
}

// ---------- the change stream ----------
export interface ChangeEvent {
  kind: "hello" | "changed" | "down";
  resources: string[];
  at: number | null;
}
type Listener = (e: ChangeEvent) => void;
const stream = { connected: false, started: false, listeners: new Set<Listener>(), req: null as http.ClientRequest | null, backoff: 1000, lastAt: 0 };

function emit(e: ChangeEvent) {
  for (const l of stream.listeners) {
    try {
      l(e);
    } catch {
      /* a listener's fault is its own */
    }
  }
}
function onFrame(ev: string, data: string) {
  const j = parse(data) || {};
  if (ev === "hello") {
    const etags: Record<string, string> = j.etags || {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(etags)) {
      const e = entries.get(k);
      if (e && e.read.etag !== v) {
        e.stale = true;
        changed.push(k);
      }
    }
    // a param resource (board/card/FA-n) is not in the etag map: re-validate it on its next read
    for (const [k, e] of entries) if (!(k in etags)) e.stale = true;
    stream.connected = true;
    stream.backoff = 1000;
    emit({ kind: "hello", resources: changed, at: j.at ?? null });
  } else if (ev === "changed") {
    const names: string[] = Array.isArray(j.resources) ? j.resources : [];
    for (const n of names) {
      const e = entries.get(n);
      if (e) e.stale = true;
      // a card's detail rides on the board: when the board moves, re-validate the open card reads too
      if (n === "board/cards") for (const [k, x] of entries) if (k.startsWith("board/card/")) x.stale = true;
    }
    emit({ kind: "changed", resources: names, at: j.at ?? null });
  }
}
function connect() {
  const u = new URL(origin());
  const req = http.request({ host: u.hostname, port: u.port || 80, path: prefix() + "/events", method: "GET", headers: { host: u.host, accept: "text/event-stream", "user-agent": "cockpit-region (agent-native)" } }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return down();
    }
    res.setEncoding("utf8");
    let buf = "";
    res.on("data", (c: string) => {
      stream.lastAt = Date.now();
      buf += c;
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let ev = "message";
        const data: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) onFrame(ev, data.join("\n"));
      }
      if (buf.length > 1_000_000) buf = "";
    });
    res.on("end", down);
    res.on("error", down);
  });
  req.on("error", down);
  req.end();
  stream.req = req;
}
let downTimer: NodeJS.Timeout | null = null;
function down() {
  if (stream.connected) emit({ kind: "down", resources: [], at: null });
  stream.connected = false;
  stream.req = null;
  if (downTimer || !stream.listeners.size) {
    if (!stream.listeners.size) stream.started = false;
    return;
  }
  downTimer = setTimeout(() => {
    downTimer = null;
    if (stream.listeners.size) connect();
    else stream.started = false;
  }, stream.backoff);
  downTimer.unref?.();
  stream.backoff = Math.min(stream.backoff * 2, 30_000);
}
/** Subscribe to the cockpit's change stream; returns the unsubscribe. One connection is shared by every listener. */
export function events(listener: Listener): () => void {
  stream.listeners.add(listener);
  if (!stream.started) {
    stream.started = true;
    connect();
  }
  return () => {
    stream.listeners.delete(listener);
    if (!stream.listeners.size && stream.req) {
      stream.req.destroy();
      stream.req = null;
      stream.connected = false;
      stream.started = false;
    }
  };
}
/** Whether the change stream is up (the card region shows it as its live dot). */
export const streamConnected = () => stream.connected;

/** For tests: forget every cached read and the manifest. */
export function __resetClientForTests() {
  entries.clear();
  inflight.clear();
  manifestCache = null;
}

// ---------- the staging pictures (FA-19157) ----------
export const APP_ID = /^[a-z][a-z0-9-]{0,40}$/;
export const THUMB_SHA = /^[0-9a-f]{12}$/;
/** An app's staging picture at a staging sha: the JPEG bytes, or null when the cockpit has none. By strict name only. */
export function getAppThumb(app: string, sha12: string): Promise<Buffer | null> {
  if (!APP_ID.test(app) || !THUMB_SHA.test(sha12)) return Promise.reject(new ClientError("bad picture name", 400));
  const u = new URL(origin());
  const path = prefix() + "/images/app-thumb/" + app + "/" + sha12 + ".jpg";
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port || 80, path, method: "GET", timeout: READ_TIMEOUT_MS, headers: { host: u.host, accept: "image/jpeg", "user-agent": "cockpit-region (agent-native)" } }, (res) => {
      const chunks: Buffer[] = [];
      let n = 0;
      res.on("data", (c: Buffer) => {
        n += c.length;
        if (n <= 8_000_000) chunks.push(c);
      });
      res.on("end", () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200 || n > 8_000_000) return reject(new ClientError("the staging picture answered " + res.statusCode, res.statusCode || 502));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("timeout", () => req.destroy(new Error("the cockpit did not answer within " + Math.round(READ_TIMEOUT_MS / 1000) + " s")));
    req.on("error", (e) => reject(e instanceof ClientError ? e : new ClientError("cockpit unreachable: " + e.message, 502)));
    req.end();
  });
}
/** The sha12 a cockpit picture url names (appdialog thumb.url ends in <sha12>.jpg), or null. */
export const thumbShaOf = (url: unknown): string | null => {
  const m = /\/([0-9a-f]{12})\.jpg$/.exec(String(url || ""));
  return m ? m[1] : null;
};
