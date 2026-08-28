"use client";

import { useState, type MouseEvent } from "react";
import { Box, Button, Menu, MenuItem, Stack, Typography } from "@mui/material";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";

type LocaleCode = "he" | "en" | "ar";

interface LanguageOption {
  code: LocaleCode;
  native: string;
  short: string;
  dir: "rtl" | "ltr";
}

const LANGUAGES: LanguageOption[] = [
  { code: "he", native: "עברית", short: "HE", dir: "rtl" },
  { code: "en", native: "English", short: "EN", dir: "ltr" },
  { code: "ar", native: "العربية", short: "AR", dir: "rtl" },
];

interface LanguageSwitcherProps {
  tone?: "dark" | "light" | undefined;
  compact?: boolean | undefined;
  onSelect?: (() => void) | undefined;
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

  const colors = {
    dark: {
      text: "#E0E1E4",
      textMuted: "rgba(224, 225, 228, 0.72)",
      bg: "rgba(42, 48, 58, 0.98)",
      border: "rgba(210, 212, 216, 0.35)",
      hover: "rgba(154, 158, 168, 0.16)",
      selected: "rgba(154, 158, 168, 0.28)",
    },
    light: {
      text: "#1A1C22",
      textMuted: "rgba(26, 28, 34, 0.62)",
      bg: "#FFFFFF",
      border: "rgba(26, 28, 34, 0.16)",
      hover: "rgba(42, 46, 54, 0.07)",
      selected: "rgba(42, 46, 54, 0.12)",
    },
  }[tone];

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
    onSelect?.();
  };

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
          minWidth: compact ? 36 : 40,
          minHeight: 36,
          color: colors.textMuted,
          px: compact ? 0.75 : 1,
          "&:hover": { bgcolor: colors.hover, color: colors.text },
        }}
      >
        <LanguageOutlinedIcon fontSize="small" />
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
        PaperProps={{
          sx: {
            bgcolor: colors.bg,
            color: colors.text,
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
            onClick={handleClose}
            sx={{
              py: 1.25,
              color: colors.text,
              textAlign: "start",
              "&.Mui-selected": { bgcolor: colors.selected, fontWeight: 700 },
              "&:hover": { bgcolor: colors.hover },
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" width="100%" justifyContent="space-between">
              <Typography sx={{ fontWeight: locale === lang.code ? 700 : 500 }}>
                {lang.native}
              </Typography>
              <Typography variant="caption" sx={{ color: colors.textMuted }}>
                {lang.short}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
