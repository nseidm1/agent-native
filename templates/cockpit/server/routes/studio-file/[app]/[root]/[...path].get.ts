import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from "h3";

import { APP_ID, ClientError, STUDIO_ROOTS, type StudioRoot, studioFile } from "../../../../cockpit/client.js";

/**
 * FA-19087 (FA-19172..FA-19175): a studio picture for the native studio (/cards/studio-file/<app>/<root>/<path>): a chat
 * image, a studio file (a New Design mockup or image), a QA screenshot - the bytes the cockpit client carries (MI-379), with
 * the cockpit's content type and, for a studio HTML file, its sandboxing CSP. A read for every viewer, as in the legacy studio.
 */
export default defineEventHandler(async (event) => {
  const app = String(getRouterParam(event, "app") || "");
  const root = String(getRouterParam(event, "root") || "") as StudioRoot;
  let rest = "";
  try {
    rest = decodeURIComponent(String(getRouterParam(event, "path") || ""));
  } catch {
    rest = "";
  }
  if (!APP_ID.test(app) || !STUDIO_ROOTS.includes(root) || !rest) {
    setResponseStatus(event, 400);
    return { error: "a studio file is studio-file/<app>/<root>/<path>" };
  }
  try {
    const f = await studioFile(app, root, rest);
    if (!f) {
      setResponseStatus(event, 404);
      return { error: "no studio file " + app + "/" + root + "/" + rest.slice(0, 120) };
    }
    setResponseHeader(event, "content-type", f.type);
    setResponseHeader(event, "x-content-type-options", "nosniff");
    if (f.csp) setResponseHeader(event, "content-security-policy", f.csp);
    setResponseHeader(event, "cache-control", "private, max-age=3600");
    return f.buf;
  } catch (e) {
    setResponseStatus(event, e instanceof ClientError ? e.status : 502);
    return { error: e instanceof Error ? e.message : String(e) };
  }
});
