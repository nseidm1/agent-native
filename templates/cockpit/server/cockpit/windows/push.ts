/**
 * FA-19127: Push to remote, ported from the legacy pushDlg (tools/lane/maint/ui/index.html, the PUSH TO REMOTE
 * script): how many commits local master is ahead of its upstream, the newest subjects, why a push cannot go, the
 * last push's warnings or refusal, the apps not part of it; and the push itself, the console's act, behind a confirm.
 */
import type { DetailAction, DetailItem } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type Release = {
  ahead?: number;
  upstream?: string;
  summary?: string;
  subjects?: { sha?: string; s?: string }[];
  promote?: { name?: string }[];
  blocked?: string | null;
  last?: { state?: string; at?: string | number; error?: string; warnings?: string[] } | null;
};

const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");
const when = (t: string | number | undefined) => {
  const d = new Date(t ?? "");
  return isNaN(+d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The pure half: the release resource's data -> the window (exported for its spec). */
export function pushWindow(v: Release | null, at: number, ok: boolean, error?: string): WindowDetail {
  const n = v && typeof v.ahead === "number" ? v.ahead : 0;
  const up = (v && v.upstream) || "origin";
  const why = !v ? "checking" : v.blocked || null;
  const headline = !v ? "Checking what would go…" : n ? pl(n, "commit") + " on local master would go to " + up + "." : "Local master matches " + up + ".";
  const items: DetailItem[] = ((v && v.subjects) || []).map((c) => ({ strong: String(c.sha || ""), text: String(c.s || "") }));
  if (v && n > items.length) items.push({ text: "and " + (n - items.length) + " older", tone: "d" });
  const notes: DetailItem[] = [];
  if (why) notes.push({ text: cap(why) + ".", tone: "a" });
  const last = v && v.last;
  for (const w of (last && last.warnings) || []) notes.push({ text: "The last push warned: " + w, tone: "a" });
  if (last && last.state === "error") notes.push({ text: "The last push (" + when(last.at) + ") was refused: " + (last.error || ""), tone: "r" });
  if (v && (v.promote || []).length)
    notes.push({ text: "Not part of this push: " + (v.promote || []).map((a) => a.name).join(", ") + " production differs from staging; the public sites change only through Promote to production.", tone: "d" });
  const actions: DetailAction[] =
    v && !why && n
      ? [{ kind: "push", label: "Push " + pl(n, "commit"), args: { confirm: true }, confirm: "Push " + pl(n, "commit") + " from local master to " + up + "?" }]
      : [];
  return {
    id: "push",
    title: "Push to remote",
    tone: why && v ? "a" : n ? "g" : "d",
    headline,
    sub: v && v.summary ? v.summary : "",
    chips: n ? [{ t: pl(n, "commit") + " waiting" }] : [],
    at,
    ok,
    error,
    actions,
    sections: [
      { title: "Newest commits waiting", kind: "list", items, empty: n ? "reading…" : "nothing waiting" },
      ...(notes.length ? [{ title: "Notes", kind: "list" as const, items: notes }] : []),
    ],
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<Release>("release", { fresh: true });
    return pushWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return pushWindow({ ahead: 0, blocked: "the cockpit is not answering" }, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
