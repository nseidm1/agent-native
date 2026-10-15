/**
 * FA-19175: the studio's inbox drawer (studio-lifecycle.js inboxTop + the record's questions), its Details drawer
 * (card-studio.js drawer: Brief, Agents, Messages, Ready, Files, Activity) and the lifecycle tiles' full details (Build,
 * Quality, Launch ready, Deploy, Live: studio-lifecycle.js drawDetail, launchBox, deployBox, liveBox). STUB in the shell.
 */
import { useStudio } from "./api";

export function InboxButton() {
  const st = useStudio();
  const s = st.s;
  return (
    <button
      type="button"
      className={"cp-btn sm ghost st-inbox" + (s.inbox.need ? " need" : "")}
      data-testid="studio-inbox"
      data-k="inbox"
      aria-expanded={st.layer?.kind === "inbox"}
      aria-label={"Inbox" + (s.inbox.need ? ", " + s.inbox.need + " need you" : "") + (s.inbox.proposals ? ", " + s.inbox.proposals + " proposals" : "")}
      title={s.inbox.need ? s.inbox.need + " waiting on you" : "Inbox: questions, decisions, proposals and activity"}
      onClick={() => st.open({ kind: "inbox" })}
    >
      <span aria-hidden="true">✉</span> {s.inbox.text}
      {!s.inbox.need && s.inbox.proposals ? <span className="ap-chip">{s.inbox.proposals} proposals</span> : null}
    </button>
  );
}
export function DetailsButton() {
  const st = useStudio();
  return (
    <button type="button" className="cp-btn sm ghost" data-k="details" aria-expanded={st.layer?.kind === "details"} onClick={() => st.open({ kind: "details" })}>
      Details
    </button>
  );
}
export function DrawerLayers() {
  return null;
}
const STATUS_WORD: Record<string, string> = { verified: "verified", failing: "failing", blocked: "could not check", pending: "not checked yet", unwritten: "no check yet", context: "context" };
/** A lifecycle tile's detail (k: build | quality | launch | deploy | live). */
export function TileDetail({ k }: { k: string }) {
  const st = useStudio();
  const s = st.s;
  const t = s.tiles.find((x) => x.k === k);
  if (!t) return null;
  if (k === "build") {
    const r = s.requirements;
    return (
      <>
        <p className="st-dl">
          <b>{r.text}</b>
          {r.detail ? " · " + r.detail : ""}
          {s.autopilot.text ? <span className="st-sub"> · {s.autopilot.text}</span> : null}
        </p>
        {r.note ? <p className="st-sub">{r.note}</p> : null}
        {r.items.length ? (
          <ul className="st-list st-reqs" data-testid="studio-requirements">
            {r.items.map((x) => (
              <li key={x.id} title={x.why || undefined}>
                <span className={"ap-chip t-" + (x.tone || "n")}>{STATUS_WORD[x.status] || x.status}</span> {x.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ap-none">No requirements yet.</p>
        )}
      </>
    );
  }
  return (
    <p className="st-dl">
      <b>{t.v}</b>
      {t.s ? " · " + t.s : ""}
    </p>
  );
}
