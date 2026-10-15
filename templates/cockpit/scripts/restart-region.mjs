#!/usr/bin/env node
/**
 * Restarts the served card region on its current build (FA-19080): started
 * detached by the region itself after an Ask agent change or its Undo went
 * live. The old server ignores SIGTERM, so it is killed with SIGKILL; the new
 * one gets this process's environment, which is the old server's own (the
 * keepalive's cardsStartOf env), the same cwd and .output/server/index.mjs.
 * The outcome is written as JSON to --out, which the job record folds in.
 *
 *   node scripts/restart-region.mjs --pid <old> --out <file.restart.json> --app <templates/cockpit>
 */
import { spawn } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const oldPid = Number(arg("--pid"));
const outFile = arg("--out");
const app = path.resolve(arg("--app") || process.cwd());
const port = Number(process.env.PORT) || 5241;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (o) => {
  if (outFile) writeFileSync(outFile, JSON.stringify({ ...o, at: new Date().toISOString() }));
};
const answers = () =>
  new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/cards/", timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => req.destroy());
  });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// let the old server answer the request that started this
await sleep(1500);
if (oldPid > 1 && alive(oldPid)) {
  process.kill(oldPid, "SIGKILL");
  for (let i = 0; i < 40 && alive(oldPid); i++) await sleep(100);
}
for (let i = 0; i < 30 && (await answers()); i++) await sleep(200); // the port frees
const log = openSync(path.join(app, "data", "cockpit-agent", "region.out"), "a");
const child = spawn(process.execPath, [path.join(app, ".output", "server", "index.mjs")], { cwd: app, env: process.env, detached: true, stdio: ["ignore", log, log] });
child.unref();
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (await answers()) {
    record({ ok: true, pid: child.pid, detail: `pid ${child.pid} on :${port}` });
    process.exit(0);
  }
  if (child.exitCode != null) break;
}
record({ ok: false, pid: child.pid, detail: `the new region server did not answer on :${port}` + (child.exitCode != null ? ` (exited ${child.exitCode})` : "") });
process.exit(1);
