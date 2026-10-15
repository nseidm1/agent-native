import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

// The region is served under /cards/ (embedded in the cockpit as an iframe).
// The build script sets APP_BASE_PATH=/cards, and the framework derives from it
// Vite's base "/cards/", React Router's basename "/cards" and the server's
// prefix stripping; setting them here as well would apply the prefix twice.

export default defineConfig({
  optimizeDeps: {
    entries: ["app/entry.client.tsx", "app/root.tsx", "app/routes/_index.tsx"],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
    }),
  ],
});
