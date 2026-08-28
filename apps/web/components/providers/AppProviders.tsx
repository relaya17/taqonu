"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import { createAtlasTheme, type AtlasColorMode } from "@/styles/theme";
import { AiCompanionProvider } from "@/components/providers/AiCompanionProvider";
import {
  ColorModeProvider,
  useColorMode,
} from "@/components/providers/ColorModeProvider";

const CACHE_OPTIONS_LTR = {
  key: "mui",
  enableCssLayer: true,
  stylisPlugins: [prefixer],
};

const CACHE_OPTIONS_RTL = {
  key: "muirtl",
  enableCssLayer: true,
  stylisPlugins: [prefixer, rtlPlugin],
};

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

  const cacheOptions =
    direction === "rtl" ? CACHE_OPTIONS_RTL : CACHE_OPTIONS_LTR;

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
  initialMode,
  children,
}: {
  locale: string;
  initialMode: AtlasColorMode;
  children: ReactNode;
}) {
  return (
    <ColorModeProvider initialMode={initialMode}>
      <ThemedApp locale={locale}>{children}</ThemedApp>
    </ColorModeProvider>
  );
}
