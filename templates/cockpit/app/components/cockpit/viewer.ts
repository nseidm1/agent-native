import { callAction } from "@agent-native/core/client/hooks";
import { useQuery } from "@tanstack/react-query";

/** Whether the page is open on this Mac (the address it was opened at); the answer until get-viewer has spoken. */
export function isLocalViewer(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname.replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

/**
 * FA-19087 phone writes parity (MI-370): whether this viewer's cockpit writes will be admitted, from get-viewer
 * (the region's write gate: this Mac, or a phone the cockpit's own write gate admits). The legacy page let a
 * paired phone use the lock, the lane switches and Budget; so does this one, exactly where the cockpit says so.
 */
export function useCanWrite(): boolean {
  // its own request, never a batch: the region's write gate (server/middleware/ask-agent-loopback.ts) answers it from this request's headers
  const q = useQuery({
    queryKey: ["cockpit-viewer"],
    queryFn: () => callAction<{ canWrite: boolean; via: string }>("get-viewer", {}, { method: "GET", headers: { "x-cockpit-viewer": "1" } }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return q.data ? q.data.canWrite === true : isLocalViewer();
}
