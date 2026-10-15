import { useEffect, useState } from "react";

import type { HeaderView } from "@shared/cockpit-home";

/** What a header button opens: its native window, by the button's legacy id (HEADER_WINDOWS), or a link. */
export type HeaderOpen = { button: string; label: string } | { href: string };

const seenKey = "msgSeen";
function readSeen(): number {
  try {
    return Number(window.localStorage.getItem(seenKey) || 0);
  } catch {
    return 0;
  }
}

/**
 * The cockpit's top bar (FA-19087): the Family Office mark, the phone and status
 * pills, the account chip with the Halo match, Architecture, Apps, the plan
 * usage, Message master with its unread count, Push to remote with its count,
 * and the update time. Ported from the legacy header (index.html #top); every
 * dialog it opens is a native window (FA-19087 children; FA-19136 retired the
 * legacy page's window bridge).
 */
export function TopBar({ h, onOpen }: { h: HeaderView; onOpen: (o: HeaderOpen) => void }) {
  const [menu, setMenu] = useState(false);
  const [seen, setSeen] = useState(0);
  useEffect(() => setSeen(readSeen()), [h.master]);
  // FA-19126: the Message master window marks the replies seen while it is open (cf-msgseen); the count clears at once
  useEffect(() => {
    const f = () => setSeen(readSeen());
    window.addEventListener("cf-msgseen", f);
    return () => window.removeEventListener("cf-msgseen", f);
  }, []);
  const unread = h.master ? h.master.replyAts.filter((t) => t > seen).length : 0;
  const upd = h.at ? new Date(h.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
  return (
    <header className={"cf-top" + (menu ? " open" : "")} data-testid="cf-top">
      <a className="cf-wm" href="#" aria-label="Family Office, the studio that builds your apps" onClick={(e) => e.preventDefault()}>
        <svg className="cf-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 3 3 10v3h26v-3z" fill="currentColor" />
          <path d="M6 15h3v10H6zm8.5 0h3v10h-3zM23 15h3v10h-3z" fill="currentColor" opacity=".8" />
          <path d="M3 27h26v2H3z" fill="currentColor" />
          <circle cx="16" cy="8.6" r="1.6" fill="var(--bg)" />
        </svg>
        <span className="cf-wmt">
          <b>
            Family <em>Office</em>
          </b>
          <small>the studio that builds your apps</small>
        </span>
      </a>
      <div className="cf-pills">
        {h.phone ? (
          <button type="button" className={"cf-fpill phone " + h.phone.state} title={h.phone.title} aria-label={"Phone app, " + h.phone.word + ": " + h.phone.title} onClick={() => onOpen({ button: "foPhone", label: "Phone app" })}>
            <span aria-hidden="true">📱</span>
            <b>{h.phone.word}</b>
          </button>
        ) : null}
        <div className={"cf-brand t-" + h.status.tone} data-testid="cf-status">
          <span className={"cf-sdot t-" + h.status.tone} />
          <span>{h.status.text}</span>
        </div>
        <button type="button" className="cf-btn cf-menu" aria-expanded={menu} aria-label="More" onClick={() => setMenu((v) => !v)}>
          ☰
        </button>
      </div>
      <div className="cf-topr">
        <button type="button" className={"cf-hbtn cf-acct " + (h.account ? h.account.tone : "")} title={h.account ? h.account.title : "Claude account the lane runs on"} aria-label={"Claude account: " + (h.account ? h.account.title : "reading")} onClick={() => onOpen({ button: "acctBtn", label: "Claude account" })}>
          <span className="cf-acd" aria-hidden="true">
            {(h.account && h.account.label.trim()[0]) || "·"}
          </span>
          <span className="cf-acl">{h.account ? h.account.label : "Account"}</span>
          {h.account && h.account.halo ? <span className={"cf-ach " + (h.account.halo.match === true ? "y" : h.account.halo.match === false ? "n" : "")}>{h.account.halo.text}</span> : null}
        </button>
        <a className="cf-hbtn cf-mx" href="/architecture" target="_blank" rel="noopener" aria-label="Architecture (opens in a new tab)">
          Architecture
        </a>
        <button type="button" className="cf-hbtn cf-mx" aria-haspopup="dialog" aria-label="Apps (open the apps picker)" onClick={() => onOpen({ button: "appsBtn", label: "Apps" })}>
          Apps
        </button>
        {h.usage ? (
          <button type="button" className="cf-hbtn cf-usage" title={h.usage.title} aria-label={"Plan usage: " + h.usage.title.replace(/\n/g, "; ")} onClick={() => onOpen({ button: "usageBtn", label: "Plan usage" })}>
            {h.usage.session != null ? <span className={"cf-usg" + (h.usage.session >= 90 ? " r" : "")}>5h {h.usage.session}%</span> : null}
            {h.usage.week != null ? <span className={"cf-usg" + (h.usage.week >= 90 ? " r" : "")}>wk {h.usage.week}%</span> : null}
          </button>
        ) : null}
        <button type="button" className="cf-hbtn cf-msg" aria-haspopup="dialog" aria-label={unread ? "Message master, " + unread + " unread repl" + (unread === 1 ? "y" : "ies") : "Message master"} onClick={() => onOpen({ button: "msgBtn", label: "Message master" })}>
          <span className="cf-bl">Message master</span>
          {unread ? <span className="cf-msgn">{unread}</span> : null}
        </button>
        <button type="button" className="cf-hbtn cf-push" aria-haspopup="dialog" title={h.push ? h.push.title : "Push to remote: checking"} aria-label={h.push ? h.push.title : "Push to remote: checking"} onClick={() => onOpen({ button: "pushBtn", label: "Push to remote" })}>
          <span className="cf-bl">Push to remote</span>
          {h.push && h.push.ahead ? <span className="cf-msgn cf-pushn">{h.push.ahead}</span> : null}
        </button>
        <span className="cf-upd" key={h.at}>
          <i className="cf-sdot t-g" />
          updated {upd}
        </span>
      </div>
    </header>
  );
}
