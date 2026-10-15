/**
 * FA-19134: Issues, ported from the legacy issDlg (tools/lane/maint/ui/index.html) and the module that draws its list
 * (tools/lane/maint/ui/js/issues.mjs draw): every issue the system could not finish itself, in the cockpit's order, each with
 * its card, why, what was tried per tier, the refusal, the re-plan, what is queued and the last line; an open one offers
 * Retry, To <tier> and Close with a reason, each the cockpit's issues.act through cockpit-issue.
 */
import type { DetailAction, DetailItem, DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

export const TIERS = ["haiku", "sonnet", "opus", "human"];

export type Issue = {
  id: string;
  card?: string;
  kind?: string;
  state?: string;
  reason?: string | null;
  why?: string | null;
  tried?: { tier?: string; line?: string }[];
  tiers?: { tier?: string; runId?: string; line?: string }[];
  refusal?: string | null;
  replan?: string | null;
  want?: { do?: string; tier?: string } | null;
  last?: string | null;
  raisedAt?: string | null;
};
export type IssuesData = { open?: number; issues?: Issue[] };

const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
const when = (t: string | null | undefined) => {
  const d = new Date(t || "");
  return isNaN(+d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

/** The legacy draw()'s lines under the card line, in its order. */
export function issueLines(i: Issue): DetailItem[] {
  const out: DetailItem[] = [];
  if (i.why) out.push({ text: i.why });
  for (const t of i.tried || []) out.push({ strong: t.tier ? "Tried on " + t.tier : "Tried", text: t.line || "" });
  for (const t of i.tiers || []) out.push({ strong: "Tier tried", text: (t.tier || "?") + (t.runId ? " (run " + t.runId + ")" : "") + (t.line ? ": " + t.line : "") });
  if (i.refusal && i.refusal !== i.last) out.push({ text: "Refusal: " + i.refusal, tone: "a" });
  if (i.replan) out.push({ text: "Re-plan: " + i.replan });
  if (i.want && i.state === "open") out.push({ text: "Queued: " + (i.want.do === "tier" ? "to " + i.want.tier : "retry") + " (the forge starts it on its next pass)", tone: "g" });
  if (i.last) out.push({ text: "Last: " + i.last, tone: "d" });
  return out;
}

export function issueActions(i: Issue): DetailAction[] {
  const what = i.card || "this issue";
  return [
    { kind: "issue", label: "Retry", args: { id: i.id, do: "retry" }, confirm: "Retry " + what + "?" },
    { kind: "issue", label: "Move to tier", args: { id: i.id, do: "tier" }, input: { name: "tier", label: "To tier", options: TIERS, required: true }, confirm: "Move " + what + " to that tier?" },
    { kind: "issue", label: "Close", args: { id: i.id, do: "close" }, input: { name: "reason", label: "Reason to close", required: true }, confirm: "Close " + what + " with that reason?", danger: true },
  ];
}

/** The pure half: the issues resource -> the window. */
export function issuesWindow(v: IssuesData | null, at: number, ok: boolean, error?: string): WindowDetail {
  const all = (v && v.issues) || [];
  const open = all.filter((i) => i.state !== "closed"),
    closed = all.filter((i) => i.state === "closed");
  const n = v && typeof v.open === "number" ? v.open : open.length;
  const sections: DetailSection[] = [];
  if (v && !all.length) sections.push({ title: "No issues", kind: "text", text: "No issues. Everything the system could not finish itself would be listed here." });
  open.forEach((i) => {
    const items = issueLines(i);
    const acts = issueActions(i);
    if (items.length) items[items.length - 1] = { ...items[items.length - 1], actions: acts };
    else items.push({ text: "", actions: acts });
    sections.push({ title: i.card || "no card", sub: [i.kind, "raised " + when(i.raisedAt)].filter(Boolean).join(" · "), kind: "list", items });
  });
  if (closed.length) {
    const rows: DetailRow[] = closed.map((i) => ({
      cells: [i.card || "no card", "closed: " + (i.reason || ""), when(i.raisedAt)],
      tone: "d",
      note: issueLines(i)
        .map((x) => (x.strong ? x.strong + ": " : "") + x.text)
        .join(" · "),
    }));
    sections.push({ title: "Closed", sub: String(closed.length), kind: "table", columns: ["Card", "Closed", "Raised"], rows, collapsed: !!open.length });
  }
  return {
    id: "issues",
    title: "Issues",
    tone: n ? "a" : "g",
    headline: !v ? "Reading the issues…" : n ? pl(n, "issue") + " open" : "No open issues",
    sub: "What the system could not finish itself.",
    chips: closed.length ? [{ t: closed.length + " closed" }] : [],
    at,
    ok,
    error,
    sections,
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<IssuesData>("issues", { fresh: true });
    return issuesWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return issuesWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
