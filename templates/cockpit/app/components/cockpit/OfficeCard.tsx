import type { ReactNode } from "react";
import type { OfficeTile, OfficeView } from "@shared/cockpit-home";

/** Line icons drawn in the tile's tone (currentColor); a tile without one keeps the server's emoji. */
const ICONS: Record<OfficeTile["id"], ReactNode> = {
  agents: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M6.5 19v-1.5a5.5 5.5 0 0 1 11 0V19z" />
      <circle cx="5.5" cy="9.5" r="2.2" />
      <path d="M2 18v-1a3.8 3.8 0 0 1 4-3.8" />
      <circle cx="18.5" cy="9.5" r="2.2" />
      <path d="M22 18v-1a3.8 3.8 0 0 0-4-3.8" />
    </>
  ),
  queue: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
      <path d="M9.5 19h5l-2.5-2.5z" />
    </>
  ),
  commits: (
    <>
      <path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" />
      <path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5" />
      <path d="M7.75 4.9l8.5 4.75M16.25 4.9l-8.5 4.75" opacity="0.5" />
    </>
  ),
  landed: (
    <>
      <path d="M14.5 3.5c3-1 5.5-1 6 0s.5 3-.5 6l-7 7-5.5-5.5z" />
      <circle cx="15.5" cy="8.5" r="1.6" />
      <path d="M7.5 11L4 11.5 2.5 14l4 .5M13 16.5l-.5 3.5-2.5 1.5-.5-4" />
      <path d="M6 18l-3 3M8 19.5l-1.5 1.5M4.5 16L3 17.5" />
    </>
  ),
  halo: (
    <>
      <path d="M4.5 6.5a8 8 0 0 0 11 11z" />
      <path d="M10 12l3.5-3.5" />
      <circle cx="14" cy="8" r="1" />
      <path d="M16 4.5a4 4 0 0 1 3.5 3.5M16.5 1.8a6.8 6.8 0 0 1 5.7 5.7" />
      <path d="M8.5 16.5L7 21.5h7l-1.5-3" />
    </>
  ),
  refusals: (
    <>
      <path d="M8.3 2.5h7.4l5.3 5.3v7.4l-5.3 5.3H8.3L3 15.2V7.8z" />
      <path d="M7.5 12h9" strokeWidth="2.6" />
    </>
  ),
};

/**
 * The agent office (FA-19087): the six-tile face the legacy renderOffice draws
 * (Working, Waiting, Commits, Landed today, Halo up, Refused). Its own file so
 * the office restyle (FA-19080) can change the look without touching the rest
 * of the home column. A click opens Who's working; the Commits tile opens the
 * commit queue.
 */
export function OfficeCard({ office, onOpen }: { office: OfficeView; onOpen: (slug: string, el: HTMLElement) => void }) {
  return (
    <div
      className="cf-office"
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={office.aria}
      title={office.title || undefined}
      data-testid="cf-office"
      onClick={(e) => {
        const q = (e.target as HTMLElement).closest("[data-queue]");
        onOpen(q ? "queue" : "agents", e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen("agents", e.currentTarget);
        }
      }}
    >
      <div className="cf-ofh">
        <span className="cf-oft">Office</span>
        <span className="cf-ofs">{office.head}</span>
      </div>
      {office.tiles ? (
        <div className="cf-oftiles">
          {office.tiles.map((t) => (
            <div key={t.id} className={`cf-oftile t-${t.tone}${t.live ? " live" : ""}`} title={t.title} data-queue={t.queue ? "1" : undefined} data-of={t.id}>
              <span className="cf-ofl">{t.label}</span>
              <span className="cf-ofbody">
                <span className="cf-ofi" aria-hidden="true">
                  {ICONS[t.id] ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {ICONS[t.id]}
                    </svg>
                  ) : (
                    t.icon
                  )}
                </span>
                <span className="cf-ofn">
                  <b>{t.n == null ? "…" : t.n}</b>
                  {t.suffix ? <small>{t.suffix}</small> : null}
                </span>
              </span>
              <span className="cf-ofbar" aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : (
        <div className="cf-ofnote">{office.note || office.head}</div>
      )}
    </div>
  );
}
