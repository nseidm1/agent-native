import { fail } from "@agent-native/core/action";
import { readAppState, writeAppState } from "@agent-native/core/application-state";

import {
  type CockpitLayout,
  LAYOUT_STATE_KEY,
  LayoutError,
  layoutOrDefault,
  validateLayout,
} from "../../shared/cockpit.js";

export async function readLayout(): Promise<CockpitLayout> {
  return layoutOrDefault(await readAppState(LAYOUT_STATE_KEY));
}

/** Validates first (an unknown id throws, nothing is written), then stores and reads back. */
export async function writeLayout(input: unknown): Promise<CockpitLayout> {
  let layout: CockpitLayout;
  try {
    layout = validateLayout(input);
  } catch (e) {
    if (e instanceof LayoutError) {
      fail(e.message, { errorCode: /unknown card id/.test(e.message) ? "unknown_card_id" : "invalid_layout", statusCode: 400 });
    }
    throw e;
  }
  await writeAppState(LAYOUT_STATE_KEY, layout as unknown as Record<string, unknown>);
  return readLayout();
}
