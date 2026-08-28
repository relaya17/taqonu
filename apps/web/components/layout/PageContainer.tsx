"use client";

import { Box, type BoxProps, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Global page container for consistent content centering across Atlas.
 *
 * Features:
 * - Horizontally centered using margin-inline: auto (RTL-safe)
 * - Consistent max-width (default 920px, configurable)
 * - Responsive horizontal padding
 * - Full width on mobile, constrained on larger screens
 *
 * Use this component to wrap main page content for visual consistency.
 */

export interface PageContainerProps extends Omit<BoxProps, "maxWidth"> {
  children: ReactNode;
  /** Maximum width in pixels. Defaults to 920. Use "narrow" (680) or "wide" (1120) presets. */
  maxWidth?: number | "narrow" | "wide" | "full";
  /** Additional sx props merged with container styles */
  sx?: SxProps<Theme>;
  /** Disable default padding (for nested containers) */
  noPadding?: boolean;
  /** Center text content (use sparingly - mostly for hero sections) */
  textCenter?: boolean;
}

const WIDTH_PRESETS = {
  narrow: 680,
  wide: 1120,
  full: "100%",
} as const;

export function PageContainer({
  children,
  maxWidth = 920,
  sx,
  noPadding = false,
  textCenter = false,
  ...rest
}: PageContainerProps) {
  const resolvedMaxWidth =
    typeof maxWidth === "string" ? WIDTH_PRESETS[maxWidth] : maxWidth;

  return (
    <Box
      sx={[
        {
          width: "100%",
          maxWidth: resolvedMaxWidth,
          marginInline: "auto",
          ...(noPadding
            ? {}
            : {
                px: { xs: 0, sm: 1, md: 2 },
              }),
          ...(textCenter
            ? {
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }
            : {}),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}

/**
 * Centered section within a page - for cards, panels, forms.
 * Inherits centering from PageContainer but adds surface styling.
 */
export function PageSection({
  children,
  sx,
  ...rest
}: Omit<PageContainerProps, "maxWidth" | "noPadding">) {
  return (
    <Box
      sx={[
        {
          width: "100%",
          py: { xs: 2, sm: 2.5, md: 3 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...rest}
    >
      {children}
    </Box>
  );
}
