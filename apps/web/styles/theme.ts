"use client";

import { createTheme, type Theme } from "@mui/material/styles";
import { atlasChrome as c, atlasStatus as status } from "@/styles/palette";

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
      divider: dark ? "rgba(232, 234, 238, 0.32)" : "rgba(26, 28, 34, 0.14)",
      // Soft semantic status colors — calm, professional, accessible
      success: {
        main: status.successDark,
        light: status.successLight,
        dark: status.successDark,
        contrastText: "#FFFFFF",
      },
      warning: {
        main: dark ? status.warningMain : status.warningDark,
        light: status.warningLight,
        dark: status.warningDark,
        contrastText: dark ? status.warningText : "#FFFFFF",
      },
      error: {
        main: dark ? status.errorMain : status.errorDark,
        light: status.errorLight,
        dark: status.errorDark,
        contrastText: status.errorText,
      },
      info: {
        main: dark ? status.infoMain : status.infoDark,
        light: status.infoLight,
        dark: status.infoDark,
        contrastText: status.infoText,
      },
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
        lineHeight: 1.3,
      },
      h3: {
        fontWeight: 600,
        fontSize: "clamp(1.1rem, 2vw, 1.25rem)",
        lineHeight: 1.35,
      },
      h4: {
        fontWeight: 600,
        fontSize: "clamp(1rem, 1.5vw, 1.1rem)",
        lineHeight: 1.4,
      },
      h5: {
        fontWeight: 600,
        fontSize: "clamp(0.9rem, 1.25vw, 1rem)",
        lineHeight: 1.4,
      },
      h6: {
        fontWeight: 600,
        fontSize: "clamp(0.85rem, 1vw, 0.95rem)",
        lineHeight: 1.45,
      },
      body1: {
        fontSize: "clamp(0.9rem, 1.25vw, 1rem)",
        lineHeight: 1.6,
      },
      body2: {
        fontSize: "clamp(0.8rem, 1vw, 0.875rem)",
        lineHeight: 1.55,
      },
      caption: {
        fontSize: "clamp(0.7rem, 0.85vw, 0.75rem)",
        lineHeight: 1.5,
      },
      button: {
        textTransform: "none",
        fontWeight: 600,
        fontSize: "clamp(0.8rem, 1vw, 0.9rem)",
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
              ? "radial-gradient(circle at 12% 8%, rgba(154,158,168,0.12), transparent 42%), linear-gradient(180deg, #1A1E26 0%, #12141A 100%)"
              : "radial-gradient(circle at 12% 8%, rgba(154,158,168,0.1), transparent 42%), radial-gradient(circle at 92% 0%, rgba(180,183,190,0.12), transparent 40%), linear-gradient(180deg, #F6F6F7 0%, #F1F2F4 50%, #E8E9EC 100%)",
            minHeight: "100vh",
            maxWidth: "100%",
            overflowX: "clip",
            color: dark ? c.text : c.textOnLight,
            textAlign: "start",
          },
          "p, li, label, td, th, input, textarea, .MuiFormHelperText-root, .MuiInputBase-input, .MuiFormLabel-root":
            {
              textAlign: "start",
            },
          "h1, h2, .MuiTypography-h1, .MuiTypography-h2": {
            textAlign: "center",
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
          contained: dark
            ? {
                bgcolor: c.chromeBright,
                color: c.ink,
                "&:hover": { bgcolor: "#E8EAEE" },
                "&.Mui-disabled": {
                  bgcolor: "rgba(210, 212, 216, 0.28)",
                  color: "rgba(18, 20, 26, 0.55)",
                },
              }
            : {},
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
      MuiTextField: {
        defaultProps: {
          variant: "outlined",
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: dark ? "#343B48" : "#FFFFFF",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: dark ? "rgba(232, 234, 238, 0.42)" : "rgba(26, 28, 34, 0.28)",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: dark ? c.chromeBright : c.steelMid,
            },
          },
          input: {
            textAlign: "start",
            color: dark ? "#F4F5F7" : c.textOnLight,
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            textAlign: "start",
            color: dark ? c.chrome : c.textSecondaryOnLight,
          },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            textAlign: "start",
            color: dark ? c.chromeBright : c.textSecondaryOnLight,
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
        defaultProps: {
          variant: "standard",
        },
        styleOverrides: {
          root: {
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            textAlign: "start",
            gap: 8,
            width: "100%",
            borderRadius: 10,
            border: "1px solid",
            borderColor: "transparent",
          },
          standardSuccess: {
            backgroundColor: status.successLight,
            borderColor: `${status.successMain}33`,
            color: status.successText,
            "& .MuiAlert-icon": { color: status.successMain },
          },
          standardWarning: {
            backgroundColor: status.warningLight,
            borderColor: `${status.warningMain}33`,
            color: status.warningText,
            "& .MuiAlert-icon": { color: status.warningMain },
          },
          standardError: {
            backgroundColor: status.errorLight,
            borderColor: `${status.errorMain}33`,
            color: status.errorDark,
            "& .MuiAlert-icon": { color: status.errorMain },
          },
          standardInfo: {
            backgroundColor: status.infoLight,
            borderColor: `${status.infoMain}33`,
            color: status.infoDark,
            "& .MuiAlert-icon": { color: status.infoMain },
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
            textAlign: "start",
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
