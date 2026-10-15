import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";

// The region's only screen is the app root (/cards/). The [...page] catch-all
// does not match the bare root, so it gets its own SSR route.
export default createH3SSRHandler(
  () => import("virtual:react-router/server-build"),
);
