/**
 * FA-19174: the pure halves of the live frame's tools, exactly as the legacy studio has them (studio-steer.js: colourTokens,
 * sizeStep, padStep, chipOf, refOf; studio-canvas.js: changesOf, checkWords). No DOM, no React.
 */

/** One element of the live app as the frame script reports it (studio-live-frame.js info(): its selector, tag, own text, source, style). */
export type Pick = {
  sel: string;
  tag?: string | null;
  text?: string | null;
  label?: string | null;
  chain?: unknown;
  src?: string | null;
  srcOwn?: boolean;
  st?: { color?: string; bg?: string; size?: string; weight?: string; align?: string; pad?: string } & Record<string, unknown>;
  // filled once by frame/_/src: where it lives in the staging copy (file === null: not found)
  file?: string | null;
  line?: number | null;
  css?: string | null;
};
/** A comment pinned on the staging app (studio-comments.mjs). */
export type Comment = { id: string; at?: string; sel: string; tag?: string | null; text?: string | null; src?: string | null; page?: string | null; note: string; state: "open" | "sent" };
/** The variants read (studio-variants.mjs via frame/_/variants). */
export type Variant = { id: string; name: string; why?: string; map: Record<string, string>; checks?: { pairs?: number; pass?: number; worst?: { ratio: number; sel: string } | null }; before?: { pairs?: number; pass?: number } };
export type Variants = { palette?: { roles?: Record<string, string>; vars?: number }; kb?: { name: string } | null; variants?: Variant[] };

const COLORISH = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
/** the app's colour tokens (its root CSS variables), at most n, as var(--name) so the edit stays on the design system */
export function colourTokens(vars: Record<string, unknown> | null | undefined, n = 12) {
  return Object.entries(vars || {})
    .filter(([k, v]) => /^--[\w-]{1,60}$/.test(k) && COLORISH.test(String(v).trim()))
    .slice(0, n)
    .map(([k, v]) => ({ name: k.slice(2), value: "var(" + k + ")", swatch: String(v).trim() }));
}
/** the size step from the element's computed style */
export function sizeStep(px: unknown, dir: number) {
  const v = parseFloat(String(px)) || 16;
  return Math.round(Math.max(10, Math.min(96, v + dir * (v >= 28 ? 4 : 2)))) + "px";
}
/** the spacing step */
export function padStep(pad: unknown, dir: number) {
  const parts = String(pad || "0px")
    .split(/\s+/)
    .slice(0, 4)
    .map((p) => parseFloat(p) || 0);
  return parts.map((p) => Math.round(Math.max(0, dir > 0 ? (p ? p * 1.25 : 4) : p * 0.75)) + "px").join(" ");
}
/** a selection chip's words: "<button> Save" / "<h1> Welcome back" */
export const chipOf = (e: { tag?: string | null; text?: string | null; label?: string | null; sel?: string | null }) => ("<" + (e.tag || "el") + "> " + (e.text || e.label || e.sel || "")).slice(0, 60).trim();
/** the reference the chat takes (studio-chat.mjs refsOf) */
export function refOf(e: Partial<Pick>, o: { page?: string | null; shot?: string | null; note?: string | null; comment?: string | null } = {}) {
  return {
    sel: e.sel || "",
    tag: e.tag || undefined,
    text: e.text || undefined,
    src: e.file && e.line ? e.file + ":" + e.line : undefined,
    page: o.page || null,
    note: o.note || undefined,
    comment: o.comment || null,
    shot: o.shot || undefined,
    label: chipOf(e),
  };
}

const ROLES = ["background", "foreground", "primary", "accent", "card", "border", "muted"];
/** what a variant changes, by role first: [{role, from, to}] */
export function changesOf(v: Variant | null | undefined, palette: Variants["palette"]) {
  const roleOf: Record<string, string> = {};
  for (const [r, h] of Object.entries((palette && palette.roles) || {})) roleOf[h] = r;
  return Object.entries((v && v.map) || {})
    .map(([from, to]) => ({ role: roleOf[from] || null, from, to }))
    .sort((a, b) => (a.role ? ROLES.indexOf(a.role) : 99) - (b.role ? ROLES.indexOf(b.role) : 99));
}
export function checkWords(v: Variant) {
  const c = v.checks || {},
    b = v.before || {};
  if (!c.pairs) return { ok: true, text: "No text-on-fill pairs to check in its stylesheet" };
  return {
    ok: c.pass === c.pairs,
    text: c.pass + " of " + c.pairs + " text pairs reach 4.5:1" + (b.pairs ? " (now " + b.pass + ")" : "") + (c.worst && (c.pass || 0) < c.pairs ? "; lowest " + c.worst.ratio + ":1 on " + c.worst.sel : ""),
  };
}
export const ROLE_ORDER = ROLES;
