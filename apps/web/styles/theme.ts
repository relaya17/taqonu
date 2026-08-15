"use client";

import { createTheme, type Theme } from "@mui/material/styles";
import { atlasChrome as c } from "@/styles/palette";

export type AtlasColorMode = "light" | "dark";

export function createAtlasTheme(
  direction: "rtl" | "ltr",
  mode: AtlasColorMode = "light",
): Theme {
  const dark = mode === "dark";
  return createTheme({
    direction,
    cssVariables: false,
    palette: {
      mode: dark ? "dark" : "light",
      primary: {
        main: dark ? c.accent : c.steelMid,
        contrastText: dark ? c.onAccent : c.chromeBright,
      },
      secondary: {
        main: c.accent,
        contrastText: c.onAccent,
      },
      background: {
        default: dark ? c.ink : c.silverBg,
        paper: dark ? c.steel : c.silverPaper,
      },
      text: {
        primary: dark ? "#F0F1F3" : c.textOnLight,
        secondary: dark ? c.chrome : c.textSecondaryOnLight,
      },
      divider: dark ? c.border : "rgba(26, 28, 34, 0.14)",
      success: { main: dark ? "#6BA88A" : "#3D7A5F" },
      warning: { main: dark ? "#C4A35A" : "#9A7B3C" },
      error: { main: dark ? "#E06B66" : "#B42318" },
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
            colorScheme: dark ? "dark" : "light",
          },
          body: {
            backgroundColor: dark ? c.ink : c.silverBg,
            backgroundImage: dark
              ? "radial-gradient(circle at 12% 8%, rgba(154,158,168,0.08), transparent 42%), radial-gradient(circle at 92% 0%, rgba(42,46,54,0.55), transparent 40%), linear-gradient(180deg, #12141A 0%, #16191F 55%, #12141A 100%)"
              : "radial-gradient(circle at 12% 8%, rgba(154,158,168,0.1), transparent 42%), radial-gradient(circle at 92% 0%, rgba(180,183,190,0.12), transparent 40%), linear-gradient(180deg, #F6F6F7 0%, #F1F2F4 50%, #E8E9EC 100%)",
            minHeight: "100vh",
            maxWidth: "100%",
            overflowX: "clip",
            color: dark ? c.text : c.textOnLight,
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
          outlined: dark
            ? {
                color: "#F0F1F3",
                borderColor: "rgba(240, 241, 243, 0.5)",
                "&:hover": {
                  borderColor: "#F0F1F3",
                  bgcolor: "rgba(240, 241, 243, 0.1)",
                },
              }
            : {},
          text: dark
            ? {
                color: c.chromeBright,
                "&:hover": { bgcolor: "rgba(240, 241, 243, 0.08)" },
              }
            : {},
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
      MuiAlert: {
        styleOverrides: {
          root: {
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 8,
            width: "100%",
          },
          icon: {
            margin: 0,
            padding: 0,
            marginRight: 0,
            marginLeft: 0,
            marginInline: 0,
          },
          message: {
            width: "100%",
            padding: 0,
            textAlign: "center",
          },
          action: {
            margin: 0,
            padding: 0,
            marginRight: 0,
            marginLeft: 0,
            paddingLeft: 0,
            paddingRight: 0,
            width: "100%",
            justifyContent: "center",
            "& .MuiButton-root": {
              width: "100%",
              maxWidth: 280,
            },
          },
        },
      },
    },
  });
}
