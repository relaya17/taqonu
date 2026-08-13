"use client";

import { createTheme, type Theme } from "@mui/material/styles";
import { atlasChrome as c } from "@/styles/palette";

export type AtlasColorMode = "light" | "dark";

export function createAtlasTheme(
  direction: "rtl" | "ltr",
  _mode: AtlasColorMode = "light",
): Theme {
  // Global UI is always light silver. Dark is scoped to Studio / marketing.
  return createTheme({
    direction,
    cssVariables: false,
    palette: {
      mode: "light",
      primary: {
        main: c.steelMid,
        contrastText: c.chromeBright,
      },
      secondary: {
        main: c.accent,
        contrastText: c.onAccent,
      },
      background: {
        default: c.silverBg,
        paper: c.silverPaper,
      },
      text: {
        primary: c.textOnLight,
        secondary: c.textSecondaryOnLight,
      },
      divider: "rgba(26, 28, 34, 0.14)",
      success: { main: "#3D7A5F" },
      warning: { main: "#9A7B3C" },
      error: { main: "#B42318" },
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
            colorScheme: "light",
          },
          body: {
            backgroundColor: c.silverBg,
            backgroundImage:
              "radial-gradient(circle at 12% 8%, rgba(154,158,168,0.1), transparent 42%), radial-gradient(circle at 92% 0%, rgba(180,183,190,0.12), transparent 40%), linear-gradient(180deg, #F6F6F7 0%, #F1F2F4 50%, #E8E9EC 100%)",
            minHeight: "100vh",
            maxWidth: "100%",
            overflowX: "clip",
            color: c.textOnLight,
            textAlign: "start",
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
            outline: `3px solid ${c.accent}`,
            outlineOffset: 2,
          },
          ".skip-link": {
            position: "absolute",
            insetInlineStart: 12,
            top: 8,
            zIndex: 4000,
            padding: "10px 14px",
            background: c.steelMid,
            color: c.chromeBright,
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
      MuiPaper: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            backgroundImage: "none",
            "--Paper-shadow": "none",
            "--Paper-overlay": "none",
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            "--Paper-shadow": "none",
            "--Paper-overlay": "none",
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
              outline: `3px solid ${c.accent}`,
              outlineOffset: 2,
            },
          },
        },
      },
    },
  });
}
