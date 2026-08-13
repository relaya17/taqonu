"use client";

import { createTheme, type Theme } from "@mui/material/styles";

export type AtlasColorMode = "light" | "dark";

export function createAtlasTheme(
  direction: "rtl" | "ltr",
  mode: AtlasColorMode = "light",
): Theme {
  const dark = mode === "dark";

  return createTheme({
    direction,
    cssVariables: true,
    palette: {
      mode,
      primary: {
        main: dark ? "#7EB8B9" : "#0F3D3E",
        contrastText: dark ? "#0A1C1D" : "#F4F7F5",
      },
      secondary: {
        main: dark ? "#E08A5C" : "#C45C26",
      },
      background: {
        default: dark ? "#0B1415" : "#E8EEF0",
        paper: dark ? "#132022" : "#F7FAF8",
      },
      text: {
        primary: dark ? "#E8F0F0" : "#142022",
        secondary: dark ? "#9BB0B2" : "#3D5557",
      },
      divider: dark ? "rgba(232,240,240,0.12)" : "rgba(20,32,34,0.12)",
      success: { main: dark ? "#3D9B6E" : "#1F7A4D" },
      warning: { main: dark ? "#D4A017" : "#B7791F" },
      error: { main: dark ? "#E05A4F" : "#B42318" },
    },
    typography: {
      fontFamily:
        direction === "rtl"
          ? '"Rubik", "IBM Plex Sans Arabic", "Segoe UI", sans-serif'
          : '"Source Sans 3", "Segoe UI", sans-serif',
      h1: {
        fontFamily:
          direction === "rtl"
            ? '"Frank Ruhl Libre", "Rubik", serif'
            : '"Fraunces", "Source Serif 4", serif',
        fontWeight: 700,
        letterSpacing: "-0.02em",
        fontSize: "clamp(1.75rem, 4vw, 2.4rem)",
        lineHeight: 1.2,
      },
      h2: {
        fontFamily:
          direction === "rtl"
            ? '"Frank Ruhl Libre", "Rubik", serif'
            : '"Fraunces", "Source Serif 4", serif',
        fontWeight: 650,
        fontSize: "clamp(1.25rem, 2.5vw, 1.5rem)",
      },
      button: {
        textTransform: "none",
        fontWeight: 600,
      },
    },
    shape: {
      borderRadius: 10,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            maxWidth: "100%",
            overflowX: "clip",
            colorScheme: mode,
          },
          body: {
            backgroundImage: dark
              ? "radial-gradient(circle at 14% 8%, rgba(126, 184, 185, 0.14), transparent 40%), radial-gradient(circle at 90% 0%, rgba(224, 138, 92, 0.1), transparent 38%), linear-gradient(180deg, #0B1415 0%, #0F1A1B 100%)"
              : "radial-gradient(circle at 12% 10%, rgba(196, 92, 38, 0.12), transparent 36%), radial-gradient(circle at 88% 0%, rgba(15, 61, 62, 0.16), transparent 42%), linear-gradient(180deg, #E8EEF0 0%, #D9E4E6 100%)",
            minHeight: "100vh",
            maxWidth: "100%",
            overflowX: "clip",
          },
          "img, svg, video, canvas": {
            maxWidth: "100%",
            height: "auto",
          },
          "pre, code, table": {
            maxWidth: "100%",
            overflowX: "auto",
          },
          ":focus-visible": {
            outline: dark ? "3px solid #E08A5C" : "3px solid #C45C26",
            outlineOffset: 2,
          },
          ".skip-link": {
            position: "absolute",
            insetInlineStart: 12,
            top: 8,
            zIndex: 4000,
            padding: "10px 14px",
            background: dark ? "#7EB8B9" : "#0F3D3E",
            color: dark ? "#0A1C1D" : "#F4F7F5",
            borderRadius: 8,
            transform: "translateY(-160%)",
            transition: "transform 120ms ease",
            textDecoration: "none",
            fontWeight: 600,
          },
          ".skip-link:focus, .skip-link:focus-visible": {
            transform: "translateY(0)",
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
              scrollBehavior: "auto !important",
            },
            ".skip-link": {
              transition: "none",
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            minHeight: 44,
            px: 1.5,
          },
        },
      },
      MuiIconButton: {
        defaultProps: {
          size: "medium",
        },
        styleOverrides: {
          root: {
            minWidth: 44,
            minHeight: 44,
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            minHeight: 44,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            "&:focus-visible": {
              outline: dark ? "3px solid #E08A5C" : "3px solid #C45C26",
              outlineOffset: 2,
            },
          },
        },
      },
    },
  });
}
