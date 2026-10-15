/**
 * FA-19175: the studio's inbox drawer (studio-lifecycle.js inboxTop + the record's questions, card-studio.js renderQA), its Details
 * drawer (card-studio.js drawer for an app: Work, Brief, Agents, Messages, Files, Activity) and the lifecycle tiles' full details
 * (Build, Quality, Launch ready, Deploy, Live: studio-lifecycle.js drawDetail, launchBox, deployBox, liveBox). The pieces live in
 * ./drawers/; this file is the shell's seam: the two header buttons, the drawer layers and the tile detail.
 */
import { useStudio } from "./api";
import { DetailsDrawer } from "./drawers/Details";
import { InboxDrawer } from "./drawers/Inbox";
import { TileDetailBody } from "./drawers/TileDetails";

import "./studio-drawers.css";

export function InboxButton() {
  const st = useStudio();
  const s = st.s;
  const on = st.layer?.kind === "inbox";
  return (
    <button
      type="button"
      className={"cp-btn sm ghost st-inbox" + (s.inbox.need ? " need" : "")}
      data-testid="studio-inbox"
      data-k="inbox"
      aria-expanded={on}
      aria-haspopup="dialog"
      aria-label={
        "Inbox" +
        (s.inbox.need ? ", " + s.inbox.need + " need you" : "") +
        (s.inbox.proposals ? ", " + s.inbox.proposals + " proposals" : "")
      }
      title={
        s.inbox.need
          ? s.inbox.need +
            " thing" +
            (s.inbox.need === 1 ? "" : "s") +
            " need you"
          : "Inbox: questions, decisions, proposals and activity"
      }
      onClick={() => (on ? st.close() : st.open({ kind: "inbox" }))}
    >
      <span aria-hidden="true">✉</span> {s.inbox.text}
      {!s.inbox.need && s.inbox.proposals ? (
        <span className="ap-chip">{s.inbox.proposals} proposals</span>
      ) : null}
    </button>
  );
}
export function DetailsButton() {
  const st = useStudio();
  const on = st.layer?.kind === "details";
  return (
    <button
      type="button"
      className="cp-btn sm ghost"
      data-k="details"
      data-testid="studio-details-btn"
      aria-expanded={on}
      aria-haspopup="dialog"
      onClick={() => (on ? st.close() : st.open({ kind: "details" }))}
    >
      Details
    </button>
  );
}
/** The inbox and Details drawers, by the studio's open layer. */
export function DrawerLayers() {
  return (
    <>
      <InboxDrawer />
      <DetailsDrawer />
    </>
  );
}
/** A lifecycle tile's detail (k: build | quality | launch | deploy | live). */
export function TileDetail({ k }: { k: string }) {
  const st = useStudio();
  const t = st.s.tiles.find((x) => x.k === k);
  if (!t) return null;
  return <TileDetailBody k={k} />;
}
