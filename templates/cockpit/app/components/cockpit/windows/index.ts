import type { ComponentType } from "react";

import type { WindowDetail, WindowId } from "@shared/cockpit-windows";

import { OverviewPart } from "./OverviewPart";
// FA-19131: the commit queue has no Part; its text section reads as the legacy pre through this stylesheet
import "./queue.css";

/** What a window's own part gets: its document, whether this viewer may write, and a refresh. */
export type WindowPartProps = { d: WindowDetail; canWrite: boolean; onDone: () => void };

/**
 * FA-19087: a window's own interactive part (a composer, a form, a stepper), shown above its sections. Most windows
 * need none: their document's sections and actions are the whole window. One line per window that has one.
 */
export const WINDOW_PARTS: Partial<Record<WindowId, ComponentType<WindowPartProps>>> = {
  overview: OverviewPart,
};
