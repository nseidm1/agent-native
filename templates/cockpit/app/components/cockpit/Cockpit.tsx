import { useActionQuery } from "@agent-native/core/client/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CARD_TITLES, type CardId, type CardsResult, type CockpitCard } from "@shared/cockpit";
import type { HomeView, Opens } from "@shared/cockpit-home";
import { HEADER_WINDOWS, isNativeWindow, type WindowId } from "@shared/cockpit-windows";
import { BoardDialog } from "./BoardDialog";
import { CardDialog } from "./CardDialog";
import { AlertToasts } from "./AlertToasts";
import { UpdateBar } from "./UpdateBar";
import { useCanWrite } from "./viewer";
import { WindowDialog } from "./WindowDialog";
import { CardRegion } from "./CardRegion";
import { Home } from "./Home";
import { TopBar, type HeaderOpen } from "./TopBar";

const GLANCE_KEY = "lcc-glance";

/**
 * THE WHOLE FRONT-FACING COCKPIT, rendered by agent-native (FA-19087; console
 * 2026-10-15: "I want agent-native to render the entire cockpit using its
 * tooling"). The top bar and the home column come from get-home, the card
 * region beside them is the same CardRegion the legacy page framed, and every
 * read is the cockpit client's (server/cockpit/client.ts). Desktop: the home
 * column left, the cards right. Phone: one column, the home first; Glance
 * keeps the lane, the office and the faces.
 */
export function Cockpit() {
  const qc = useQueryClient();
  const homeQ = useActionQuery<HomeView>("get-home", {}, { refetchInterval: 10000 });
  const cardsQ = useActionQuery<CardsResult>("get-cards", {}, { refetchInterval: 15000 });
  const canWrite = useCanWrite();
  const [notices, setNotices] = useState<{ id: number; text: string; bad?: boolean }[]>([]);
  const nid = useRef(0);
  const notify = useCallback((text: string, bad?: boolean) => {
    const id = ++nid.current;
    setNotices((n) => [...n.slice(-3), { id, text, bad }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), bad ? 9000 : 5000);
  }, []);
  const [cardOpen, setCardOpen] = useState<CardId | null>(null);
  const [win, setWin] = useState<WindowId | null>(null);
  const [winArgs, setWinArgs] = useState<Record<string, string>>({});
  const opener = useRef<HTMLElement | null>(null);
  const [glance, setGlance] = useState(false);
  useEffect(() => {
    let g = "0";
    try {
      g = window.localStorage.getItem(GLANCE_KEY) || "0";
    } catch {
      // per-viewer convenience only
    }
    setGlance(window.location.hash === "#glance" || (g === "1" && window.matchMedia("(max-width:640px)").matches));
  }, []);
  const toggleGlance = () =>
    setGlance((v) => {
      try {
        window.localStorage.setItem(GLANCE_KEY, v ? "0" : "1");
      } catch {
        // per-viewer convenience only
      }
      return !v;
    });

  const byId = useMemo(() => {
    const m = new Map<CardId, CockpitCard>();
    for (const c of cardsQ.data?.cards ?? []) m.set(c.id, c);
    return m;
  }, [cardsQ.data]);
  const face = (id: CardId): CockpitCard => byId.get(id) ?? { id, title: CARD_TITLES[id], tone: "d", headline: "Loading…", sub: "reading the cockpit", chip: "" };

  const open = useCallback((o: Opens, el: HTMLElement) => {
    opener.current = el;
    if ("card" in o) setCardOpen(o.card);
    else if (isNativeWindow(o.legacy)) {
      setWinArgs({});
      setWin(o.legacy);
    }
  }, []);
  const openHeader = useCallback((o: HeaderOpen) => {
    if ("href" in o) window.open(o.href, "_blank", "noopener");
    else if (isNativeWindow(HEADER_WINDOWS[o.button])) {
      opener.current = document.activeElement as HTMLElement | null;
      setWinArgs({});
      setWin(HEADER_WINDOWS[o.button]);
    }
  }, []);
  const refresh = useCallback(() => void qc.invalidateQueries(), [qc]);
  // FA-19129/FA-19134: the windows' own openers - #questions (#questions/<id>), #issues and #apps open the native windows;
  // FA-19157: #apps=<id> opens that app's studio natively (the Apps window with { app }); a window's part opens another window by event
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash;
      const app = /^#apps=([\w-]+)$/.exec(h);
      if (app) {
        setWinArgs({ app: app[1] });
        setWin("apps");
        return;
      }
      const m = /^#(questions|issues|apps)(?:\/cq-[a-z0-9]+)?$/.exec(h);
      if (m && isNativeWindow(m[1])) {
        setWinArgs({});
        setWin(m[1]);
      }
    };
    const onWin = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; args?: Record<string, string> }>).detail;
      if (d && isNativeWindow(d.id)) {
        setWinArgs(d.args && typeof d.args === "object" ? d.args : {});
        setWin(d.id);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("cockpit-open-window", onWin);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("cockpit-open-window", onWin);
    };
  }, []);
  const clearHash = () => {
    if (/^#(questions|issues|apps)/.test(window.location.hash)) history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const h = homeQ.data;
  return (
    <div className={"cf-page" + (glance ? " glance" : "")} data-testid="cockpit-full">
      {h ? (
        <TopBar h={h.header} onOpen={openHeader} glance={glance} onGlance={toggleGlance} />
      ) : (
        <header className="cf-top" data-testid="cf-top">
          <span className="cf-wmt">
            <b>
              Family <em>Office</em>
            </b>
          </span>
        </header>
      )}
      {h && !h.ok ? (
        <div className="cf-stale" role="status">
          {h.error || "the cockpit is not answering"}: showing the last good reading
        </div>
      ) : null}
      <main className="cf-layout" id="main" tabIndex={-1}>
        <h1 className="sr-only">Family Office lane cockpit</h1>
        {h ? <Home home={h} canWrite={canWrite} notify={notify} onOpen={open} onDone={refresh} /> : <div className="cf-home cf-loading">Reading the cockpit…</div>}
        <nav className="cf-launch" aria-label="Sections">
          <CardRegion />
        </nav>
      </main>
      {h ? <div className="cf-foot">{h.foot}</div> : null}
      <UpdateBar />
      <AlertToasts onForge={() => setCardOpen("forge")} />
      <div className="cf-toasts" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={"cf-toast" + (n.bad ? " bad" : "")}>
            {n.text}
          </div>
        ))}
      </div>
      <CardDialog card={cardOpen && cardOpen !== "board" ? face(cardOpen) : null} onClose={() => setCardOpen(null)} returnTo={opener.current} />
      <BoardDialog card={cardOpen === "board" ? face("board") : null} onClose={() => setCardOpen(null)} returnTo={opener.current} />
      <WindowDialog
        id={win}
        args={winArgs}
        onClose={() => {
          setWin(null);
          setWinArgs({});
          clearHash();
          refresh();
        }}
        returnTo={opener.current}
      />
    </div>
  );
}
