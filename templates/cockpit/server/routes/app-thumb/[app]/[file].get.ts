import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from "h3";

import { APP_ID, ClientError, getAppThumb, THUMB_SHA } from "../../../cockpit/client.js";

/**
 * FA-19157: an app's staging picture for the Apps tiles and the studio (/cards/app-thumb/<app>/<sha12>.jpg), read through
 * the cockpit client. A new staging sha is a new name, so the picture is cacheable forever. A read for every viewer,
 * like the tiles themselves.
 */
export default defineEventHandler(async (event) => {
  const app = String(getRouterParam(event, "app") || "");
  const m = /^([0-9a-f]{12})\.jpg$/.exec(String(getRouterParam(event, "file") || ""));
  if (!APP_ID.test(app) || !m || !THUMB_SHA.test(m[1])) {
    setResponseStatus(event, 400);
    return { error: "a picture is app-thumb/<app>/<sha12>.jpg" };
  }
  try {
    const buf = await getAppThumb(app, m[1]);
    if (!buf) {
      setResponseStatus(event, 404);
      return { error: "no staging picture " + app + "/" + m[1] };
    }
    setResponseHeader(event, "content-type", "image/jpeg");
    setResponseHeader(event, "cache-control", "public, max-age=31536000, immutable");
    return buf;
  } catch (e) {
    setResponseStatus(event, e instanceof ClientError ? e.status : 502);
    return { error: e instanceof Error ? e.message : String(e) };
  }
});
