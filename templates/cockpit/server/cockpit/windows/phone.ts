/**
 * FA-19128: Phone app, ported from the legacy phoneDlg (tools/lane/maint/ui/index.html, the PHONE APP script and its PH state
 * table): the state in words, the attached devices, the install job's steps (build, install, launch, each with its line), the
 * installed build and the last result. Picking a device and installing (android.install, behind a confirm) is the window's
 * part (app/components/cockpit/windows/PhonePart.tsx), which reads `part`.
 */
import type { Tone } from "../../../shared/cockpit.js";
import type { DetailItem, DetailRow, DetailSection } from "../../../shared/cockpit-detail.js";
import { DETAIL_MAX_CHARS } from "../../../shared/cockpit-detail.js";
import type { WindowDetail } from "../../../shared/cockpit-windows.js";
import { get } from "../client.js";
import type { WindowBuilder } from "./registry.js";

type Dev = { serial: string; model?: string | null; state?: string };
type Build = { ok?: boolean; serial?: string; at?: string; reason?: string; hint?: string; versionCode?: number | null; installedVersionCode?: number | null; sha?: string; adb?: string | null; downgrade?: boolean };
export type Android = {
  state?: string;
  adbError?: boolean;
  devices?: Dev[];
  pick?: string | null;
  master?: string | null;
  job?: { serial?: string; at?: string; step?: string; steps?: Record<string, { state?: string; line?: string }> | null } | null;
  installed?: Build | null;
  last?: Build | null;
};
/** What PhonePart reads. */
export type PhoneStep = { id: string; cls: "" | "did" | "on" | "bad"; line: string };
export type PhonePartData = { state: string; ready: { serial: string; label: string }[]; pick: string | null; go: string | null; steps: PhoneStep[] | null };

const clip = (s: string) => (s.length > DETAIL_MAX_CHARS ? s.slice(0, DETAIL_MAX_CHARS - 1) + "…" : s);
/** legacy hm(): "today 05:50" or "Oct 11 23:53" */
export function hm(iso: string | undefined, now = Date.now()): string {
  const d = new Date(iso ?? "");
  if (!(+d > 0)) return "";
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === new Date(now).toDateString() ? "today " + t : d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + t;
}
const buildOf = (x: Build) => [x.versionCode != null ? "versionCode " + x.versionCode : "", x.sha ? "android/ at " + x.sha : ""].filter(Boolean).join(", ");
const ORDER = ["build", "install", "launch"];
const TONE: Record<string, Tone> = { ready: "g", installed: "g", installing: "a", unauthorized: "a", failed: "r", none: "d", noadb: "d" };

/** The legacy PH table: each state's word, its line and its button (null: nothing to press). */
export function phState(v: Android, pick: string | null, now = Date.now()): { w: string; tip: string; go: string | null } {
  const devs = v.devices || [];
  const dev = (s: string | undefined) => {
    const d = devs.find((x) => x.serial === s);
    return d ? (d.model ? d.model + " (" + d.serial + ")" : d.serial) : s || "";
  };
  switch (v.state) {
    case "noadb":
      return { w: "no adb", tip: "adb is not on this Mac: install Android SDK Platform-Tools (Android Studio > SDK Manager)", go: null };
    case "unauthorized":
      return { w: "allow USB", tip: "The phone is attached but not authorized: accept the USB debugging prompt on the phone", go: null };
    case "ready":
      return { w: "ready", tip: "Ready to install on " + (pick ? dev(pick) : devs.filter((x) => x.state === "device").length + " devices: pick one"), go: "Install" };
    case "installing": {
      const j = v.job || {};
      return { w: "installing · " + (j.step || ""), tip: "Installing on " + dev(j.serial) + ": " + (j.step || "") + " (started " + hm(j.at, now) + ")", go: null };
    }
    case "installed": {
      const i = v.installed || {};
      return { w: "installed", tip: "Installed on " + dev(i.serial) + " " + hm(i.at, now) + (buildOf(i) ? " · " + buildOf(i) : ""), go: "Reinstall" };
    }
    case "failed": {
      const l = v.last || {};
      return { w: "failed", tip: "Install failed: " + l.reason + (l.hint ? " - " + l.hint : ""), go: "Retry" };
    }
    default:
      return { w: "no device", tip: (v.adbError ? "adb did not answer (adb kill-server, then plug the phone in again); " : "No phone: ") + "plug in a phone with USB debugging on", go: null };
  }
}

