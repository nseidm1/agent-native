/**
 * FA-19174: the studio's live staging frame (studio-stage.js) with its bar (Phone | Wide, Dark | Light, Select, Mark,
 * Comments, Variants: studio-steer.js, studio-canvas.js). STUB in the shell: the staging picture stands in.
 */
import type { ReactNode } from "react";

export function StudioStage({ fallback }: { fallback: ReactNode }) {
  return <>{fallback}</>;
}
