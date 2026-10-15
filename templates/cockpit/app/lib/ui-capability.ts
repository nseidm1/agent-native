import { agentNativePath } from "@agent-native/core/client/api-path";
import { useEffect, useState } from "react";

/**
 * FA-19155: the browser's UI capability, taken BEFORE the first UI-only action goes out.
 *
 * get-ask-job, ask-agent and undo-ask-change are uiOnly: the framework answers them 403 ui_capability_required unless the
 * request carries the short-lived capability cookie (GET /_agent-native/ui-capability, 10 minutes). Its client fetches the
 * cookie only AFTER a 403 and retries, so the first call still lands in the console as a failed resource. AppliedBanner reads
 * get-ask-job the moment the region mounts, so on a fresh browser (the phone, the 390 e2e context: a new cookie jar) that
 * first read raced the capability and lost; whether a page lost the race depended on whether anything had taken the cookie
 * earlier in that jar, which is why it was intermittent and looked phone-only. The fix: take it once per page first, gate the
 * uiOnly reads on it, and renew it before it lapses so the 60 s poll never meets an expired cookie.
 */
export const UI_CAPABILITY_RENEW_MS = 4 * 60_000;
type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;
let pending: Promise<boolean> | null = null;
let takenAt = 0;

/** Takes the capability (one request in flight, reused while it is fresh); resolves true when the cookie was issued. */
export function ensureUiCapability(opts: { force?: boolean; fetcher?: Fetcher; now?: () => number } = {}): Promise<boolean> {
  const now = (opts.now || Date.now)();
  if (pending && !opts.force && now - takenAt < UI_CAPABILITY_RENEW_MS) return pending;
  takenAt = now;
  const f: Fetcher = opts.fetcher || ((u, i) => fetch(u, i));
  pending = f(agentNativePath("/_agent-native/ui-capability"), { credentials: "same-origin", cache: "no-store" })
    .then((r) => !!r.ok)
    .catch(() => false);
  return pending;
}

/** Test seam: forget the cached capability. */
export function resetUiCapability() {
  pending = null;
  takenAt = 0;
}

/**
 * True once the capability request settled (issued or not: a refusal still lets the framework's own retry speak), and kept
 * fresh while mounted. Pass it as `enabled` to every useActionQuery of a uiOnly action.
 */
export function useUiCapability(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void ensureUiCapability().then(() => {
      if (live) setReady(true);
    });
    const t = setInterval(() => void ensureUiCapability({ force: true }), UI_CAPABILITY_RENEW_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return ready;
}
