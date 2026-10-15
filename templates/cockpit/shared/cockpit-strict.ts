/**
 * FA-19130: production strictness, the legacy Overview's 0-7 stepper (tools/lane/maint/ui/index.html, the PRODUCTION
 * STRICTNESS script). Ten gates in seven steps, safest first; level n means the first n steps are on and the rest off.
 * A level that matches no such shape is custom (set by hand). Pure: the Overview's Part and the window builder share it.
 */
export const STRICT_ORDER: readonly (readonly StrictGate[])[] = [["releaseGate"], ["shipping"], ["suite", "kick"], ["auditors", "review"], ["batch"], ["drafterFloor"], ["brief", "sendBack"]];
export type StrictGate = "drafterFloor" | "auditors" | "review" | "suite" | "kick" | "shipping" | "releaseGate" | "batch" | "brief" | "sendBack";
export type StrictMap = Partial<Record<StrictGate, boolean>>;

/** The rules the Production box lists with a switch, in the legacy order, each with the gates it turns. */
export const STRICT_RULES: readonly { gates: readonly StrictGate[]; text: string }[] = [
  { gates: ["drafterFloor"], text: "Opus writes every app card." },
  { gates: ["auditors", "review"], text: "Two senior reviewers (Opus and Sonnet) must both approve; trainee reviews never count." },
  { gates: ["suite", "kick"], text: "Before release the change is tested merged onto the latest code: the app dry run and its browser tests, including the claim flows when claim code changed." },
  { gates: ["shipping"], text: "The shipping checklist is enforced (demo mode, checks, docs)." },
  { gates: ["releaseGate"], text: "No change may switch the real-money release gate on." },
  { gates: ["batch"], text: "App cards release in their own batches of at most 8, never mixed with system work." },
  { gates: ["brief", "sendBack"], text: "Authors get the strict brief and failures come back with reasons." },
];

/** The legacy's confirm text before the release-gate rule goes off. */
export const STRICT_RISK =
  "Turn off the real-money release-gate rule? With it off, a change could switch the real-money RELEASE_TESTING gate on without review, and real payments could flow from unreviewed code. Every other rule stays as it is.";

/** A gate counts as on unless it is false (the legacy `cur[k] !== false`). */
export const gatesOn = (cur: StrictMap, keys: readonly StrictGate[]) => keys.every((k) => cur[k] !== false);

/** The level 0-7, or null when the switches were set by hand into no level's shape. */
export function strictLevel(cur: StrictMap): number | null {
  const n = STRICT_ORDER.findIndex((g) => !gatesOn(cur, g)),
    k = n < 0 ? 7 : n;
  return STRICT_ORDER.slice(k).every((g) => g.every((x) => cur[x] === false)) ? k : null;
}
/** How many steps are on (the chip's number when the level is custom). */
export const strictCount = (cur: StrictMap) => STRICT_ORDER.filter((g) => gatesOn(cur, g)).length;
/** The chip: "Strictness 7 of 7", or "Strictness 4 of 7 · custom". */
export function strictChip(cur: StrictMap): { text: string; tone: "s" | "a" | "d" } {
  const lv = strictLevel(cur);
  return { text: "Strictness " + (lv ?? strictCount(cur)) + " of 7" + (lv === null ? " · custom" : ""), tone: lv === 7 ? "s" : lv === 0 ? "a" : "d" };
}
/** The switches level lv wants. */
export function wantLevel(cur: StrictMap, lv: number): StrictMap {
  const want: StrictMap = { ...cur };
  STRICT_ORDER.forEach((g, i) => {
    for (const k of g) want[k] = i < lv;
  });
  return want;
}
/** The switches one rule's toggle wants (every gate of the rule to the opposite of the rule's state). */
export function wantFlip(cur: StrictMap, gates: readonly StrictGate[]): StrictMap {
  const v = !gatesOn(cur, gates),
    want: StrictMap = { ...cur };
  for (const k of gates) want[k] = v;
  return want;
}
/**
 * The writes, ONE gate each, in order: ons safest first, offs least-safe first, so a sequence cut short never leaves
 * a safer rule off while a weaker one is on (the legacy write()).
 */
export function strictSteps(cur: StrictMap, want: StrictMap): { gate: StrictGate; on: boolean }[] {
  const flat = STRICT_ORDER.flat();
  const ons = flat.filter((g) => want[g] && cur[g] === false).map((gate) => ({ gate, on: true }));
  const offs = [...flat].reverse().filter((g) => !want[g] && cur[g] !== false).map((gate) => ({ gate, on: false }));
  return [...ons, ...offs];
}
