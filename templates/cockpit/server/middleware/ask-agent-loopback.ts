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
 * FA-19087 phone writes parity (MI-370): the cockpit-* forwarding writes a remote viewer may run when the cockpit's
 * front has asked the cockpit's own write gate about that caller and marked the request x-cockpit-write: verified
 * (front.mjs REMOTE_WRITE_ROUTE). The legacy page let exactly those callers write; the Ask agent's code-editing path
 * (ask-agent, undo-ask-change) and the generic cockpit-act are never on this list.
 */
export const REMOTE_VERIFIED_ACTIONS: readonly string[] = [...WRITE_ACTION_NAMES, "undo-ask-change"];
/**
 * FA-19087 THE ASK AGENT FROM THE PHONE (Portfolio MI-388; console 2026-10-15 ~08:15Z: the console talks to and USES the Ask agent from the
 * phone). ask-agent answers a remote viewer whatever the mark: the front sends it marked verified for a PAIRED phone (the cockpit's own write
 * gate admits the board token), and the action applies that viewer's change through the same gated path; unmarked, the action answers reads,
 * keeps the layout as it is and files a change as a board card (actions/ask-agent.ts askCaller). undo-ask-change from a remote viewer needs
 * the mark (REMOTE_VERIFIED_ACTIONS). cockpit-act stays loopback only.
 */
export const REMOTE_ASK_ACTIONS: readonly string[] = ["ask-agent"];
const VIEWER = /\/_agent-native\/actions\/get-viewer\/?$/;

/**
 * These actions answer loopback callers only. The socket address is read
 * directly (X-Forwarded-For is ignored: a header is not proof of where a
 * request came from). The cockpit's front proxy runs on this host and passes
 * its caller's real address as x-cockpit-peer; a non-loopback peer there is
 * refused, unless the action is a cockpit-* forwarding write or undo-ask-change
 * and the front marked the request verified (the cockpit's write gate admitted
 * that caller), or it is ask-agent, which decides from the mark itself.
 * This server listens on loopback only, so only a process on this Mac (the
 * front) can set either header, and the front strips both from its callers.
 */
export function loopbackOnlyRefusal(pathname: string, socketIp: string | undefined | null, peerHeader: string | undefined | null, writeHeader?: string | undefined | null): string | null {
  const m = ROUTE.exec(pathname);
  if (!m) return null;
  if (!isLoopbackAddress(socketIp)) return `${m[1]} answers loopback requests only`;
  if (peerHeader && !isLoopbackAddress(peerHeader)) {
    if (REMOTE_ASK_ACTIONS.includes(m[1])) return null;
    if (writeHeader === "verified" && REMOTE_VERIFIED_ACTIONS.includes(m[1])) return null;
    return `${m[1]} is read-only on this device`;
  }
  return null;
}

/**
 * MI-388: whether an ask-agent caller may APPLY a change (and rearrange the layout): this Mac, or a remote viewer the front marked verified
 * (a paired phone). Anyone else gets reads, an unchanged layout and its change requests filed as cards.
 */
export function askerCanApply(peerHeader: string | undefined | null, writeHeader: string | undefined | null): boolean {
  return !peerHeader || isLoopbackAddress(peerHeader) || writeHeader === "verified";
}

/** Whether this viewer's cockpit writes will be admitted: this Mac, or a remote viewer the cockpit's write gate admits (the front's mark). */
export function viewerCanWrite(socketIp: string | undefined | null, peerHeader: string | undefined | null, writeHeader: string | undefined | null): boolean {
  if (!isLoopbackAddress(socketIp)) return false;
  if (!peerHeader || isLoopbackAddress(peerHeader)) return true;
  return writeHeader === "verified";
}

export default defineEventHandler((event) => {
  const ip = getRequestIP(event),
    peer = getRequestHeader(event, "x-cockpit-peer"),
    write = getRequestHeader(event, "x-cockpit-write");
  // GET get-viewer: answered here, by the same rule the writes are gated by, so the page enables exactly the controls that will work
  if (VIEWER.test(event.url.pathname) && event.req.method === "GET") {
    const canWrite = viewerCanWrite(ip, peer, write);
    return { canWrite, via: !peer || isLoopbackAddress(peer) ? "this Mac" : canWrite ? "admitted by the cockpit's write gate" : "read-only on this device" };
  }
  const why = loopbackOnlyRefusal(event.url.pathname, ip, peer, write);
  if (why) throw new HTTPError({ status: 403, message: why });
});
