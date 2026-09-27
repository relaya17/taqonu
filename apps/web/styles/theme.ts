"use client";

import { createTheme, type Theme } from "@mui/material/styles";
import { atlasChrome as c, atlasStatus as status } from "@/styles/palette";

export type AtlasColorMode = "light" | "dark";

export function createAtlasTheme(
  direction: "rtl" | "ltr",
  mode: AtlasColorMode = "light",
): Theme {
  const dark = mode === "dark";
  const focusRing = dark ? c.chromeBright : c.accent;
  return createTheme({
    direction,
    cssVariables: false,
    palette: {
      mode: dark ? "dark" : "light",
      primary: {
        main: dark ? c.chromeBright : c.steelMid,
        contrastText: dark ? c.ink : c.chromeBright,
      },
      secondary: {
        main: dark ? c.chrome : c.accent,
        contrastText: dark ? c.ink : c.onAccent,
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
        main: dark ? status.errorOnDark : status.errorDark,
        light: status.errorLight,
        dark: status.errorDark,
        contrastText: dark ? c.textOnLight : status.errorText,
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
            outline: `3px solid ${focusRing}`,
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
      // ButtonBase sets `outline: 0`, so the global :focus-visible ring
      // never reaches MUI buttons, links, tabs, or list items.
      MuiButtonBase: {
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": {
              outline: `3px solid ${focusRing}`,
              outlineOffset: 2,
            },
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            // The tab scroller clips overflow; draw the ring inside the tab.
            "&&.Mui-focusVisible": { outlineOffset: -3 },
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
              outline: `3px solid ${focusRing}`,
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
            backdropFilter: "blur(14px) saturate(1.2)",
            WebkitBackdropFilter: "blur(14px) saturate(1.2)",
            ...(dark
              ? { "& a:not(.MuiButton-root), & .MuiButton-text": { color: "inherit" } }
              : {}),
          },
          // Dark mode: translucent tinted glass with light text (>= 10:1 on the
          // darkest composite); light mode keeps the tinted surfaces, translucent.
          standardSuccess: dark
            ? {
                backgroundColor: "rgba(90, 138, 110, 0.16)",
                borderColor: "rgba(143, 194, 163, 0.35)",
                color: "#F0F1F3",
                "& .MuiAlert-icon": { color: "#8FC2A3" },
              }
            : {
                backgroundColor: "rgba(232, 242, 236, 0.78)",
                borderColor: `${status.successMain}33`,
                color: status.successText,
                "& .MuiAlert-icon": { color: status.successMain },
              },
          standardWarning: dark
            ? {
                backgroundColor: "rgba(176, 139, 74, 0.16)",
                borderColor: "rgba(227, 190, 122, 0.38)",
                color: "#F0F1F3",
                "& .MuiAlert-icon": { color: "#E3BE7A" },
              }
            : {
                backgroundColor: "rgba(253, 244, 231, 0.8)",
                borderColor: `${status.warningMain}33`,
                color: status.warningText,
                "& .MuiAlert-icon": { color: status.warningMain },
              },
          standardError: dark
            ? {
                backgroundColor: "rgba(181, 90, 84, 0.18)",
                borderColor: "rgba(224, 131, 125, 0.4)",
                color: "#F0F1F3",
                "& .MuiAlert-icon": { color: status.errorOnDark },
              }
            : {
                backgroundColor: "rgba(250, 237, 236, 0.8)",
                borderColor: `${status.errorMain}33`,
                color: status.errorDark,
                "& .MuiAlert-icon": { color: status.errorMain },
              },
          standardInfo: dark
            ? {
                backgroundColor: "rgba(90, 115, 144, 0.18)",
                borderColor: "rgba(159, 180, 204, 0.38)",
                color: "#F0F1F3",
                "& .MuiAlert-icon": { color: "#9FB4CC" },
              }
            : {
                backgroundColor: "rgba(237, 241, 245, 0.78)",
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
