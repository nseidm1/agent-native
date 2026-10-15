import { useEffect, useRef, useState } from "react";

/** Where the cockpit front keeps the legacy page while its windows are being ported (front.mjs, FA-19087). */
export const LEGACY_BASE = "/legacy/";

export type LegacyTarget = { slug: string; label: string } | { button: string; label: string };

/**
 * A window the agent-native cockpit does not render yet (FA-19087's remaining
 * children: Overview, Who's working, JEV, Halo savings, Balancer, the commit
 * queue, and the header's account, apps, usage, master, push and phone
 * dialogs). It opens the legacy page's own window, in place, over this page:
 * the legacy page at the front's fallback path in a full-screen frame, at its
 * section hash, or with its header button pressed for it. Closing the legacy
 * window closes the frame. Nothing here reads the cockpit: the legacy page does,
 * as it always has, until the window is ported onto the client.
 */
export function LegacyWindow({ target, onClose }: { target: LegacyTarget | null; onClose: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(false), [target]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);
  if (!target) return null;
  const src = LEGACY_BASE + ("slug" in target ? "#" + target.slug : "");
  const onLoad = () => {
    const f = ref.current;
    let doc: Document | null = null;
    try {
      doc = f && f.contentDocument;
    } catch {
      doc = null;
    }
    if (!doc) return setReady(true);
    let tries = 0,
      opened = false;
    const watch = () => {
      // the legacy window opened: when every dialog in the frame is closed again, so is this one
      const open = doc!.querySelectorAll("dialog[open]").length;
      if (open) opened = true;
      else if (opened) return onClose();
      setTimeout(watch, 400);
    };
    const press = () => {
      if ("button" in target) {
        const b = doc!.getElementById(target.button) as HTMLElement | null;
        if (b && !b.hasAttribute("hidden")) {
          b.click();
          setReady(true);
          return watch();
        }
        if (++tries < 40) return void setTimeout(press, 250);
      }
      setReady(true);
      watch();
    };
    press();
  };
  return (
    <div className="cf-legacy" role="dialog" aria-modal="true" aria-label={target.label} data-testid="cf-legacy">
      <div className="cf-legacy-bar">
        <span>{target.label}</span>
        <small>{ready ? "the cockpit's own window" : "opening…"}</small>
        <button type="button" className="cf-btn" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
      <iframe ref={ref} src={src} title={target.label} onLoad={onLoad} />
    </div>
  );
}
