import { defineAppConfig } from "@agent-native/core/server";

// One screen: the card region at the app root (served as /cards/).
export default defineAppConfig({
  app: { id: "cockpit", name: "Cockpit cards", homePath: "/" },
});
