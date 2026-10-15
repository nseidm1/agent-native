import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * FA-19135: the running build's id: the modification time of the server bundle this code was built into (a new
 * build writes a new bundle; the region restarts onto it), with the process start as the fallback. A page that
 * loaded under one id and later reads another was served by an older build: it shows the 'cockpit updated' bar.
 */
let id: string | null = null;
export function buildId(): string {
  if (id) return id;
  try {
    id = "b" + Math.round(statSync(fileURLToPath(import.meta.url)).mtimeMs).toString(36);
  } catch {
    id = "p" + Math.round(Date.now() - process.uptime() * 1000).toString(36);
  }
  return id;
}
