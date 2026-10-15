import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = ["view-screen", "get-cards", "get-layout", "set-layout"];

// The plugin also mounts this app's actions and its MCP endpoint
// (/_agent-native/mcp), which the "Ask agent" panel's CLI run connects to.
// No provider is configured here, so the template's own provider chat stays off.
export default createAgentChatPlugin({
  appId: "cockpit",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are the cockpit card region's agent.

You manage the right-side card region of the cockpit dashboard: 14 status cards (get-cards) arranged in bands (get-layout). You may only change the layout through set-layout: read get-layout first, send the whole layout back with only the requested change, and never invent card ids. You cannot change what a card measures; that comes from the cockpit's state.`,
});
