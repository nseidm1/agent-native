import { defineEventHandler, getRequestIP, HTTPError } from "h3";

import { isLoopbackAddress } from "../cockpit/agent.js";

/**
 * ask-agent spawns a local CLI, so it answers loopback callers only. The
 * socket address is read directly (X-Forwarded-For is ignored: a header is
 * not proof of where a request came from). The cockpit's front proxy runs on
 * this host and adds its own same-origin guard.
 */
export default defineEventHandler((event) => {
  const pathname = event.url.pathname;
  if (!/\/_agent-native\/actions\/ask-agent\/?$/.test(pathname)) return;
  const ip = getRequestIP(event);
  if (!isLoopbackAddress(ip)) {
    throw new HTTPError({ status: 403, message: "ask-agent answers loopback requests only" });
  }
});
