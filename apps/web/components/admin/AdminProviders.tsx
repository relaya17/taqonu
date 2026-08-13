"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import { createAtlasTheme } from "@/styles/theme";

export function AdminProviders({ children }: { children: ReactNode }) {
  const theme = useMemo(() => createAtlasTheme("rtl"), []);
  const [queryClient] = useState(() => new QueryClient());
  const cacheOptions = useMemo(
    () => ({ key: "adminrtl", stylisPlugins: [prefixer, rtlPlugin] }),
    [],
  );

  return (
    <AppRouterCacheProvider options={cacheOptions}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
