/**
 * The full cockpit's view model (FA-19087): the top bar and the home column
 * (the lane switches, the Budget, the office, the three faces, the drafting
 * mode and the key numbers), built server-side from the cockpit client's
 * resources (server/cockpit/home.ts) so the page stays a renderer. The words
 * follow the legacy page's own renderers in tools/lane/maint/ui/index.html.
 */
import type { CardId, Tone } from "./cockpit.js";

/** n = neutral (no target), the legacy tiles' fifth tone. */
export type KTone = Tone | "n";

/** Where a click on a home face goes: one of the 14 card windows, or a legacy-only window (opened at the legacy page's fallback path). */
export type Opens = { card: CardId } | { legacy: string };

export interface HeaderView {
  /** the brand pill: All good, Updating, Paused (Mac busy), Stopped, Maintenance, Needs attention */
  status: { text: string; tone: Tone };
  /** the snapshot time the cockpit stamped (ms) */
  at: number;
  account: { label: string; tone: string; title: string; halo: { text: string; match: boolean | null } | null } | null;
  push: { ahead: number; title: string; blocked: string | null } | null;
  /** master's reply times (ms): the unread count is those newer than the viewer's last look (localStorage msgSeen, as the legacy page) */
  master: { replyAts: number[] } | null;
  phone: { word: string; state: string; title: string } | null;
  usage: { session: number | null; week: number | null; title: string } | null;
}

export interface LaneView {
  /** masterIntervene: true = MIs allowed (Unlocked) */
  unlocked: boolean | null;
  /** dispatcher: Production on */
  production: boolean | null;
  /** haloClient: Client on */
  client: boolean | null;
  /** FA-19134: the Lane card's questions button (legacy qBtn, qTick): shown only while features.questions.n > 0 */
  questions?: { n: number; label: string; sub: string; tone: "red" | "amber"; aria: string } | null;
}

export interface BudgetView {
  auto: boolean;
  /** the % in force (derived while Auto) */
  pctPerDay: number | null;
  /** what the stepper shows: "Auto", "12%" or "…" */
  shown: string;
  line: string;
  capacity: boolean;
}

export interface OfficeTile {
  id: "agents" | "queue" | "commits" | "landed" | "halo" | "refusals";
  icon: string;
  n: number | null;
  suffix: string;
  label: string;
  title: string;
  tone: Tone;
  live?: boolean;
  /** the Commits tile opens the commit queue */
  queue?: boolean;
}

export interface OfficeView {
  head: string;
  tiles: OfficeTile[] | null;
  /** when the office has no facts yet: one line instead of the tiles */
  note: string;
  aria: string;
  title: string;
}

export interface FaceView {
  id: "overview" | "doorLanding" | "speed";
  label: string;
  headline: string;
  detail: string;
  flag: boolean;
  aria: string;
  opens: Opens;
}

export interface ModeView {
  label: string;
  head: string;
  detail: string;
  opens: Opens;
}

/** A tile's small chart, in its own units; the page draws it as SVG. */
export type KChart =
  | { kind: "bars"; values: number[]; max: number; yLabels: [string, string, string]; xLabels: string[] }
  | { kind: "pairs"; live: number[]; other: number[]; max: number; yLabels: [string, string, string]; xLabels: string[] }
  | { kind: "velocity"; values: number[]; top: number; goal: number | null; net: number[]; netMax: number }
  | { kind: "strip"; max: number; goal: number | null; mark: number | null; band: [number, number] | null; ticks: number[] };

export interface KeyTile {
  id: "kVel" | "kJev" | "kLanded" | "kHalo" | "kBalancer" | "kWt" | "kRg" | "kUsd" | "kMin";
  label: string;
  /** the headline; for Velocity the per-hour figure */
  value: string;
  valueTone?: KTone;
  tone: KTone;
  /** small lines under the headline, in order */
  lines: { text: string; tone?: KTone; title?: string }[];
  title: string;
  chart: KChart | null;
  wide?: boolean;
  /** Velocity's icon (🚀▲, 🐢▼, ⏸️) and its net line */
  icon?: string;
  net?: string;
  art?: "halo" | "jev" | "balancer" | "landed";
  opens: Opens;
}

export interface HomeView {
  at: number;
  ok: boolean;
  error?: string;
  header: HeaderView;
  lane: LaneView;
  budget: BudgetView | null;
  office: OfficeView;
  faces: FaceView[];
  mode: ModeView | null;
  tiles: KeyTile[];
  /** the footer line */
  foot: string;
}

/** The legacy windows a home face opens that the region does not render yet: slug -> the legacy page's hash (popups.js SLUG). */
export const LEGACY_SLUGS: Record<string, string> = {
  overview: "overview",
  agents: "agents",
  jev: "jev",
  halosave: "halosave",
  balancer: "balancer",
  queue: "queue",
  apps: "apps",
  questions: "questions",
};
