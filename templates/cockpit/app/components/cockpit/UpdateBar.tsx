import { callAction } from "@agent-native/core/client/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const STABLE_MS = 60_000;
const IDLE_MS = 120_000;
const RELOAD_GAP_MS = 30_000;
const KEY = "lcc-reloaded-at";

/**
 * FA-19135: the "Cockpit updated - reload" bar, as the legacy page's verBar / followVersion: this app's build id
 * (get-build) is read at load and every 20 s; a different one means a newer build is serving. The page reloads by
 * itself only when that build has been stable for 60 s, no dialog is open, the console has not clicked, typed or
 * scrolled for 2 minutes, nothing typed is unsaved and the last reload was over 30 s ago; otherwise the bar waits.
 */
export function UpdateBar() {
  // its own request (a per-call header keeps it out of the GET batch), so a test can stand in a newer build
  const q = useQuery({
    queryKey: ["cockpit-build"],
    queryFn: () => callAction<{ build: string }>("get-build", {}, { method: "GET", headers: { "x-cockpit-build": "1" } }),
    refetchInterval: 20_000,
  });
  const first = useRef<string | null>(null);
  const seen = useRef({ v: "", at: 0 });
  const touch = useRef(Date.now());
  const [differs, setDiffers] = useState(false);
  useEffect(() => {
    const on = () => (touch.current = Date.now());
    const evs = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    for (const e of evs) window.addEventListener(e, on, { passive: true, capture: true });
    return () => {
      for (const e of evs) window.removeEventListener(e, on, { capture: true });
    };
  }, []);
  const v = q.data && q.data.build;
  useEffect(() => {
    if (!v) return;
    if (!first.current) first.current = v;
    const d = v !== first.current,
      now = Date.now();
    if (d && seen.current.v !== v) seen.current = { v, at: now };
    setDiffers(d);
    if (d && now - seen.current.at >= STABLE_MS && now - lastReload() >= RELOAD_GAP_MS && quiet(now, touch.current)) reloadNow();
  }, [v, q.dataUpdatedAt]);
  if (!differs) return null;
  return (
    <div className="cf-verbar" role="status" data-testid="cf-verbar">
      <span>Cockpit updated - </span>
      <button type="button" onClick={reloadNow}>
        reload
      </button>
    </div>
  );
}

function lastReload() {
  try {
    return Number(window.localStorage.getItem(KEY) || 0);
  } catch {
    return 0;
  }
}
function reloadNow() {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // per-viewer convenience only
  }
  window.location.reload();
}
function quiet(now: number, lastTouch: number) {
  if (document.querySelector("[role=dialog]")) return false;
  if (now - lastTouch < IDLE_MS) return false;
  for (const n of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
    if (n.disabled || /^(hidden|button|submit|reset|search)$/.test(n.type)) continue;
    if (n.value !== n.defaultValue) return false;
  }
  return true;
}
