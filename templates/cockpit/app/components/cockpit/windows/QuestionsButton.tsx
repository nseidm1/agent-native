import type { LaneView } from "@shared/cockpit-home";

import "./questions-button.css";

/**
 * FA-19134: the Lane card's questions button (the legacy qBtn): shown only while questions wait on the console; it opens the
 * questions window (Cockpit's onOpen, the native window once "questions" is in NATIVE_WINDOWS).
 */
export function QuestionsButton({ q, onOpen }: { q: LaneView["questions"]; onOpen: (el: HTMLElement) => void }) {
  if (!q) return null;
  return (
    <button type="button" className={"qb " + q.tone} aria-label={q.aria} aria-haspopup="dialog" data-testid="cf-qbtn" onClick={(e) => onOpen(e.currentTarget)}>
      <span className="qb-i" aria-hidden="true">
        ?
      </span>
      <span className="qb-t">
        <span className="qb-l">{q.label}</span>
        <span className="qb-s">{q.sub}</span>
      </span>
    </button>
  );
}
