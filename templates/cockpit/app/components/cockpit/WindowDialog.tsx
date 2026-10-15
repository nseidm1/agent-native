import { useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WINDOW_TITLES, type WindowDetail, type WindowId } from "@shared/cockpit-windows";

import { DetailView, GLYPH, postModal, READ_ONLY } from "./CardDialog";
import { useCanWrite } from "./viewer";
import { WINDOW_PARTS } from "./windows";

/**
 * FA-19087: one of the cockpit's own windows (Overview, Who's working, the commit queue, JEV, Halo savings,
 * Balancer and the header's dialogs), rendered by agent-native from get-window: the same shell and sections a
 * card's click window has, plus the window's own part (WINDOW_PARTS) where it has one. Live: refetched on the
 * cockpit client's change stream, the interval is the fallback.
 */
export function WindowDialog({ id, args, onClose, returnTo }: { id: WindowId | null; args?: Record<string, string>; onClose: () => void; returnTo: HTMLElement | null }) {
  const open = !!id;
  const canWrite = useCanWrite();
  const returnRef = useRef<HTMLElement | null>(null);
  returnRef.current = returnTo;
  useEffect(() => {
    if (!open) return;
    postModal(true);
    return () => postModal(false);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {id ? (
        <DialogContent
          hideClose
          motion="instant"
          className="cp-dlg cf-win"
          overlayClassName="cp-dlg-ov"
          aria-describedby="cf-win-desc"
          data-window={id}
          data-testid="cf-window"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnRef.current?.focus();
          }}
        >
          <WindowBody id={id} args={args} canWrite={canWrite} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function WindowBody({ id, args, canWrite, onClose }: { id: WindowId; args?: Record<string, string>; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [server, setServer] = useState<Record<string, string>>(args || {});
  // FA-19157: the window re-opens on its args (the Apps window on an app's studio: { app })
  const argsKey = JSON.stringify(args || {});
  useEffect(() => setServer(args || {}), [id, argsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useActionQuery<WindowDetail>("get-window", { id, ...server } as any, { refetchInterval: 10000 });
  // the document for THESE args: an app's studio never shows the picker's last copy (or another app's) while it loads
  const want = id === "apps" ? server.app || "" : null;
  const d = q.data && q.data.id === id && (want === null || String(((q.data.part as any) || {}).studio?.app || "") === want) ? q.data : null;
  const tone = d ? d.tone : "d";
  const Part = WINDOW_PARTS[id];
  return (
    <>
      <header className={"cp-dlg-h t-" + tone}>
        <span className="cp-edge" />
        <div className="cp-dlg-ht">
          <DialogTitle className="cp-dlg-title">
            <i className={"cp-dot t-" + tone} />
            {d ? d.title : WINDOW_TITLES[id]}
            <span className="cp-glyph-i" aria-hidden="true">
              {GLYPH[tone]}
            </span>
          </DialogTitle>
          {d && d.headline ? <div className={"cp-dlg-hl c-" + tone}>{d.headline}</div> : null}
          <DialogDescription id="cf-win-desc" className="cp-dlg-sub">
            {d ? d.sub : "Reading the cockpit…"}
            {d ? d.chips.map((c, i) => (
              <span key={i} className={"cp-chip" + (c.tone ? " c-" + c.tone : "")}>
                {c.t}
              </span>
            )) : null}
          </DialogDescription>
        </div>
        <button type="button" className="cp-btn cp-x-btn" onClick={onClose} aria-label={"Close " + WINDOW_TITLES[id]}>
          ✕
        </button>
      </header>
      <div className="cp-dlg-b" data-testid="cf-window-body">
        {!d ? (
          <div className="cp-dlg-msg">{q.isError ? "Could not read this window: " + (q.error instanceof Error ? q.error.message : String(q.error)) : "Reading the cockpit…"}</div>
        ) : (
          <>
            {Part ? <Part d={d} canWrite={canWrite} onDone={() => void qc.invalidateQueries()} setArgs={(a) => setServer(a)} /> : null}
            <DetailView d={d} canWrite={canWrite} server={server} setServer={setServer} />
          </>
        )}
      </div>
      <footer className="cp-dlg-f">
        <span className="cp-dlg-f-l">{canWrite ? "Writes go to the cockpit." : "Viewing only: " + READ_ONLY + "."}</span>
        <button type="button" className="cp-btn" onClick={onClose}>
          Close
        </button>
      </footer>
    </>
  );
}
