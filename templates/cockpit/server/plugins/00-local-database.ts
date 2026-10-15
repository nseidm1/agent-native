import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { configureAgentNativeEmbeddedEnvironment } from "@agent-native/core/server";

/**
 * The card region is a loopback-only app on the Mac that runs the cockpit, not
 * a hosted deployment, so a built server runs it the way an embedded install
 * does:
 *
 * - with no DATABASE_URL its small state (the card layout, app state) lives
 *   in local PGlite under ./data/pglite (a built server would otherwise refuse
 *   local PGlite as a misconfigured hosted deploy);
 * - with no BETTER_AUTH_SECRET it signs sessions with a per-machine key
 *   generated once into ./data/cockpit-agent/auth-secret (mode 0600; ./data
 *   is gitignored). The value is never logged or passed on a command line.
 *
 * Anything configured in the environment is left alone.
 */
export default function localRuntime() {
  if (!process.env.DATABASE_URL) {
    configureAgentNativeEmbeddedEnvironment({ databaseUrl: "pglite:./data/pglite" });
  }
  if (!process.env.BETTER_AUTH_SECRET) {
    const dir = path.resolve(process.env.COCKPIT_DATA_DIR || path.join("data", "cockpit-agent"));
    const file = path.join(dir, "auth-secret");
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    }
    process.env.BETTER_AUTH_SECRET = readFileSync(file, "utf8").trim(); // guard:allow-env-mutation — boot-time local configuration, not request-scoped state
  }
}
