import type { OfficeView } from "@shared/cockpit-home";

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
              <span className="cf-ofn">
                <span className="cf-ofi" aria-hidden="true">
                  {t.icon}
                </span>
                <b>{t.n == null ? "…" : t.n}</b>
                {t.suffix ? <small>{t.suffix}</small> : null}
              </span>
              <span className="cf-ofl">{t.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="cf-ofnote">{office.note || office.head}</div>
      )}
    </div>
  );
}
