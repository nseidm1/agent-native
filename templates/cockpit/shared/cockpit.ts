/**
 * The cockpit card region's shared vocabulary: the 14 card ids, the compact
 * card model the server sends, and the layout the agent may rearrange.
 * Imported by actions (server) and the route (client), so it stays pure.
 */

export const CARD_IDS = [
  "score",
  "pipeline",
  "production",
  "board",
  "jobs",
  "forge",
  "orphans",
  "hygiene",
  "events",
  "models",
  "halo",
  "halocaps",
  "modes",
  "appkpis",
] as const;

export type CardId = (typeof CARD_IDS)[number];

export const CARD_TITLES: Record<CardId, string> = {
  score: "Scorecard",
  pipeline: "Work pipeline",
  production: "Production releases",
  board: "Board",
  jobs: "Agent jobs",
  forge: "Forge",
  orphans: "Work state",
  hygiene: "Board upkeep",
  events: "Activity",
  models: "AI models",
  halo: "Halo",
  halocaps: "Halo capabilities",
  modes: "Drafting modes",
  appkpis: "App and system KPIs",
};

/** g = good, a = attention, r = broken, d = dim / no data. */
export type Tone = "g" | "a" | "r" | "d";

export interface CardMeter {
  label: string;
  pct: number;
}

export interface CockpitCard {
  id: CardId;
  title: string;
  tone: Tone;
  headline: string;
  sub: string;
  chip: string;
  spark?: number[];
  meters?: CardMeter[];
}

export interface CardsResult {
  at: number;
  ok: boolean;
  error?: string;
  /** true while the cockpit client's change stream is connected (the page refreshes on its events) */
  live?: boolean;
  cards: CockpitCard[];
}

export type CardSize = "s" | "m" | "l";

export interface LayoutBand {
  id: string;
  title: string;
  cards: CardId[];
}

export interface CockpitLayout {
  bands: LayoutBand[];
  hidden: CardId[];
  size: Partial<Record<CardId, CardSize>>;
}

export const LAYOUT_STATE_KEY = "cockpit-layout";

export const DEFAULT_LAYOUT: CockpitLayout = {
  bands: [
    { id: "flow", title: "Flow", cards: ["score", "pipeline", "production", "board"] },
    { id: "work", title: "Work", cards: ["jobs", "forge", "orphans", "hygiene", "events"] },
    {
      id: "compute",
      title: "Models & compute",
      cards: ["models", "halo", "halocaps", "modes", "appkpis"],
    },
  ],
  hidden: [],
  size: {},
};

export function isCardId(v: unknown): v is CardId {
  return typeof v === "string" && (CARD_IDS as readonly string[]).includes(v);
}

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

const BAND_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Validate a proposed layout. Every card id must be one of the 14 known ids;
 * an unknown id is refused, never dropped. A card may appear at most once
 * across bands; known cards absent from every band and from `hidden` are
 * appended to the last band so a layout can never lose a card by omission.
 */
export function validateLayout(input: unknown): CockpitLayout {
  if (!input || typeof input !== "object") throw new LayoutError("layout must be an object");
  const raw = input as Record<string, unknown>;
  const unknown: string[] = [];
  const check = (v: unknown): v is CardId => {
    if (isCardId(v)) return true;
    unknown.push(String(v));
    return false;
  };
  if (!Array.isArray(raw.bands) || raw.bands.length === 0) {
    throw new LayoutError("layout.bands must be a non-empty array");
  }
  if (raw.bands.length > 8) throw new LayoutError("at most 8 bands");
  const seen = new Set<CardId>();
  const bandIds = new Set<string>();
  const bands: LayoutBand[] = raw.bands.map((b, i) => {
    if (!b || typeof b !== "object") throw new LayoutError(`band ${i} must be an object`);
    const band = b as Record<string, unknown>;
    const id = typeof band.id === "string" && band.id ? band.id : `band-${i + 1}`;
    if (!BAND_ID.test(id)) throw new LayoutError(`band id "${id}" must be lowercase letters, digits or dashes`);
    if (bandIds.has(id)) throw new LayoutError(`band id "${id}" is used twice`);
    bandIds.add(id);
    const title = typeof band.title === "string" ? band.title.trim().slice(0, 40) : "";
    if (!title) throw new LayoutError(`band "${id}" needs a title`);
    if (!Array.isArray(band.cards)) throw new LayoutError(`band "${id}".cards must be an array`);
    const cards: CardId[] = [];
    for (const c of band.cards) {
      if (!check(c)) continue;
      if (seen.has(c)) throw new LayoutError(`card "${c}" appears more than once`);
      seen.add(c);
      cards.push(c);
    }
    return { id, title, cards };
  });
  const hidden: CardId[] = [];
  if (raw.hidden !== undefined) {
    if (!Array.isArray(raw.hidden)) throw new LayoutError("layout.hidden must be an array");
    for (const c of raw.hidden) {
      if (!check(c)) continue;
      if (seen.has(c)) throw new LayoutError(`card "${c}" is both shown and hidden`);
      seen.add(c);
      hidden.push(c);
    }
  }
  const size: Partial<Record<CardId, CardSize>> = {};
  if (raw.size !== undefined) {
    if (!raw.size || typeof raw.size !== "object" || Array.isArray(raw.size)) {
      throw new LayoutError("layout.size must be an object of { cardId: 's'|'m'|'l' }");
    }
    for (const [k, v] of Object.entries(raw.size as Record<string, unknown>)) {
      if (!check(k)) continue;
      if (v !== "s" && v !== "m" && v !== "l") {
        throw new LayoutError(`size of "${k}" must be 's', 'm' or 'l'`);
      }
      size[k] = v;
    }
  }
  if (unknown.length) {
    throw new LayoutError(
      `unknown card id${unknown.length > 1 ? "s" : ""}: ${[...new Set(unknown)].join(", ")}. Known ids: ${CARD_IDS.join(", ")}`,
    );
  }
  const missing = CARD_IDS.filter((c) => !seen.has(c));
  if (missing.length) bands[bands.length - 1].cards.push(...missing);
  return { bands, hidden, size };
}

/** A stored value that no longer validates falls back to the default. */
export function layoutOrDefault(stored: unknown): CockpitLayout {
  if (!stored) return structuredClone(DEFAULT_LAYOUT);
  try {
    return validateLayout(stored);
  } catch {
    return structuredClone(DEFAULT_LAYOUT);
  }
}
