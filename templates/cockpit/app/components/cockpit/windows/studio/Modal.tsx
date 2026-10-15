import type { ReactNode } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/**
 * FA-19087: a studio dialog over the studio (the legacy studio's own dialogs: the Agent chat, an Optimizer, the KPIs, QA
 * agents, New Design ...), in the cockpit's neon dialog shell. Esc and Close close it alone, never the studio under it.
 * size: "md" (720), "lg" (980), "xl" (1240, the chat beside the live staging app). On a phone every size is full screen.
 */
export function StudioModal({ open, onClose, title, sub, extra, size = "lg", testid, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; extra?: ReactNode; size?: "md" | "lg" | "xl"; testid?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {open ? (
        <DialogContent hideClose motion="instant" className={"cp-dlg st-modal st-" + size} overlayClassName="cp-dlg-ov st-modal-ov" data-testid={testid} aria-describedby={undefined} onEscapeKeyDown={(e) => e.stopPropagation()}>
          <header className="cp-dlg-h t-s st-mh">
            <span className="cp-edge" />
            <div className="cp-dlg-ht">
              <DialogTitle className="cp-dlg-title st-mt">{title}</DialogTitle>
              {sub ? <DialogDescription className="cp-dlg-sub">{sub}</DialogDescription> : <DialogDescription className="sr-only">{typeof title === "string" ? title : "Studio dialog"}</DialogDescription>}
            </div>
            {extra ? <div className="st-mx">{extra}</div> : null}
            <button type="button" className="cp-btn cp-x-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </header>
          <div className="cp-dlg-b st-mb">{children}</div>
          {footer ? <footer className="cp-dlg-f st-mf">{footer}</footer> : null}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** FA-19175: a studio drawer (the inbox, Details) from the right edge; on a phone it covers the screen. */
export function StudioDrawer({ open, onClose, title, testid, children, extra }: { open: boolean; onClose: () => void; title: ReactNode; testid?: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      {open ? (
        <SheetContent side="right" showClose={false} className="st-drawer" data-testid={testid} aria-describedby={undefined} onEscapeKeyDown={(e) => e.stopPropagation()}>
          <header className="st-dh">
            <SheetTitle className="st-dt">{title}</SheetTitle>
            <SheetDescription className="sr-only">{typeof title === "string" ? title : "Studio drawer"}</SheetDescription>
            {extra}
            <span className="st-sp" />
            <button type="button" className="cp-btn sm ghost" onClick={onClose} aria-label="Close the drawer">
              ✕
            </button>
          </header>
          <div className="st-db">{children}</div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