/** The pure half: the android resource -> the window (exported for its spec). */
export function phoneWindow(v: Android | null, at: number, ok: boolean, error?: string, now = Date.now()): WindowDetail {
  if (!v) return { id: "phone", title: "Phone app", tone: "d", headline: "Reading the phone…", sub: "", chips: [], at, ok, error, sections: [] };
  const devs = v.devices || [];
  const dev = (s: string | undefined) => {
    const d = devs.find((x) => x.serial === s);
    return d ? (d.model ? d.model + " (" + d.serial + ")" : d.serial) : s || "";
  };
  const ready = devs.filter((x) => x.state === "device");
  const pick = v.pick && ready.some((x) => x.serial === v.pick) ? v.pick : ready.length === 1 ? ready[0].serial : null;
  const ph = phState(v, pick, now);
  // the job's steps (legacy phoneSteps), shown while it installs
  let steps: PhoneStep[] | null = null;
  if (v.state === "installing" && v.job) {
    const at0 = ORDER.indexOf(v.job.step || "");
    const st = v.job.steps;
    steps = ORDER.map((id, i) => {
      const r = st && st[id];
      const cls = r ? (r.state === "done" ? "did" : r.state === "on" ? "on" : r.state === "failed" ? "bad" : "") : i < at0 ? "did" : i === at0 ? "on" : "";
      return { id, cls, line: (r && r.line) || "" };
    });
  }
  const sections: DetailSection[] = [];
  if (devs.length)
    sections.push({
      title: "Devices",
      kind: "table",
      columns: ["Device", "Serial", "State"],
      rows: devs.map(
        (d): DetailRow => ({
          cells: [d.model || "phone", { t: d.serial, mono: true }, { t: d.state === "device" ? (d.serial === pick ? "ready · picked" : "ready") : d.state || "", tone: d.state === "device" ? "g" : "a" }],
        }),
      ),
    });
  // legacy phoneLast and phoneSha: the last install, and the installed build beside master's android/
  const items: DetailItem[] = [];
  const last = v.last;
  if (last && v.state !== "failed")
    items.push({ text: clip("Last install: " + (last.ok ? "installed" : last.reason) + " on " + dev(last.serial) + ", " + hm(last.at, now) + (last.ok && buildOf(last) ? " (" + buildOf(last) + ")" : "")), tone: last.ok ? "g" : "r" });
  const got = v.installed || v.last;
  let sha = "";
  let shaTone: Tone | undefined;
  if (v.master && got && got.ok !== false) {
    const same = got.sha === v.master;
    if (!same) shaTone = "a";
    sha =
      "Installed android/ " +
      (got.sha || "?") +
      (got.versionCode != null ? " (versionCode " + (got.installedVersionCode != null ? got.installedVersionCode : got.versionCode) + ")" : "") +
      " · master android/ " +
      v.master +
      (same ? " · current" : " · out of date: Reinstall");
  } else if (v.master) sha = "master android/ " + v.master;
  if (last && last.adb) sha += (sha ? " · " : "") + "adb: " + last.adb + (last.downgrade ? " (with -d)" : "");
  if (sha) items.push({ text: clip(sha), tone: shaTone });
  if (items.length) sections.push({ title: "Installed build", kind: "list", items });
  const part: PhonePartData = { state: v.state || "none", ready: ready.map((d) => ({ serial: d.serial, label: dev(d.serial) })), pick, go: ph.go, steps };
  return {
    id: "phone",
    title: "Phone app",
    tone: TONE[v.state || "none"] || "d",
    headline: clip(ph.tip),
    sub: "The cockpit builds the app and installs it on the phone over USB (node tools/android.mjs run); closing this window changes nothing.",
    chips: [{ t: ph.w, tone: TONE[v.state || "none"] }],
    at,
    ok,
    error,
    sections,
    part,
  };
}

const build: WindowBuilder = async () => {
  try {
    const r = await get<Android>("android", { fresh: true });
    return phoneWindow(r.data, r.at, r.ok, r.error);
  } catch (e) {
    return phoneWindow(null, Date.now(), false, e instanceof Error ? e.message : String(e));
  }
};
export default build;
