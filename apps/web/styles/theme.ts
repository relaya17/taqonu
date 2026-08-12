"use client";

import { createTheme } from "@mui/material/styles";

export function createAtlasTheme(direction: "rtl" | "ltr") {
  return createTheme({
    direction,
    cssVariables: true,
    palette: {
      mode: "light",
      primary: {
        main: "#0F3D3E",
        contrastText: "#F4F7F5",
      },
      secondary: {
        main: "#C45C26",
      },
      background: {
        default: "#E8EEF0",
        paper: "#F7FAF8",
      },
      text: {
        primary: "#142022",
        secondary: "#3D5557",
      },
      success: { main: "#1F7A4D" },
      warning: { main: "#B7791F" },
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
          },
          body: {
            backgroundImage:
              "radial-gradient(circle at 12% 10%, rgba(196, 92, 38, 0.12), transparent 36%), radial-gradient(circle at 88% 0%, rgba(15, 61, 62, 0.16), transparent 42%), linear-gradient(180deg, #E8EEF0 0%, #D9E4E6 100%)",
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
            outline: "3px solid #C45C26",
            outlineOffset: 2,
          },
          ".skip-link": {
            position: "absolute",
            insetInlineStart: 12,
            top: 8,
            zIndex: 4000,
            padding: "10px 14px",
            background: "#0F3D3E",
            color: "#F4F7F5",
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
          // Encourage callers to set aria-label; size keeps 44px touch target.
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
              outline: "3px solid #C45C26",
              outlineOffset: 2,
            },
          },
        },
      },
    },
  });
}
