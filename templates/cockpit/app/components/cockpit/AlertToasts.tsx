import { useActionQuery } from "@agent-native/core/client/hooks";
import { useEffect, useMemo, useRef, useState } from "react";

const SNACK_MS = 5000;
const SNACK_BAD_MS = 8000;
const PHONE = "(max-width: 640px)";

type Toast = { key: string; words: string; bad: boolean; kind: "svc" | "pace"; note?: { id: string; why: string } };
type AlertsView = { at: number; ok: boolean; toasts: Toast[] };

const noteOff = (id: string) => {
  try {
    return window.localStorage.getItem("paceToastOff:" + id);
  } catch {
    return null;
  }
};

/**
 * FA-19135: the forge alert toasts, as the legacy page's snackbar (fleetTick / svcToasts / paceToasts): each alert
 * from get-alerts is a toast that goes by itself (5 s, 8 s for a fault) or on a tap or a swipe, and stays gone until
 * its words change; a cleared cause forgets its dismissal so a recurrence shows again. A pace note's x dismisses it
 * until its why changes (localStorage paceToastOff:<id>, the legacy key). On a phone one toast shows at a time.
 * Pace toasts link to the Forge card, as the legacy ones do.
 */
export function AlertToasts({ onForge }: { onForge: () => void }) {
  const q = useActionQuery<AlertsView>("get-alerts", {}, { refetchInterval: 5000 });
  const gone = useRef(new Map<string, string>());
  const [, bump] = useState(0);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(PHONE);
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  const all = q.data ? q.data.toasts : [];
  // a cleared cause forgets its dismissal
  useEffect(() => {
    const keys = new Set(all.map((t) => t.key));
    for (const k of [...gone.current.keys()]) if (!keys.has(k)) gone.current.delete(k);
  }, [all]);
  const want = useMemo(() => all.filter((t) => gone.current.get(t.key) !== t.words && !(t.note && noteOff(t.note.id) === t.note.why)), [all, gone.current.size, bump]);
  const shown = phone ? want.slice(0, 1) : want;
  const dismiss = (t: Toast) => {
    gone.current.set(t.key, t.words);
    bump((n) => n + 1);
  };
  return (
    <div className="cf-alerts" aria-live="polite" data-testid="cf-alerts">
      {shown.map((t) => (
        <Snack key={t.key + "|" + t.words} t={t} onGone={() => dismiss(t)} onForge={onForge} />
      ))}
    </div>
  );
}

function Snack({ t, onGone, onForge }: { t: Toast; onGone: () => void; onForge: () => void }) {
  const x0 = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  useEffect(() => {
    const id = setTimeout(onGone, t.bad ? SNACK_BAD_MS : SNACK_MS);
    return () => clearTimeout(id);
    // the words are the identity: a change re-arms the timer (the key includes them)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={"cf-alert" + (t.bad ? " bad" : "") + (t.kind === "pace" ? " pace" : "")}
      role="status"
      data-alert={t.key}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 200) } : undefined}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        x0.current = e.clientX;
        setDx(0);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // no capture: the swipe still works within the toast
        }
      }}
      onPointerMove={(e) => x0.current != null && setDx(e.clientX - x0.current)}
      onPointerUp={() => {
        if (x0.current == null) return;
        const d = Math.abs(dx);
        x0.current = null;
        setDx(0);
        if (d < 8 || d > 60) onGone(); // a tap or a swipe
      }}
      onPointerCancel={() => {
        x0.current = null;
        setDx(0);
      }}
    >
      <span className="cf-alert-t">{t.words}</span>
      {t.kind === "pace" ? (
        <button type="button" className="cf-alert-l" onClick={onForge}>
          Forge
        </button>
      ) : null}
      {t.note ? (
        <button
          type="button"
          className="cf-alert-x"
          aria-label="Dismiss this note"
          onClick={() => {
            try {
              window.localStorage.setItem("paceToastOff:" + t.note!.id, t.note!.why);
            } catch {
              // per-viewer convenience only
            }
            onGone();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
