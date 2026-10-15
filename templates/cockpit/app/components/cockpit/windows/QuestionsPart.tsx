import type { WindowPartProps } from "./index";
import "./questions-part.css";

/** Opens another native window over this one (Cockpit listens). */
export function openWindow(id: string) {
  window.dispatchEvent(new CustomEvent("cockpit-open-window", { detail: { id } }));
}

/**
 * FA-19134: the questions window's own part: the way to Issues, the other list of what waits on the console (the legacy
 * issBtn is hidden on the legacy page, so this is where the Issues window opens from, beside #issues).
 */
export function QuestionsPart({ d }: WindowPartProps) {
  const n = Number((d.part && d.part.issuesOpen) || 0);
  return (
    <div className="qp-iss" data-testid="questions-issues">
      <span className={"qp-ic" + (n ? " on" : "")} aria-hidden="true">
        !
      </span>
      <span className="qp-t">
        <b>Issues</b> what the system could not finish itself{n ? ": " + n + " open" : ": none open"}
      </span>
      <button type="button" className="cp-btn sm" onClick={() => openWindow("issues")}>
        Open issues
      </button>
    </div>
  );
}
