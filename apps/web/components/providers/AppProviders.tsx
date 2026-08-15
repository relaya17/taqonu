"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import { createAtlasTheme } from "@/styles/theme";
import { AiCompanionProvider } from "@/components/providers/AiCompanionProvider";
import {
  ColorModeProvider,
  useColorMode,
} from "@/components/providers/ColorModeProvider";

function ThemedApp({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const direction = locale === "en" ? "ltr" : "rtl";
  const { mode } = useColorMode();
  const theme = useMemo(
    () => createAtlasTheme(direction, mode),
    [direction, mode],
  );
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

  // One Emotion cache only (AppRouterCacheProvider). A second CacheProvider
  // caused SSR/client className mismatches on Drawer / ListItemButton.
  const cacheOptions = useMemo(
    () =>
      direction === "rtl"
        ? {
            key: "muirtl",
            enableCssLayer: true,
            stylisPlugins: [prefixer, rtlPlugin],
          }
        : { key: "mui", enableCssLayer: true, stylisPlugins: [prefixer] },
    [direction],
  );

  return (
    <AppRouterCacheProvider options={cacheOptions}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <AiCompanionProvider>{children}</AiCompanionProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}

export function AppProviders({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  return (
    <ColorModeProvider>
      <ThemedApp locale={locale}>{children}</ThemedApp>
    </ColorModeProvider>
  );
}
