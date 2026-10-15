import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { getCards } from "../server/cockpit/cards.js";
import { readLayout } from "../server/cockpit/layout.js";

export default defineAction({
  description:
    "Read what the card region shows right now: navigation, the layout (bands, hidden, sizes) and each card's tone and headline.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const [navigation, layout, cards] = await Promise.all([
      readAppState("navigation"),
      readLayout(),
      getCards(),
    ]);
    return {
      ...(navigation ? { navigation } : {}),
      layout,
      cards: cards.cards.map((c) => ({ id: c.id, tone: c.tone, headline: c.headline })),
      ...(cards.ok ? {} : { error: cards.error }),
    };
  },
});
