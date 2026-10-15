/**
 * THE WRITE SCOPE of the Ask agent's code changes (FA-19080; console 2026-10-15:
 * "The agent can modify the entire frontend cockpit, the user facing UI and
 * nothing part of the system abstracted by the client", and "the scope of
 * agent-native is the front facing cockpit, using the client to access system
 * data").
 *
 * This is the ENFORCEMENT POINT: after the code agent's run, every path its
 * worktree changed is checked here, and so is every line it added. One refusal
 * discards the whole change before any gate runs; the prompt saying the same
 * thing is only advice to the agent.
 *
 *   ALLOWED   templates/cockpit/app/**   (components, routes, styles; not entry.server.tsx)
 *             templates/cockpit/public/**
 *             templates/cockpit/shared/presentation/**
 *   NEVER     server/ (client.ts and every route or plugin), actions/, the rest of
 *             shared/ (layout validation, write-action names, the manifest snapshot,
 *             image limits), package files, configs, anything outside templates/cockpit
 *
 * And inside the allowed paths an added line may not make frontend code into
 * server code or a second path to the system: no node builtins, no import of
 * server/ or actions/, no route loader/action, no process.env, eval or
 * new Function, and no network call of its own (fetch, XHR, WebSocket,
 * EventSource, sendBeacon, an absolute http URL, or a cockpit route or port). The
 * app reads system data only through its own actions, which read only through
 * server/cockpit/client.ts.
 *
 * Pure: the caller hands in the changed paths and their added lines.
 */
import path from "node:path";

export const APP_REL = "templates/cockpit";

/** Path prefixes (relative to the fork root) the agent may change. */
export const ALLOWED_PREFIXES = [`${APP_REL}/app/`, `${APP_REL}/public/`, `${APP_REL}/shared/presentation/`] as const;
/** Inside an allowed prefix, still never these. */
export const DENIED_FILES = [`${APP_REL}/app/entry.server.tsx`] as const;

export interface ChangedFile {
  /** Relative to the fork root, forward slashes. */
  path: string;
  /** git porcelain status letters, e.g. "M", "A", "D", "??", "R" */
  status: string;
  /** The lines this change added (the whole file for a new one). */
  added: string[];
}

export interface ScopeVerdict {
  ok: boolean;
  refusals: string[];
}

export function pathAllowed(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || n.split("/").includes("..")) return false;
  if ((DENIED_FILES as readonly string[]).includes(n)) return false;
  return ALLOWED_PREFIXES.some((pre) => n.startsWith(pre) && n.length > pre.length);
}

/** The cockpit's own port, the one only the client may name. */
const COCKPIT_PORT = ["52", "17"].join("");
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const NODE_BUILTINS =
  "node:[^\"']+|fs|fs/promises|child_process|http|https|http2|net|tls|dgram|dns|os|path|worker_threads|cluster|vm|module|process|v8|inspector";
const RULES: { re: RegExp; why: string; code?: boolean }[] = [
  { re: new RegExp(`(from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)["'](${NODE_BUILTINS})["']`), why: "imports a Node builtin (frontend code runs in the browser)", code: true },
  { re: /(from\s+|import\s*\(\s*|require\s*\(\s*)["'](@agent-native\/core\/(server|code-agents|cli|db|agent\/harness)(\/[^"']*)?|h3|nitro[^"']*)["']/, why: "imports a server-side module", code: true },
  { re: /export\s+(async\s+)?(function|const|let|var)\s+(loader|action|headers)\b|export\s*\{[^}]*\b(loader|action)\b/, why: "adds a route loader or action (server code)", code: true },
  { re: /\bprocess\.env\b|\bchild_process\b/, why: "reads the server environment or spawns a process", code: true },
  { re: /\beval\s*\(|\bnew\s+Function\s*\(/, why: "evaluates code at runtime", code: true },
  { re: /\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|\bnew\s+EventSource\b|\bsendBeacon\s*\(/, why: "makes its own network call (read through the app's actions)", code: true },
  { re: /https?:\/\/(?!www\.w3\.org\/)/, why: "names an absolute URL" },
  // built from parts, so this file does not itself name a cockpit route (client-only.spec.ts holds unchanged)
  { re: new RegExp("\\/" + "api" + "\\/|\\b" + COCKPIT_PORT + "\\b"), why: "names a cockpit route (only server/cockpit/client.ts may)" },
];

/** Where a relative import from `file` lands, relative to the fork root; null for a bare specifier. */
export function resolveImport(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
}

const IMPORT_SPEC = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g;

/** Every refusal for these changes; ok only when there are none. */
export function checkScope(changes: ChangedFile[]): ScopeVerdict {
  const refusals: string[] = [];
  for (const c of changes) {
    const p = c.path.replace(/\\/g, "/");
    if (!pathAllowed(p)) {
      refusals.push(`${p}: outside the frontend write scope (${ALLOWED_PREFIXES.join(", ")})`);
      continue;
    }
    const isCode = CODE.test(p);
    c.added.forEach((line, i) => {
      for (const r of RULES) {
        if (r.code && !isCode) continue;
        if (r.re.test(line)) refusals.push(`${p} (+${i + 1}): ${r.why}: ${line.trim().slice(0, 120)}`);
      }
      if (!isCode) return;
      for (const m of line.matchAll(IMPORT_SPEC)) {
        const to = resolveImport(p, m[1]);
        if (to == null) continue;
        const inApp = to.startsWith(APP_REL + "/");
        const toServer = to.startsWith(`${APP_REL}/server/`) || to === `${APP_REL}/server` || to.startsWith(`${APP_REL}/actions/`) || to === `${APP_REL}/actions`;
        if (!inApp || toServer) refusals.push(`${p} (+${i + 1}): imports ${m[1]}, outside the frontend (${to})`);
      }
    });
  }
  return { ok: refusals.length === 0, refusals };
}

/** The changed files from `git status --porcelain=v1 -z -uall` output. Renames give both paths. */
export function parsePorcelainZ(out: string): { path: string; status: string }[] {
  const parts = out.split("\0").filter(Boolean);
  const files: { path: string; status: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    const st = e.slice(0, 2).trim() || e.slice(0, 2);
    const p = e.slice(3);
    files.push({ path: p, status: st });
    // a rename or copy is followed by its original path, which changed too
    if (/^[RC]/.test(e.slice(0, 2))) files.push({ path: parts[++i], status: "D" });
  }
  return files;
}

/** Added lines per file from `git diff -U0 --no-color` output. */
export function addedLinesFromDiff(diff: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  let cur: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const t = line.slice(4);
      cur = t === "/dev/null" ? null : t.replace(/^b\//, "");
      if (cur && !m.has(cur)) m.set(cur, []);
    } else if (cur && line.startsWith("+") && !line.startsWith("+++")) m.get(cur)!.push(line.slice(1));
  }
  return m;
}
