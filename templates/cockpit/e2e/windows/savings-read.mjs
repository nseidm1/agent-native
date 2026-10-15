// FA-19132 / FA-19133: what the three savings windows' parity modules share - open a legacy section by its hash and
// read a legacy table body or an agent-native section, both as rows of " | "-joined cells.

/** Open the legacy section dialog by its hash (#jev, #halosave, #balancer) and wait until its own body is in it. */
export async function openLegacySection(lp, id, ready) {
  for (let i = 0; i < 3; i++) {
    await lp.evaluate((id) => {
      if (location.hash) history.replaceState(null, "", location.pathname);
      location.hash = "#" + id;
    }, id);
    const ok = await lp
      .waitForFunction(
        ([id, ready]) => {
          const d = document.getElementById("secDlg"), b = document.getElementById("b-" + id);
          return d && d.open && b && document.getElementById("secBody").contains(b) && (!ready || (document.getElementById(ready) || {}).textContent);
        },
        [id, ready],
        { timeout: 10_000 },
      )
      .then(() => true, () => false);
    if (ok) return;
  }
  throw new Error("the legacy " + id + " section did not open");
}

/** In the legacy page: { texts: id -> textContent, rows: id -> each tbody row as its cells' text joined by " | " }. */
export function readLegacyIds(lp, texts, tbodies, fullLast = []) {
  return lp.evaluate(([texts, tbodies, fullLast]) => {
    const o = { texts: {}, rows: {} };
    for (const id of texts) o.texts[id] = (document.getElementById(id) || {}).textContent || "";
    // fullLast: tables whose last cell keeps its full text in its title (the legacy hover)
    for (const id of tbodies)
      o.rows[id] = [...document.querySelectorAll("#" + id + " tr")].map((tr) => [...tr.children].map((td, i, a) => (fullLast.includes(id) && i === a.length - 1 && td.title ? td.title : td.textContent)).join(" | "));
    return o;
  }, [texts, tbodies, fullLast]);
}

/** Open an agent-native window from its home key tile and wait for its sections. */
export async function openNativeTile(np, tile, id) {
  await np.click(`[data-testid=cf-home] [data-tile=${tile}]`);
  await np.waitForSelector(`[data-window=${id}] .cp-sec`, { timeout: 20_000 });
}

/** In the agent-native page: every section of the window by title -> { sub, text, rows }, plus the header lines. */
export function readNativeWindow(np, id) {
  return np.evaluate((id) => {
    const w = document.querySelector(`[data-window=${id}]`);
    const out = { headline: "", sub: "", lead: "", sections: {} };
    if (!w) return out;
    const t = (sel, root = w) => { const e = root.querySelector(sel); return e ? e.textContent : ""; };
    out.headline = t(".cp-dlg-hl");
    const subEl = w.querySelector(".cp-dlg-sub");
    out.sub = subEl ? [...subEl.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("") : "";
    out.lead = t(".cp-lead");
    for (const s of w.querySelectorAll(".cp-sec")) {
      const title = t(".cp-sec-t", s);
      // a row's second line (its note) reads as one more cell
      const rows = [...s.querySelectorAll(".cp-tbl tbody tr:not(.cp-xr)")].map((tr) => {
        const cells = [...tr.children].map((td) => td.textContent), nx = tr.nextElementSibling, note = nx && nx.classList.contains("cp-xr") ? nx.querySelector(".cp-note") : null;
        return (note ? [...cells, note.textContent] : cells).join(" | ");
      });
      const empty = s.querySelector(".cp-empty");
      out.sections[title] = {
        sub: t(".cp-sec-s", s),
        text: t(".cp-text", s),
        rows: rows.length ? rows : empty ? [empty.textContent] : [],
        bars: [...s.querySelectorAll(".cp-bars li")].length,
      };
    }
    return out;
  }, id);
}

/**
 * Differences between two records of strings and string arrays, case- and space-blind; an array names its first
 * differing row (or the count). "synced N min ago" may differ by a minute or two between the two reads. In a key named
 * in clipped, an agent-native row the client cut (a "…" where its text was cut) matches the legacy row it is a prefix of.
 */
export function diffSavings(L, N, { keys = Object.keys(L || {}), clipped = [] } = {}) {
  const f = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase().replace(/synced \d+ min ago/, "synced n min ago");
  const out = [];
  for (const k of keys) {
    const a = L && L[k], b = N && N[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      const x = (a || []).map(f), y = (b || []).map(f);
      const same = (v, w) => v === w || (clipped.includes(k) && typeof w === "string" && w.includes("…") && v.startsWith(w.slice(0, w.indexOf("…"))));
      const i = x.findIndex((v, j) => !same(v, y[j]));
      if (i >= 0) out.push(`${k} row ${i + 1}: legacy "${x[i].slice(0, 220)}" vs agent-native "${String(y[i] ?? "(none)").slice(0, 220)}"`);
      else if (y.length !== x.length) out.push(`${k}: legacy ${x.length} rows vs agent-native ${y.length}`);
    } else if (f(a) !== f(b)) {
      const s = f(a), t = f(b);
      let i = 0;
      while (i < s.length && s[i] === t[i]) i++;
      out.push(`${k}: legacy "…${s.slice(Math.max(0, i - 40), i + 120)}" vs agent-native "…${t.slice(Math.max(0, i - 40), i + 120)}"`);
    }
  }
  return out;
}
