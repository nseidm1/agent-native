/**
 * FA-19175: what the studio's drawers and tile details share: the legacy studio's safe markdown (card-studio.js md), its words
 * (ago with "ago" dropped as the Details jobs say it, when, fmt), the app's studio view (app '' - the record, its jobs, questions,
 * staging changes, readiness; legacy S.v), and one busy/error pattern for a write (legacy act(): the button busy, the error next to
 * it, flashed for 8 s; the fresh view re-read on success).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { READ_ONLY } from "../../../CardDialog";
import { errText, useStudio, useStudioRead } from "../api";

export { READ_ONLY };

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
/** card-studio.js md(): everything escaped first; only the tags built here exist; links are http(s) only and open in a new tab. */
export function md(src: unknown): string {
  const L = String(src || "")
    .replace(/\r/g, "")
    .split("\n");
  let out = "",
    i = 0;
  const inl = (s0: string) => {
    const codes: string[] = [];
    let s = esc(s0).replace(/`([^`]+)`/g, (_m, c) => {
      codes.push(c);
      return "\u0001" + (codes.length - 1) + "\u0001";
    });
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_m, t, u) =>
        '<a href="' +
        u +
        '" target="_blank" rel="noopener noreferrer">' +
        t +
        "</a>",
    );
    s = s.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g,
      (_m, p, u) =>
        p +
        '<a href="' +
        u +
        '" target="_blank" rel="noopener noreferrer">' +
        u +
        "</a>",
    );
    s = s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
    return s.replace(
      /\u0001(\d+)\u0001/g,
      (_m, n) => "<code>" + codes[Number(n)] + "</code>",
    );
  };
  const isBlock = (l: string) =>
    /^```|^#{1,6}\s|^\s*>|^\s*([-*+]|\d+[.)])\s+|^\s*\|.*\|\s*$/.test(l);
  while (i < L.length) {
    const l = L[i];
    let m: RegExpExecArray | null;
    if (/^```/.test(l)) {
      const b: string[] = [];
      i++;
      while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]);
      i++;
      out += "<pre><code>" + esc(b.join("\n")) + "</code></pre>";
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const n = Math.min(6, m[1].length + 3);
      out += "<h" + n + ">" + inl(m[2].replace(/#+\s*$/, "")) + "</h" + n + ">";
      i++;
      continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(l)) {
      out += "<hr>";
      i++;
      continue;
    }
    if (
      /^\s*\|.*\|\s*$/.test(l) &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(L[i + 1] || "")
    ) {
      const cells = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => inl(c.trim()));
      let t =
        '<div class="tw"><table><thead><tr>' +
        cells(l)
          .map((c) => "<th>" + c + "</th>")
          .join("") +
        "</tr></thead><tbody>";
      i += 2;
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i]))
        t +=
          "<tr>" +
          cells(L[i++])
            .map((c) => "<td>" + c + "</td>")
            .join("") +
          "</tr>";
      out += t + "</tbody></table></div>";
      continue;
    }
    if (/^\s*>/.test(l)) {
      const b: string[] = [];
      while (i < L.length && /^\s*>/.test(L[i]))
        b.push(L[i++].replace(/^\s*>\s?/, ""));
      out += "<blockquote>" + md(b.join("\n")) + "</blockquote>";
      continue;
    }
    if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(l))) {
      const ol = /\d/.test(m[1]);
      const items: string[] = [];
      while (
        i < L.length &&
        (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]) ||
          (/^\s{2,}\S/.test(L[i]) && items.length))
      ) {
        if (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]))
          items.push(L[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += " " + L[i].trim();
        i++;
      }
      out +=
        (ol ? "<ol>" : "<ul>") +
        items.map((x) => "<li>" + inl(x) + "</li>").join("") +
        (ol ? "</ol>" : "</ul>");
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const p = [l];
    i++;
    while (i < L.length && L[i].trim() && !isBlock(L[i])) p.push(L[i++]);
    out += "<p>" + inl(p.join(" ")) + "</p>";
  }
  return out;
}
export function Md({ src, className }: { src: unknown; className?: string }) {
  return (
    <div
      className={"sd-md" + (className ? " " + className : "")}
      dangerouslySetInnerHTML={{ __html: md(src) }}
    />
  );
}

/** The Details drawer's own clock words (card-studio.js ago: "45 s", "3 min", "1.5 h", "7 d"). */
export const agoShort = (t: unknown) => {
  const s = Math.max(0, (Date.now() - Date.parse(String(t || ""))) / 1000);
  return s < 60
    ? Math.round(s) + " s"
    : s < 3600
      ? Math.round(s / 60) + " min"
      : s < 86400
        ? (s / 3600).toFixed(1) + " h"
        : Math.round(s / 86400) + " d";
};
/** card-studio.js dur (the jobs' wall time: "46 s", "2 min 05 s"). */
export const durShort = (ms: unknown) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  return s < 60
    ? s + " s"
    : Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
};
/** studio-lifecycle.js fmt: a KPI / target value with its unit. */
export const fmt = (v: unknown, unit?: string | null) =>
  v === null || v === undefined || v === ""
    ? "–"
    : (unit === "$" ? "$" : "") +
      (Math.abs(Number(v)) >= 1000
        ? Math.round(Number(v)).toLocaleString()
        : Math.round(Number(v) * 100) / 100) +
      (unit && unit !== "$" ? (unit === "%" ? "%" : " " + unit) : "");

/**
 * Moves focus into a drawer once it has mounted (the sheet focuses its first control on open, which can be a write such as
 * Undo or Ask me Questions): the first selector that matches, retried while the portal mounts.
 */
export function focusSoon(sels: string[]) {
  let n = 0;
  const tick = () => {
    for (const s of sels) {
      const el = document.querySelector<HTMLElement>(s);
      if (el) {
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
      }
    }
    if (++n < 8) setTimeout(tick, 60);
  };
  setTimeout(tick, 30);
}

/** Gives focus back to the control that opened a drawer once it closes (legacy drawer(false) focuses Details). */
export function useReturnFocus(on: boolean, sel: string) {
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !on)
      setTimeout(() => {
        const b = document.querySelector<HTMLElement>(sel);
        if (
          b &&
          (!document.activeElement || document.activeElement === document.body)
        )
          b.focus();
      }, 0);
    was.current = on;
  }, [on, sel]);
}

export const Spin = () => <i className="ap-spin sd-spin" aria-hidden="true" />;

/**
 * The app's studio view (GET app ''): legacy S.v. Read once when the studio opens (so a drawer opens on it), re-read while a drawer
 * is open (live), faster while a job or a staging change runs.
 */
export function useAppView(live = true) {
  const st = useStudio();
  const [fast, setFast] = useState(false);
  const q = useStudioRead<any>(st.app, "app", "", {
    every: live ? (fast ? 3000 : 8000) : 0,
  });
  const v = q.data;
  useEffect(() => {
    const hot = Boolean(
      v &&
      ((v.running || 0) > 0 || (v.staging && (v.staging.running || 0) > 0)),
    );
    if (hot !== fast) setFast(hot);
  }, [v, fast]);
  return q;
}

/**
 * card-studio.js act(): one write at a time per key, its button busy, its error next to it (flashed: it clears itself after 8 s or
 * on a tap), and on success the studio view re-read. run(key, fn) -> the write's answer or null.
 */
export function useActs(onDone?: () => void) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const busyRef = useRef<Record<string, boolean>>({});
  const flash = useCallback((key: string, msg: string) => {
    setErr((e) => ({ ...e, [key]: msg }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(
      () => setErr((e) => (e[key] === msg ? { ...e, [key]: "" } : e)),
      8000,
    );
  }, []);
  useEffect(
    () => () => Object.values(timers.current).forEach(clearTimeout),
    [],
  );
  const run = useCallback(
    async <T,>(
      key: string,
      fn: () => Promise<T>,
      errKey = key,
    ): Promise<T | null> => {
      if (busyRef.current[key]) return null;
      busyRef.current[key] = true;
      setBusy((b) => ({ ...b, [key]: true }));
      setErr((e) => ({ ...e, [errKey]: "" }));
      try {
        const r = await fn();
        if (onDone) onDone();
        return r;
      } catch (e) {
        flash(errKey, errText(e));
        return null;
      } finally {
        busyRef.current[key] = false;
        setBusy((b) => ({ ...b, [key]: false }));
      }
    },
    [flash, onDone],
  );
  const clear = useCallback(
    (key: string) => setErr((e) => ({ ...e, [key]: "" })),
    [],
  );
  return { busy, err, run, flash, clear };
}

/** An error line next to its control (role=alert); a tap dismisses it. */
export function ErrLine({
  text,
  onClear,
  k,
}: {
  text?: string;
  onClear?: () => void;
  k?: string;
}) {
  return (
    <div
      className="sd-err"
      role="alert"
      data-k={k}
      title={text ? "Tap to dismiss" : undefined}
      onClick={onClear}
    >
      {text || ""}
    </div>
  );
}

/** A write button: disabled with READ_ONLY on a viewer that cannot write; busy with a spinner while its write runs. */
export function WBtn({
  can,
  busy,
  onClick,
  children,
  className = "cp-btn sm",
  title,
  disabled,
  k,
  label,
  pressed,
  type = "button",
}: {
  can: boolean;
  busy?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string | null;
  disabled?: boolean;
  k?: string;
  label?: string;
  pressed?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={className}
      data-k={k}
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-busy={busy || undefined}
      disabled={!can || busy || disabled}
      title={!can ? READ_ONLY : title || undefined}
      onClick={onClick}
    >
      {busy ? <Spin /> : null}
      {children}
    </button>
  );
}

/** card-studio.js JOB_WORD / JOB_TONE (the agent jobs' states). */
export const JOB_WORD: Record<string, string> = {
  queued: "Queued",
  working: "Working",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};
export const JOB_TONE: Record<string, string> = {
  queued: "t-s",
  working: "t-s",
  done: "t-g",
  failed: "t-r",
  stopped: "t-d",
};
export const ACTIVE = (j: any) => j && ["queued", "working"].includes(j.status);
/** card-studio.js SECTIONS: the feature brief's nine sections. */
export const SECTIONS: [string, string, string][] = [
  [
    "problem",
    "Problem and goal",
    "What is wrong or missing today, and what is true when this ships.",
  ],
  [
    "users",
    "Who it is for",
    "The people (or agents) it serves and the job they are trying to get done.",
  ],
  ["stories", "User stories", "As a ..., I want ..., so that ..."],
  [
    "scope",
    "Scope - in / out",
    "In: what this card delivers. Out: what it explicitly does not.",
  ],
  [
    "acceptance",
    "Acceptance criteria",
    "Given ..., when ..., then ... (each one testable by the lane's judge).",
  ],
  [
    "metrics",
    "Success metrics",
    "The numbers that say it worked, with a target.",
  ],
  [
    "design",
    "Design notes",
    "Layout, states (empty, loading, error, success), accessibility, phone and wide.",
  ],
  [
    "risks",
    "Risks and open questions",
    "What could go wrong and what is still undecided.",
  ],
  [
    "deps",
    "Dependencies",
    'Other cards, files, services or decisions this needs first ("None" is an answer).',
  ],
];
