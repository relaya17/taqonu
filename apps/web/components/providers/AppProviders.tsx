"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { createAtlasTheme } from "@/styles/theme";
import { AiCompanionProvider } from "@/components/providers/AiCompanionProvider";

export function AppProviders({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const direction = locale === "en" ? "ltr" : "rtl";
  const theme = useMemo(() => createAtlasTheme(direction), [direction]);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
        },
      }),
  );

  const cache = useMemo(
    () =>
      createCache({
        key: direction === "rtl" ? "muirtl" : "mui",
        stylisPlugins: direction === "rtl" ? [prefixer, rtlPlugin] : [prefixer],
      }),
    [direction],
  );

  return (
    <AppRouterCacheProvider>
      <CacheProvider value={cache}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <QueryClientProvider client={queryClient}>
            <AiCompanionProvider>{children}</AiCompanionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </CacheProvider>
    </AppRouterCacheProvider>
  );
}
