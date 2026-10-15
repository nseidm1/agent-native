/**
 * FA-19132: JEV + JevGrep savings, ported from the legacy renderJev (tools/lane/maint/ui/index.html, with jevCard,
 * jevReplay, jevTable and jevBuildCard): the Claude-spend KPI JEV shares with the Halo, today's saving and why, the
 * breakdown today and over 7 days, live vs replay per workload and per day, the saving per day, why JevGrep gave no
 * leads, its lead effect by card class, where JEV could be used (today and 7 days) and the library assimilation build
 * state. Reads the client's jevsavings, jevbuild, home (saveForecast, savedAll) and syskpis. No writes.
 */
import type { DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import type { Tone } from "../../../shared/cockpit.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { getMany } from "../client.js";
import type { WindowBuilder } from "./registry.js";
import { $2, cell, claudeSection, hm, type J, md, n0, pairBars, pl, row, savedChip, savedPct, table, text } from "./savings-common.js";

const NO_SAVINGS = "Savings data not available yet";

/** jevTable: the per-workload table (workloadTable) - each row live + counterfactual, backfilled, or "no history before X" */
export function jevTable(s: J): { head: string; rows: string[][] } {
  const T = s && s.workloadTable,
    d = (x: J) => (x == null ? "n/a" : "$" + (Math.abs(x) > 0 && Math.abs(x) < 0.01 ? x.toFixed(4) : x.toFixed(2)));
  if (!T || !Array.isArray(T.rows)) return { head: "", rows: [] };
  const h = T.headline || {},
    rc = T.replayCost || {};
  const head =
    "Going forward: " + d(h.liveUsdPerDay) + "/day saved live (" + (h.liveDays || 7) + " days; estimates vs the incumbent) · replay-implied " + (h.replayUsdPerDay == null ? "n/a" : d(h.replayUsdPerDay)) +
    "/day if every calibrated workload were active" + (h.replayWorkloads && h.replayWorkloads.length ? " (" + h.replayWorkloads.join(", ") + ")" : "") + " · the replay's own JEV cost " + d(rc.usd) + " for " +
    (rc.judgments || 0) + " judgments · live and replay are never added";
  const rows = T.rows.map((r: J) => [
    r.workload,
    r.liveSay,
    r.replaySay,
    r.accuracy == null ? "n/a" : (100 * r.accuracy).toFixed(1) + "%",
    r.tau == null ? "n/a" : String(r.tau),
    r.n == null ? "n/a" : String(r.n),
    r.calibrated
      ? "calibrated" + (r.calibratedAt ? " " + String(r.calibratedAt).slice(5, 16).replace("T", " ") : "") + (r.calibration === "thin" ? " (thin, < 50 labels)" : "")
      : r.calibration === "refused" ? "refused (< 30 labels)" : r.calibration === "thin" ? "not calibrated (thin, < 50 labels)" : r.calibration ? "not calibrated (" + r.n + " labels)" : "no labels on record",
    r.historySay,
  ]);
  return { head, rows };
}

type Day = { day: string; live: number | null; replay: number | null; insufficient: number };
/** jevReplay: live and replay kept apart, per day and per workload; nothing adds one to the other */
export function jevReplay(s: J) {
  const dk = (x: J): string => {
    if (!x) return "";
    if (/^\d{4}-\d\d-\d\d$/.test(x)) return x;
    const d = new Date(x);
    return isNaN(+d) ? String(x) : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const sv = (r: J): number | null => (r.insufficient ? null : r.usdSaved ?? r.usdAvoided ?? null),
    add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
  const ser = (s && s.series) || {},
    rows: J[] = s && Array.isArray(s.rows) ? s.rows : [];
  const pick = (src: string): J[] => [...(Array.isArray(ser[src]) ? ser[src] : []), ...rows.filter((r) => r && r.source === src)];
  const live = pick("live"),
    replay = pick("replay"),
    meta: Record<string, J> = {},
    W: Record<string, J> = {},
    D: Record<string, Day> = {};
  const wm = s && s.workloads;
  for (const w of Array.isArray(wm) ? wm : Object.entries(wm || {}).map(([k, v]: [string, J]) => ({ workload: k, ...v }))) if (w && w.workload) meta[w.workload] = w;
  const wl = (k: string) => (W[k] ||= { workload: k, liveUsd: null, replayUsd: null, n: 0, accN: 0, accW: 0, tau: null, insufficient: [] });
  const dy = (k: string) => (D[k] ||= { day: k, live: null, replay: null, insufficient: 0 });
  for (const r of live) {
    const w = wl(r.workload || "?");
    w.liveUsd = add(w.liveUsd, sv(r));
  }
  for (const r of replay) {
    const w = wl(r.workload || "?"),
      d = dy(dk(r.date || r.day)),
      v = sv(r);
    w.n += r.n ?? r.items ?? 0;
    if (r.tau != null) w.tau = String(r.tau);
    if (r.insufficient || v == null) {
      d.insufficient++;
      w.insufficient.push({ day: d.day, n: r.n ?? r.items ?? 0 });
      continue;
    }
    w.replayUsd = add(w.replayUsd, v);
    d.replay = add(d.replay, v);
    if (r.accuracy != null) {
      const k = r.n ?? r.items ?? 1;
      w.accN += k;
      w.accW += r.accuracy * k;
    }
  }
  for (const x of (s && s.days) || []) {
    const d = dy(dk(x.day));
    d.live = x.usdSaved ?? null;
  }
  const workloads = Object.values(W)
    .map((w: J) => {
      const m = meta[w.workload] || {},
        ta = m.tau ?? m.tau_accept;
      return {
        workload: w.workload as string,
        liveUsd: w.liveUsd as number | null,
        replayUsd: w.replayUsd as number | null,
        accuracy: (m.accuracy ?? (w.accN ? w.accW / w.accN : null)) as number | null,
        tau: (ta != null ? String(ta) + (m.tau_reject != null ? " / " + m.tau_reject : "") : w.tau) as string | null,
        n: (m.n ?? (w.n || null)) as number | null,
        calibratedAt: (m.calibratedAt || null) as string | null,
        insufficient: w.insufficient as { day: string; n: number }[],
      };
    })
    .sort((a, b) => (b.replayUsd ?? -1) - (a.replayUsd ?? -1));
  const rc = (s && (s.replayCost ?? (s.replay && s.replay.cost))) ?? null,
    rowCost = replay.reduce((a: number | null, r: J) => add(a, r.costUsd ?? null), null);
  const cost: { usd: number | null; judgments: number | null } | null =
    rc == null ? (rowCost == null ? null : { usd: rowCost, judgments: null }) : typeof rc === "number" ? { usd: rc, judgments: null } : { usd: rc.usd ?? null, judgments: rc.judgments ?? null };
  const rdays = new Set(replay.map((r) => dk(r.date || r.day))),
    sum = (k: string) => Object.values(W).reduce((a: number | null, w: J) => add(a, w[k]), null);
  return {
    has: replay.length > 0,
    nDays: rdays.size,
    liveUsd: sum("liveUsd"),
    replayUsd: replay.length ? sum("replayUsd") ?? 0 : null,
    days: Object.values(D).sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-14),
    workloads,
    cost,
  };
}

/** jevCard: today's headline, why, the JEV and JevGrep lines, the levers and the replay line */
export function jevCard(s: J) {
  const d2 = (x: J) => "$" + Number(x || 0).toFixed(2),
    t = s && s.today,
    v = t && t.jev,
    g = t && t.jevgrep;
  if (!v || !g)
    return {
      val: NO_SAVINGS,
      head: NO_SAVINGS,
      why: "the jevsavings resource " + (s && s.error ? "answered: " + s.error : "does not answer yet"),
      jev: "JEV · no data",
      jg: "JevGrep · no data",
      tone: "d" as Tone,
      rp: "replay not backfilled yet",
      lv: "",
    };
  const ran = g.real ?? Math.max(0, (g.runs || 0) - (g.skipped || 0)),
    hit = ran ? Math.round((100 * (g.withFiles || 0)) / ran) + "%" : "n/a";
  const jev = "JEV · " + pl(v.lifts, "lift") + " · " + d2(v.usdAvoided) + " avoided";
  const jg = "JevGrep · " + (g.withFiles || 0) + "/" + ran + " runs gave leads · " + hit + " hit · " + (g.usdSaved == null ? "$ not measured" : d2(g.usdSaved) + " saved");
  const why = [
    v.verdicts ? "JEV: " + v.lifts + " of " + pl(v.verdicts, "verdict") + " lifted today" : "JEV: 0 verdicts today" + (s.jevState && s.jevState.runsInLane === false ? " (it does not run in the maintenance lane)" : ""),
    g.usdSaved == null ? "JevGrep: " + ((s.leadEffect && s.leadEffect.confidence) || t.usdWhy || "not measured") : "JevGrep: " + d2(g.usdSaved) + " over " + pl(g.leadFedSessions, "lead-fed session"),
  ].join(" · ");
  const m = jevReplay(s),
    measured = (t.usdSaved || 0) > 0 || g.usdSaved != null || (v.verdicts || 0) > 0;
  const rp = m.has ? "would have saved " + d2(m.replayUsd) + " (replay, " + m.nDays + " day" + (m.nDays === 1 ? "" : "s") + ")" : "replay not backfilled yet";
  const L = s.levers,
    tr = L && L.tier,
    pj = L && L.projection,
    live = L ? (L.points || []).filter((p: J) => p.state === "live").length : 0,
    jgL = L && L.jevgrep;
  const lv =
    !L || !tr || !pj
      ? ""
      : [
          "Tier: " + pl(tr.moves, "run") + " off Opus today ~" + d2((tr.verifiedUsd || 0) + (tr.unverifiedUsd || 0)) + " (trial " + ((tr.trial || {}).n ?? 0) + " / JEV " + ((tr.jev || {}).n ?? 0) + " / policy " +
            ((tr.policy || {}).n ?? 0) + (tr.unverifiedUsd ? "; " + d2(tr.unverifiedUsd) + " unverified" : "") + ")",
          "Points: " + live + "/" + (L.points || []).length + " live",
          jgL && jgL.usdSaved != null ? "JevGrep " + d2(jgL.usdSaved) + " vs own no-lead runs" : null,
          "Projected " + d2(pj.projected) + "/day (" + d2(pj.ifTierHolds) + " if tier holds)",
        ]
          .filter(Boolean)
          .join(" · ");
  if (!measured) return { val: "no measured saving yet", head: "No measured saving yet today", why, jev, jg, tone: "a" as Tone, rp, lv };
  return {
    val: d2(t.usdSaved),
    head: "JEV + JevGrep saved " + d2(t.usdSaved) + " today" + (g.usdSaved == null ? " (JEV alone; JevGrep not measured)" : ""),
    why,
    jev,
    jg,
    tone: (t.usdSaved > 0 ? "g" : "a") as Tone,
    rp,
    lv,
  };
}

const BUILD_TONE: Record<string, Tone | undefined> = { measured: "g", landed: "a", building: "a", queued: undefined, rejected: "r" };
/** jevBuildCard: one row per assimilate entry in the view's order; a state only as the view says it */
export function jevBuildCard(b: J) {
  if (!b || b.error || !Array.isArray(b.rows)) return { head: "Build state not available", why: (b && b.error) || "the jevbuild resource did not answer", rows: [] as J[] };
  return {
    head: String(b.line ?? ""),
    why: b.ageMin != null ? "synced " + b.ageMin + " min ago" : "",
    rows: b.rows.map((r: J) => ({
      repo: r.repo,
      lever: r.lever,
      state: String(r.state ?? ""),
      tone: BUILD_TONE[r.state],
      units: (r.units || []).map((u: J) => u.id + " " + u.state + (u.sha ? " " + u.sha : "")).join(" / "),
      note: (r.units || []).map((u: J) => u.effect || u.why || u.predicted || "").filter(Boolean).join(" / "),
    })),
  };
}

const FAIL: [string, string][] = [
  ["noChangeLine", "Skipped: the card has no CHANGE line"],
  ["empty", "Ran, 0 files"],
  ["timedOut", "Timed out at the cap, 0 files"],
  ["timedOutWithFiles", "Timed out, partial leads kept"],
  ["late", "Leads written after the pod started"],
  ["neverAsked", "Never asked (direct-edit fixer)"],
];

/** The pure half: the client's jevsavings, jevbuild, home and syskpis data -> the window (exported for its spec). */
export function jevWindow(s: J, b: J, h0: J, sys: J, at: number, ok: boolean, error?: string): WindowDetail {
  const c = jevCard(s),
    t = s && s.today,
    w = s && s.week,
    F = h0 && h0.saveForecast;
  const sp = savedPct(h0, "jev");
  const face = [c.jev + (sp ? " · " + (c.val === "no measured saving yet" ? "no $ yet" : c.val + " today") : ""), c.jg, c.lv].filter(Boolean).join(" · ");
  const sections: DetailSection[] = [claudeSection(sys, "jev", F)];

  // the key tile's per-day pairs: the live saving and, beside it, what JEV would have saved had it been online (the forecast's replay; never added)
  const m = jevReplay(s);
  const tdays: { day: string; live: number | null; replay: number | null }[] = m.has ? m.days : ((s && s.days) || []).map((x: J) => ({ day: x.day, live: x.usdSaved ?? null, replay: null }));
  const fday = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : (() => { const d = new Date(x); return isNaN(+d) ? "" : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })());
  const fc = new Map<string, number>(((F && F.days) || []).map((d: J) => [d.day, d.jev && d.jev.usd]));
  const useFc = F && F.total && tdays.some((x) => fc.get(fday(x.day)) != null);
  const pairs = tdays.slice(-7).map((x) => ({ label: md(/^\d{4}-\d{2}-\d{2}$/.test(x.day) ? x.day + "T12:00:00" : x.day), live: x.live, other: useFc ? fc.get(fday(x.day)) ?? null : x.replay }));
  if (pairs.length) sections.push(pairBars("Saved per day · live and if online", pairs, ["live", "if online"], (x) => (x == null ? "n/a" : $2(x)), "live: what JEV + JevGrep saved · if online: what the replay says JEV would have saved that day - never added to the live figure"));

  if (!t || !w) {
    const none = (title: string, columns: string[]) => table(title, columns, [], { empty: NO_SAVINGS });
    sections.push(
      none("Breakdown", ["", "Today", "7 days"]),
      none("Live vs replay per workload", ["Workload", "Live $ (ran, 7 days)", "Replay $ (would have)", "Accuracy vs outcomes", "tau", "n labels", "Calibration"]),
      none("Live vs replay per day", ["Day", "Live $ (ran)", "Replay $ (would have)", "Workloads with insufficient labels"]),
      none("Saved per day · 7 days", ["Day (local midnight)", "Saved", "JEV", "JevGrep", "JevGrep runs", "Lifts"]),
      none("Why JevGrep gave no leads", ["Reason", "Today", "7 days", "Note"]),
      none("JevGrep lead effect by card class", ["Class", "With leads", "Without", "Matched", "$ saved / session"]),
      none("Opportunities · today", ["Where", "Uses today", "Volume", "Potential $"]),
    );
  } else {
    const sec = (ms: J) => (ms == null ? "n/a" : Math.round(ms / 1000) + " s");
    const ran = (g: J) => g.real ?? Math.max(0, (g.runs || 0) - (g.skipped || 0)),
      hit = (g: J) => (ran(g) ? Math.round((100 * (g.withFiles || 0)) / ran(g)) + "%" : "n/a");
    const R: [string, (x: J) => string][] = [
      ["Saved in total (measured)", (x) => $2(x.usdSaved)],
      ["JEV verdicts", (x) => n0(x.jev.verdicts)],
      ["JEV lifts", (x) => n0(x.jev.lifts)],
      ["JEV escalations", (x) => n0(x.jev.escalations)],
      ["JEV holds", (x) => n0(x.jev.holds)],
      ["JEV refused", (x) => n0(x.jev.refused)],
      ["Review sessions avoided", (x) => n0(x.jev.sessionsAvoided)],
      ["JEV $ avoided", (x) => $2(x.jev.usdAvoided)],
      ["JEV minutes saved", (x) => n0(x.jev.minutesSaved)],
      ["JevGrep runs asked", (x) => n0(x.jevgrep.runs)],
      ["JevGrep runs that ran", (x) => n0(ran(x.jevgrep))],
      ["JevGrep runs that gave leads", (x) => n0(x.jevgrep.withFiles)],
      ["JevGrep hit rate (gave leads / ran)", (x) => hit(x.jevgrep)],
      ["JevGrep time p50 / p95", (x) => sec(x.jevgrep.p50ms) + " / " + sec(x.jevgrep.p95ms)],
      ["JevGrep cost (wall minutes on the " + ((t.jevgrep.cost || {}).host || "Mac") + ")", (x) => n0((x.jevgrep.cost || {}).wallMin) + " min" + ((x.jevgrep.cost || {}).usd == null ? "" : " · " + $2(x.jevgrep.cost.usd))],
      ["Lead-fed drafter sessions", (x) => n0(x.jevgrep.leadFedSessions)],
      ["JevGrep $ saved", (x) => (x.jevgrep.usdSaved == null ? "not measured" : $2(x.jevgrep.usdSaved))],
    ];
    sections.push(table("Breakdown", ["", "Today", "7 days"], R.map(([k, f]) => row([k, f(t), f(w)])), { numeric: [1, 2], sub: "Today · since local midnight, and 7 days · since local midnight 6 days ago" }));
    const p = s.price || {},
      le = s.leadEffect || {},
      js = s.jevState || {};
    sections.push(
      text(
        "How it is priced",
        "Price of a review session " + $2(p.sessionUsd) + " (mean of " + n0(p.n) + " sessions, " + n0(p.sessionsPerRound) + " per round) · JevGrep cost: " + ((t.jevgrep.cost || {}).usdWhy || "metered") +
          " · JEV in the lane: " + (js.runsInLane ? "yes" : "no") + (js.why ? " (" + js.why + ")" : "") + (js.verdictsOnRecord != null ? " · on record: " + js.verdictsOnRecord + " verdicts, " + js.liftsOnRecord + " lifts" : ""),
      ),
    );

    // live vs replay per workload: the workload table, else the replay's own per-workload sums
    const ac = (x: J) => (x == null ? "n/a" : (100 * x).toFixed(1) + "%");
    const tb = jevTable(s);
    const wlRows: DetailRow[] = tb.rows.length
      ? tb.rows.map((r) =>
          row(
            r.slice(0, 7).map((c0, i) => {
              const full = String(c0),
                short = full.split(" · ")[0];
              return cell(short + (short !== full ? " …" : ""), { ...(i >= 6 ? { tone: "d" as Tone } : {}), ...(short !== full ? { title: full } : {}) });
            }),
            // the history, in full on the row's second line (the legacy cell showed its first clause and kept the rest in a hover)
            { note: "History: " + String(r[7]) },
          ),
        )
      : m.workloads.map((x) =>
          row([
            x.workload,
            x.liveUsd == null ? "none" : $2(x.liveUsd),
            x.replayUsd == null ? (x.insufficient.length ? "insufficient labels" : "not replayed") : $2(x.replayUsd),
            ac(x.accuracy),
            x.tau ?? "n/a",
            n0(x.n),
            x.calibratedAt ? md(x.calibratedAt) + " " + hm(x.calibratedAt) : "not calibrated",
          ], { note: "History: " + (x.insufficient.length ? x.insufficient.map((d) => md(d.day + "T12:00:00") + " (n " + d.n + ")").join(", ") : "none") }),
        );
    sections.push(
      table("Live vs replay per workload", ["Workload", "Live $ (ran, 7 days)", "Replay $ (would have)", "Accuracy vs outcomes", "tau", "n labels", "Calibration"], wlRows, {
        numeric: [3, 5],
        sub: "live: JEV decisions that ran · replay: the calibrated workload replayed over history (what JEV would have saved) · never added together",
        empty: "No workload rows yet: replay not backfilled yet, and no live JEV decision with a saving",
      }),
    );
    if (tb.head) sections.push(text("Going forward", tb.head));
    sections.push(
      text(
        "Replay",
        m.has
          ? "Replay: " + c.rp + " · the replay's own cost " + (m.cost && m.cost.usd != null ? "$" + m.cost.usd.toFixed(4) + (m.cost.judgments != null ? " for " + m.cost.judgments + " judgments" : "") : "not reported") +
              " · live (ran) over the same rows: " + (m.liveUsd == null ? "none" : $2(m.liveUsd)) + " - the two are never added together"
          : "Replay not backfilled yet: the jevsavings resource has no replay rows (series.replay) - the calibrated workloads are replayed over history once each is integrated and calibrated",
      ),
    );
    sections.push(
      table(
        "Live vs replay per day",
        ["Day", "Live $ (ran)", "Replay $ (would have)", "Workloads with insufficient labels"],
        m.has ? m.days.slice().reverse().map((x) => row([md(x.day + "T12:00:00"), x.live == null ? "none" : $2(x.live), x.replay == null ? (x.insufficient ? "insufficient labels" : "none") : $2(x.replay), n0(x.insufficient)])) : [],
        { numeric: [1, 2, 3], empty: "replay not backfilled yet" },
      ),
    );
    sections.push(
      table(
        "Saved per day · 7 days",
        ["Day (local midnight)", "Saved", "JEV", "JevGrep", "JevGrep runs", "Lifts"],
        ((s.days || []) as J[]).slice().reverse().map((x) => row([md(x.day), $2(x.usdSaved), $2(x.jevUsd), x.jgUsd == null ? "not measured" : $2(x.jgUsd), n0(x.jgRuns), n0(x.lifts)])),
        { numeric: [1, 2, 3, 4, 5] },
      ),
    );
    const ft = (s.failures || {}).today || {},
      fw = (s.failures || {}).week || {},
      notes = { ...(fw.notes || {}), ...(ft.notes || {}) };
    sections.push(table("Why JevGrep gave no leads", ["Reason", "Today", "7 days", "Note"], FAIL.map(([k, l]) => row([l, n0(ft[k]), n0(fw[k]), cell(notes[k] || "", { tone: "d" })])), { numeric: [1, 2] }));
    sections.push(
      table(
        "JevGrep lead effect by card class",
        ["Class", "With leads", "Without", "Matched", "$ saved / session"],
        ((le.classes || []) as J[]).map((x) => row([String(x.cls), String(x.nLeads), String(x.nNone), x.matched ? "yes" : "no (need " + n0(le.minN) + " each side)", x.saved && x.saved.usd != null ? $2(x.saved.usd) : "n/a"])),
        {
          numeric: [1, 2, 3, 4],
          sub: "· 7 days · " + n0(le.withLeads) + " of " + n0(le.sessions) + " first drafter sessions had leads at pod start, " + n0(le.late) + " late · " +
            (le.perSession == null ? le.confidence || "not measured" : $2(le.perSession) + " per session (" + (le.confidence || "") + ")"),
        },
      ),
    );
    for (const [win, label] of [["today", "today"], ["week", "7 days"]] as const) {
      const op = (((s.opportunities || {})[win] || []) as J[]).slice().sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
      sections.push(
        table(
          "Opportunities · " + label,
          ["Where", "Uses today", "Volume", "Potential $"],
          op.map((x) => row([String(x.where), cell(x.uses || "", { tone: "d" }), n0(x.n), cell((x.usd == null ? "not metered" : $2(x.usd)) + (x.usdWhy ? " ⓘ" : ""), x.usdWhy ? { title: String(x.usdWhy) } : {})])),
          {
            numeric: [2, 3],
            empty: "none listed for this window",
            sub: "where JEV and JevGrep could be used · Potential $ is what that work cost in the window (an upper bound on what JEV or JevGrep could save there), not a saving.",
            collapsed: win === "week",
          },
        ),
      );
    }
  }
  const bc = jevBuildCard(b);
  sections.push(
    table(
      "Library assimilation · build state",
      ["State", "Idea (library)", "Lever", "Build units", "Measured effect · prediction · why"],
      bc.rows.map((r: J) => row([cell(r.state, r.tone ? { tone: r.tone } : {}), String(r.repo ?? ""), String(r.lever ?? ""), cell(r.units, { tone: "d" }), cell(r.note, { tone: "d" })], r.tone ? { tone: r.tone } : {})),
      { sub: bc.head + (bc.why ? " · " + bc.why : ""), empty: bc.why || "none", collapsed: true },
    ),
  );

  // a gap in the client, said rather than hidden: it cuts each string at 400 characters, and a few units' why run longer
  const cut = ((b && Array.isArray(b.rows) ? b.rows : []) as J[]).flatMap((r) => (r.units || []) as J[]).filter((u) => ["why", "effect", "predicted"].some((k) => typeof u[k] === "string" && u[k].length >= 400 && u[k].endsWith("…"))).length;
  if (cut) sections.push(text("Not shown yet", cut + " build " + (cut === 1 ? "note is" : "notes are") + " cut at 400 characters by the cockpit client (jevbuild units[].why); the full text shows once the client carries it."));

  return {
    id: "jev",
    title: "JEV + JevGrep savings",
    tone: c.tone,
    headline: c.head,
    sub: c.why + (s && s.at ? " · computed " + hm(s.at) + ", window: " + (s.window || "local midnight") : ""),
    chips: savedChip(h0, "jev"),
    lead: face,
    at,
    ok,
    error,
    sections,
  };
}

const build: WindowBuilder = async () => {
  const r = await getMany(["jevsavings", "jevbuild", "home", "syskpis"]);
  const s = r.data.jevsavings || { error: r.errors.find((e) => /jevsavings/.test(e)) || "no answer" };
  const b = r.data.jevbuild || { error: r.errors.find((e) => /jevbuild/.test(e)) || "no answer" };
  return jevWindow(s, b, r.data.home || {}, r.data.syskpis || {}, r.at, r.ok, r.ok ? undefined : r.errors.join("; ").slice(0, 300));
};
export default build;
