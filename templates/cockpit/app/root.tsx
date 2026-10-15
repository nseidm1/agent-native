import { configureTracking } from "@agent-native/core/client/analytics";
import { createAgentNativeQueryClient } from "@agent-native/core/client/hooks";
import { AppProviders } from "@agent-native/toolkit/app/providers";
import { useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { APP_TITLE } from "@/lib/app-config";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({ ...properties, app: "cockpit" }),
});

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>{APP_TITLE}</title>
        <Meta />
        <Links />
      </head>
      <body className="cockpit-body">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function NavigationStateSync() {
  useNavigationState();
  return null;
}

const LOADING = (
  <div className="cp-loading" role="status">
    <span className="cp-dot" /> Loading cards…
  </div>
);

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        defaultTheme="dark"
        toaster={null}
        i18n={false}
        skipFirstRunOnboarding
        clientOnlyFallback={LOADING}
        documentTitleFallback={APP_TITLE}
      >
        <NavigationStateSync />
        <Outlet />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/toolkit/app/shared/ErrorBoundary";
