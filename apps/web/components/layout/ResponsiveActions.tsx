import { Box, type BoxProps } from "@mui/material";
import type { ReactNode } from "react";

/** Centered action row: full-width stack on phones, wrapping row from sm up. */
export function ResponsiveActions({
  children,
  compact = false,
  sx,
}: {
  children: ReactNode;
  compact?: boolean;
  sx?: BoxProps["sx"];
}) {
  return (
    <Box
      sx={[
        {
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: { xs: "stretch", sm: "center" },
          gap: compact ? 1 : 1.25,
          width: "100%",
          minWidth: 0,
          "& > .MuiButton-root": {
            minHeight: 44,
            width: { xs: "100%", sm: "auto" },
            minWidth: { sm: compact ? 132 : 156 },
            maxWidth: { sm: compact ? 220 : 280 },
            flex: { sm: "1 1 auto" },
          },
          "& > .MuiChip-root": {
            alignSelf: "center",
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}
