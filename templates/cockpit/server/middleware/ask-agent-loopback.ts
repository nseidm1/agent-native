import { defineEventHandler, getRequestHeader, getRequestIP, HTTPError } from "h3";

import { WRITE_ACTION_NAMES } from "../../shared/cockpit-detail.js";
import { isLoopbackAddress } from "../cockpit/agent.js";

/**
 * The actions that act on this Mac: ask-agent spawns the local CLI (and applies frontend changes), undo-ask-change
 * reverts one and restarts the region, the cockpit-* writes change the cockpit.
 */
export const LOOPBACK_ONLY_ACTIONS = ["ask-agent", "undo-ask-change", "cockpit-act", ...WRITE_ACTION_NAMES];
const ROUTE = new RegExp(`/_agent-native/actions/(${LOOPBACK_ONLY_ACTIONS.join("|")})/?$`);

/**
 * These actions answer loopback callers only. The socket address is read
 * directly (X-Forwarded-For is ignored: a header is not proof of where a
 * request came from). The cockpit's front proxy runs on this host and passes
 * its caller's real address as x-cockpit-peer; a non-loopback peer there is
 * refused too (that header can only narrow access, never widen it).
 */
export function loopbackOnlyRefusal(pathname: string, socketIp: string | undefined | null, peerHeader: string | undefined | null): string | null {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  if (!isLoopbackAddress(socketIp)) return `${m[1]} answers loopback requests only`;
  if (peerHeader && !isLoopbackAddress(peerHeader)) return `${m[1]} is read-only on this device`;
  return null;
}

export default defineEventHandler((event) => {
  const why = loopbackOnlyRefusal(event.url.pathname, getRequestIP(event), getRequestHeader(event, "x-cockpit-peer"));
  if (why) throw new HTTPError({ status: 403, message: why });
});
