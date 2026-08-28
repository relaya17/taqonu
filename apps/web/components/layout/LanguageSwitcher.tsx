"use client";

import { useState, type MouseEvent } from "react";
import { Box, Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

type LocaleCode = "he" | "en" | "ar";

interface LanguageOption {
  code: LocaleCode;
  native: string;
  english: string;
  dir: "rtl" | "ltr";
}

const LANGUAGES: LanguageOption[] = [
  { code: "he", native: "עברית", english: "Hebrew", dir: "rtl" },
  { code: "en", native: "English", english: "English", dir: "ltr" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl" },
];

interface LanguageSwitcherProps {
  /** Visual tone for dark/light backgrounds */
  tone?: "dark" | "light" | undefined;
  /** Compact mode - icon only */
  compact?: boolean | undefined;
  /** On mobile (close nav drawer on selection) */
  onSelect?: (() => void) | undefined;
  /** Menu ID for accessibility */
  menuId?: string | undefined;
}

export function LanguageSwitcher({
  tone = "dark",
  compact = false,
  onSelect,
  menuId = "atlas-lang-menu",
}: LanguageSwitcherProps) {
  const t = useTranslations();
  const locale = useLocale() as LocaleCode;
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const currentLang = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[1]!;

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = () => {
    handleClose();
    onSelect?.();
  };

  const colors = {
    dark: {
      text: "#E0E1E4",
      textMuted: "rgba(224, 225, 228, 0.7)",
      bg: "rgba(22, 25, 31, 0.95)",
      border: "rgba(160, 164, 172, 0.22)",
      hover: "rgba(154, 158, 168, 0.12)",
      selected: "rgba(154, 158, 168, 0.18)",
    },
    light: {
      text: "#1A1C22",
      textMuted: "rgba(26, 28, 34, 0.7)",
      bg: "rgba(250, 250, 250, 0.98)",
      border: "rgba(26, 28, 34, 0.12)",
      hover: "rgba(42, 46, 54, 0.06)",
      selected: "rgba(42, 46, 54, 0.10)",
    },
  }[tone];

  if (compact) {
    return (
      <>
        <Button
          size="small"
          onClick={handleOpen}
          aria-label={t("nav.languages")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          sx={{
            minWidth: 44,
            minHeight: 44,
            color: colors.text,
            "&:hover": { bgcolor: colors.hover },
          }}
        >
          <LanguageOutlinedIcon fontSize="small" />
        </Button>
        <Menu
          id={menuId}
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          transformOrigin={{ vertical: "top", horizontal: "center" }}
          PaperProps={{
            sx: {
              bgcolor: colors.bg,
              color: colors.text,
              backdropFilter: "blur(12px)",
              border: `1px solid ${colors.border}`,
              minWidth: 160,
            },
          }}
        >
          {LANGUAGES.map((lang) => (
            <MenuItem
              key={lang.code}
              component={Link}
              href={pathname}
              locale={lang.code}
              selected={locale === lang.code}
              lang={lang.code}
              dir={lang.dir}
              onClick={handleSelect}
              sx={{
                py: 1.25,
                color: colors.text,
                "&.Mui-selected": {
                  bgcolor: colors.selected,
                  fontWeight: 600,
                },
                "&:hover": { bgcolor: colors.hover },
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" width="100%">
                <Typography sx={{ fontWeight: 600 }}>{lang.native}</Typography>
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {lang.english}
                </Typography>
              </Stack>
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  }

  return (
    <>
      <Button
        size="small"
        onClick={handleOpen}
        aria-label={t("nav.languages")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        startIcon={<LanguageOutlinedIcon fontSize="small" />}
        endIcon={<KeyboardArrowDownIcon fontSize="small" />}
        sx={{
          color: colors.text,
          textTransform: "none",
          fontWeight: 500,
          px: 1.5,
          "&:hover": { bgcolor: colors.hover },
        }}
      >
        <Box component="span" dir={currentLang.dir} lang={currentLang.code}>
          {currentLang.native}
        </Box>
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        PaperProps={{
          sx: {
            bgcolor: colors.bg,
            color: colors.text,
            backdropFilter: "blur(12px)",
            border: `1px solid ${colors.border}`,
            minWidth: 180,
            mt: 0.5,
          },
        }}
      >
        {LANGUAGES.map((lang) => (
          <MenuItem
            key={lang.code}
            component={Link}
            href={pathname}
            locale={lang.code}
            selected={locale === lang.code}
            lang={lang.code}
            dir={lang.dir}
            onClick={handleSelect}
            sx={{
              py: 1.25,
              color: colors.text,
              "&.Mui-selected": {
                bgcolor: colors.selected,
                fontWeight: 600,
              },
              "&:hover": { bgcolor: colors.hover },
            }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              alignItems="center"
              justifyContent="space-between"
              width="100%"
            >
              <Typography sx={{ fontWeight: locale === lang.code ? 700 : 500 }}>
                {lang.native}
              </Typography>
              {locale !== lang.code && (
                <Typography variant="caption" sx={{ color: colors.textMuted }}>
                  {lang.english}
                </Typography>
              )}
              {locale === lang.code && (
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: "currentColor",
                    opacity: 0.6,
                  }}
                />
              )}
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
