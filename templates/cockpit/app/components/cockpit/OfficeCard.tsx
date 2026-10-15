import type { ReactNode } from "react";
import type { OfficeTile, OfficeView } from "@shared/cockpit-home";

/** Line icons drawn in the tile's tone (currentColor), one per office tile; the server's emoji is the fallback. */
const ICONS: Record<OfficeTile["id"], ReactNode> = {
  agents: (
    <>
      <circle cx="12" cy="8.5" r="3" />
      <path d="M6.5 19v-1.5a5.5 5.5 0 0 1 11 0V19z" />
      <circle cx="5.5" cy="10" r="2.2" />
      <path d="M1.8 18v-1a4 4 0 0 1 4.6-3.9" />
      <circle cx="18.5" cy="10" r="2.2" />
      <path d="M22.2 18v-1a4 4 0 0 0-4.6-3.9" />
    </>
  ),
  queue: (
    <>
      <path d="M6 3h12M6 21h12" />
      <path d="M7.5 3c0 4.5 4.5 6 4.5 9s-4.5 4.5-4.5 9M16.5 3c0 4.5-4.5 6-4.5 9s4.5 4.5 4.5 9" />
      <path d="M9.5 19.5 12 16l2.5 3.5z" />
    </>
  ),
  commits: (
    <>
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
      <path d="M3.5 7 12 11.5 20.5 7M12 11.5v10" />
      <path d="M7.8 4.8 16.2 9.3M16.2 4.8 7.8 9.3" opacity="0.5" />
    </>
  ),
  landed: (
    <>
      <path d="M14.5 3.5c3-1 5.5-1 6-.5s.5 3-.5 6l-7 7-5-5z" />
      <circle cx="15.5" cy="8.5" r="1.6" />
      <path d="M8 11 4.5 11 3 13.5l4 .5M13 16v3.5L10.5 21l-.5-4" />
      <path d="M6.5 17.5 3 21M8.5 19 6 21.5M5 15.5 2.5 18" />
    </>
  ),
  halo: (
    <>
      <path d="M4 9a8 8 0 0 0 11 11z" />
      <path d="M9.5 14.5 13 11" />
      <circle cx="13.5" cy="10.5" r="1" />
      <path d="M8 20l-2 2.5h6L10 20" />
      <path d="M15 6.5a3 3 0 0 1 2.5 2.5M15.5 3.5a6 6 0 0 1 5 5" />
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
        <span className="cf-oflock" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="5" y="10.5" width="14" height="10" rx="2" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
            <circle cx="12" cy="15.5" r="1.3" />
          </svg>
        </span>
        <span className="cf-oft">Office</span>
        <span className="cf-ofs">{office.head}</span>
        <span className="cf-ofdots" aria-hidden="true" />
      </div>
      {office.tiles ? (
        <div className="cf-oftiles">
          {office.tiles.map((t) => (
            <div key={t.id} className={`cf-oftile t-${t.tone}${t.live ? " live" : ""}`} title={t.title} data-queue={t.queue ? "1" : undefined} data-of={t.id}>
              <span className="cf-ofl">{t.label}</span>
              <span className="cf-ofring" aria-hidden="true">
                {ICONS[t.id] ? (
                  <svg viewBox="0 0 24 24">{ICONS[t.id]}</svg>
                ) : (
                  <span className="cf-ofi">{t.icon}</span>
                )}
              </span>
              <span className="cf-ofn">
                <b>{t.n == null ? "…" : t.n}</b>
                {t.suffix ? <small className={/^[/%]/.test(t.suffix) ? "join" : undefined}>{t.suffix}</small> : null}
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
