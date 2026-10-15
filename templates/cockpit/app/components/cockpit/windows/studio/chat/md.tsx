/**
 * FA-19172: the legacy studio's SAFE MARKDOWN (card-studio.js md()), rendered as React elements rather than an HTML string, so no
 * text an agent wrote can ever become markup: only the elements built here exist, links are http(s) only and open in a new tab.
 * The grammar is the legacy one, line for line: ``` fences, # headings (shifted to h4..h6), --- rules, | tables |, > quotes,
 * - / 1. lists (with indented continuation lines), paragraphs (lines joined by a space); inline `code`, [text](url), bare
 * urls, **strong** and *em*.
 */
import { Fragment, type ReactNode } from "react";

const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE = /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g;
const BOLD = /\*\*([^*]+)\*\*/g;
const EM = /(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g;

const a = (href: string, kids: ReactNode, k: string) => (
  <a key={k} href={href} target="_blank" rel="noopener noreferrer">
    {kids}
  </a>
);

/** **strong** then *em* over plain text */
function emph(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0,
    n = 0;
  const em = (t: string, k: string) => {
    const r: ReactNode[] = [];
    let j = 0,
      m: RegExpExecArray | null;
    EM.lastIndex = 0;
    while ((m = EM.exec(t))) {
      const pre = m.index + m[1].length;
      if (pre > j) r.push(t.slice(j, pre));
      r.push(<em key={k + "e" + m.index}>{m[2]}</em>);
      j = m.index + m[0].length;
    }
    if (j < t.length) r.push(t.slice(j));
    return r;
  };
  let m: RegExpExecArray | null;
  BOLD.lastIndex = 0;
  while ((m = BOLD.exec(s))) {
    if (m.index > i) out.push(...em(s.slice(i, m.index), key + "t" + n++));
    out.push(<strong key={key + "b" + m.index}>{m[1]}</strong>);
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(...em(s.slice(i), key + "t" + n++));
  return out;
}

/** links (markdown and bare) over text that holds no code span */
function links(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0,
    m: RegExpExecArray | null;
  const bare = (t: string, k: string) => {
    const r: ReactNode[] = [];
    let j = 0,
      x: RegExpExecArray | null;
    BARE.lastIndex = 0;
    while ((x = BARE.exec(t))) {
      const at = x.index + x[1].length;
      if (at > j) r.push(...emph(t.slice(j, at), k + "p" + j));
      r.push(a(x[2], x[2], k + "u" + at));
      j = x.index + x[0].length;
    }
    if (j < t.length) r.push(...emph(t.slice(j), k + "p" + j));
    return r;
  };
  LINK.lastIndex = 0;
  while ((m = LINK.exec(s))) {
    if (m.index > i) out.push(...bare(s.slice(i, m.index), key + "s" + i));
    out.push(a(m[2], emph(m[1], key + "l" + m.index), key + "a" + m.index));
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(...bare(s.slice(i), key + "s" + i));
  return out;
}

/** one line of inline markdown */
export function inline(s: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let i = 0,
    m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push(...links(s.slice(i, m.index), key + "x" + i));
    out.push(<code key={key + "c" + m.index}>{m[1]}</code>);
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(...links(s.slice(i), key + "x" + i));
  return out;
}

const LIST = /^\s*([-*+]|\d+[.)])\s+/;
const isBlock = (l: string) => /^```|^#{1,6}\s|^\s*>|^\s*([-*+]|\d+[.)])\s+|^\s*\|.*\|\s*$/.test(l);

/** a markdown text as React blocks */
export function md(src: unknown, key = "m"): ReactNode[] {
  const L = String(src || "")
    .replace(/\r/g, "")
    .split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i],
      k = key + i;
    let m: RegExpExecArray | null;
    if (/^```/.test(l)) {
      const b: string[] = [];
      i++;
      while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]);
      i++;
      out.push(
        <pre key={k}>
          <code>{b.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
      const n = Math.min(6, m[1].length + 3),
        kids = inline(m[2].replace(/#+\s*$/, ""), k);
      out.push(n === 4 ? <h4 key={k}>{kids}</h4> : n === 5 ? <h5 key={k}>{kids}</h5> : <h6 key={k}>{kids}</h6>);
      i++;
      continue;
    }
    if (/^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/.test(l)) {
      out.push(<hr key={k} />);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(L[i + 1] || "")) {
      const cells = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(l);
      const rows: string[][] = [];
      i += 2;
      while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) rows.push(cells(L[i++]));
      out.push(
        <div className="tw" key={k}>
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c, k + "h" + j)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c, k + "r" + ri + "d" + j)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(l)) {
      const b: string[] = [];
      while (i < L.length && /^\s*>/.test(L[i])) b.push(L[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={k}>{md(b.join("\n"), k + "q")}</blockquote>);
      continue;
    }
    if ((m = LIST.exec(l))) {
      const ol = /\d/.test(m[1]);
      const items: string[] = [];
      while (i < L.length && (LIST.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && items.length))) {
        if (LIST.test(L[i])) items.push(L[i].replace(LIST, ""));
        else items[items.length - 1] += " " + L[i].trim();
        i++;
      }
      const lis = items.map((x, j) => <li key={j}>{inline(x, k + "l" + j)}</li>);
      out.push(ol ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const p = [l];
    i++;
    while (i < L.length && L[i].trim() && !isBlock(L[i])) p.push(L[i++]);
    out.push(<p key={k}>{inline(p.join(" "), k)}</p>);
  }
  return out;
}

/** <Md text={...} className="sc-md" /> */
export function Md({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{md(text).map((n, i) => <Fragment key={i}>{n}</Fragment>)}</div>;
}
