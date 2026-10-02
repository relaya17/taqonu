"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
  Button,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { useTranslations, useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import {
  WEB_NAV_PATHS,
  WEB_POST_AUTH_PATH,
  isMarketingShellPath,
  isPublicShellPath,
  requiresSignIn,
  asMuiHref,
} from "@/lib/studio-surfaces";
import {
  AUTH_SESSION_QUERY_KEY,
  fetchAuthSession,
  sessionGate,
} from "@/lib/auth-session";
import { authHrefWithNext } from "@/lib/audit-return-path";
import {
  NAV_GROUPS,
  isWebNavSelected,
  navItemHref,
  type WebNavKey,
} from "@/lib/web-nav";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { AiCompanionBar } from "@/components/layout/AiCompanionBar";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { PageContainer } from "@/components/layout/PageContainer";
import { SessionGateNotice } from "@/components/layout/SessionGateNotice";
import { useColorMode } from "@/components/providers/ColorModeProvider";
import { atlasChrome as c } from "@/styles/palette";

const DRAWER_WIDTH = 248;

type NavTone = "dark" | "light" | "sidebar";

/** Same glass as the small-screen top bar — drawer must not flip color when opened. */
const navChrome = {
  dark: {
    bgcolor: c.glassSoft,
    border: `1px solid ${c.border}`,
    color: c.text,
    textMuted: "rgba(232,234,238,0.75)",
    textSoft: "rgba(232,234,238,0.85)",
    accent: c.accent,
    chrome: c.chrome,
    brand: c.text,
    selectedBg: c.selected,
    hoverBg: c.hover,
    outlineBorder: "rgba(154,158,168,0.45)",
  },
  /** Product sidebar only: quieter than the near-black glass and bright labels. */
  sidebar: {
    bgcolor: "#2A303A",
    border: "1px solid rgba(160, 164, 172, 0.12)",
    color: "#A8AEB8",
    // Caption text on #2A303A: 0.85 → 4.75:1, 0.9 → 5.13:1 (WCAG AA 4.5:1).
    textMuted: "rgba(168, 174, 184, 0.85)",
    textSoft: "rgba(168, 174, 184, 0.9)",
    accent: "#9AA1AB",
    chrome: "#A7ADB6",
    brand: "#C2C6CD",
    selectedBg: "rgba(255, 255, 255, 0.06)",
    hoverBg: "rgba(255, 255, 255, 0.04)",
    outlineBorder: "rgba(160, 164, 172, 0.22)",
  },
  light: {
    bgcolor: "rgba(241, 242, 244, 0.94)",
    border: "1px solid rgba(26, 28, 34, 0.14)",
    color: c.textOnLight,
    // Caption text on the translucent light drawer stays ≥ 4.5:1 over dark content.
    textMuted: "rgba(26, 28, 34, 0.66)",
    textSoft: "rgba(26, 28, 34, 0.7)",
    accent: c.steelMid,
    chrome: c.textSecondaryOnLight,
    brand: c.textOnLight,
    selectedBg: "rgba(42, 46, 54, 0.12)",
    hoverBg: "rgba(42, 46, 54, 0.07)",
    outlineBorder: "rgba(42, 46, 54, 0.28)",
  },
} as const;

type NavKey = WebNavKey;

const PATHS: Record<NavKey, string> = WEB_NAV_PATHS;

interface ShellUser {
  email: string;
  displayName: string | null;
  role: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mode, toggleMode } = useColorMode();
  const mainRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Small screens: closed by default; hamburger opens overlay drawer. */
  const [navOpen, setNavOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        NAV_GROUPS.filter((group) => group.collapsedByDefault).map((group) => [
          group.id,
          true,
        ]),
      ),
  );
  const navId = useId();
  const dockedNavId = useId();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  /**
   * Physical "left". In RTL, MUI flips the anchor to "right" and
   * stylis-plugin-rtl flips the resulting `right: 0` back to `left: 0`, so the
   * docked paper is pinned with logical insets to stay over its flex slot.
   */
  const anchor = "left" as const;
  /** Desktop permanent nav can be hidden; mobile still uses the overlay drawer. */
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const meQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => fetchAuthSession<ShellUser>(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const gate = sessionGate(meQuery);
  const isPrivatePage = requiresSignIn(pathname);

  useEffect(() => {
    if (isPrivatePage && gate === "signed-out") {
      window.location.replace(
        `/${locale}${authHrefWithNext("/auth/login", pathname)}`,
      );
    }
  }, [isPrivatePage, gate, locale, pathname]);

  const planQuery = useQuery({
    queryKey: ["billing-plan"],
    queryFn: () =>
      apiGet<{ tier: "free" | "pro"; remainingCloudSlots: number }>(
        "/api/v1/billing/plan",
      ),
    enabled: meQuery.isSuccess,
    staleTime: 60_000,
    retry: false,
  });

  const isPublicDoor = isPublicShellPath(pathname);
  const isMarketing = isMarketingShellPath(pathname);
  const isStudioWorkspace =
    pathname === PATHS.studio || pathname.startsWith(`${PATHS.studio}/`);
  // Studio is a full-width workspace: the product sidebar starts collapsed
  // there (the menu button still opens it).
  useEffect(() => {
    if (isStudioWorkspace) setNavCollapsed(true);
  }, [isStudioWorkspace]);
  const showUpgradeCta = planQuery.data?.tier === "free";
  // Product nav (Studio / Checks / Systems) is signed-in only. Do not
  // default it open on /welcome or /auth — a signed-out visitor must not
  // see or click the working inventory before register/login. Hidden
  // while meQuery is still loading, not only after it confirms signed-out.
  const isAuthed = Boolean(meQuery.data?.user);
  const showProductNav = isAuthed && !isPublicDoor;
  // Private pages mount only after sign-in, so they never fire requests the
  // API is certain to reject.
  const pageBody =
    !isPrivatePage || gate === "signed-in" ? (
      children
    ) : (
      <SessionGateNotice
        gate={gate}
        retrying={meQuery.isFetching}
        onRetry={() => void meQuery.refetch()}
      />
    );

  const logout = async () => {
    await apiPost("/api/v1/auth/logout", {});
    window.location.href = `/${locale}/auth/login`;
  };

  const focusMain = (event?: MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    const main = mainRef.current ?? document.getElementById("main-content");
    main?.focus({ preventScroll: false });
    main?.scrollIntoView({ block: "start" });
  };

  const brandMark = (
    href: string,
    opts?: { onClick?: () => void; size?: "sm" | "md"; tone?: NavTone },
  ) => {
    const large = opts?.size !== "sm";
    const tone = navChrome[opts?.tone ?? "dark"];
    return (
      <Typography
        component={Link}
        href={href}
        locale={locale}
        onClick={opts?.onClick}
        aria-label={t("brand.name")}
        dir="ltr"
        sx={{
          fontFamily: '"Unbounded", "Syne", sans-serif',
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 0.92,
          color: tone.brand,
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "baseline",
          gap: "1px",
          borderRadius: 1,
          "&:focus-visible": {
            outline: `3px solid ${tone.brand}`,
            outlineOffset: 2,
          },
        }}
      >
        <Box
          component="span"
          sx={{ fontSize: large ? "1.4rem" : "0.98rem", fontWeight: 800 }}
        >
          A
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: large ? "0.95rem" : "0.78rem",
            fontWeight: 600,
            opacity: 0.88,
          }}
        >
          rlet
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: large ? "1.28rem" : "0.95rem",
            fontWeight: 800,
            color: tone.chrome,
          }}
        >
          OS
        </Box>
      </Typography>
    );
  };

  const themeToggle = (opts?: { tone?: NavTone }) => {
    const tone = navChrome[opts?.tone ?? "dark"];
    const goDark = mode !== "dark";
    return (
      <IconButton
        size="small"
        onClick={toggleMode}
        aria-label={goDark ? t("a11y.themeDark") : t("a11y.themeLight")}
        title={t("nav.theme")}
        sx={{ color: tone.textMuted }}
      >
        {goDark ? (
          <DarkModeOutlinedIcon fontSize="small" />
        ) : (
          <LightModeOutlinedIcon fontSize="small" />
        )}
      </IconButton>
    );
  };

  const langMenu = (
    menuId: string,
    opts?: { mobile?: boolean; tone?: NavTone; dense?: boolean },
  ) => {
    const toneKey = opts?.tone === "light" ? "light" : "dark";
    return (
      <LanguageSwitcher
        tone={toneKey}
        compact={opts?.mobile}
        dense={opts?.dense}
        menuId={menuId}
        onSelect={opts?.mobile ? () => setNavOpen(false) : undefined}
      />
    );
  };

  const nav = (opts: { mobile: boolean; tone?: NavTone }) => {
    const tone = navChrome[opts.tone ?? "dark"];
    return (
      <>
        <Stack spacing={0.75} sx={{ px: 1.5, mb: 3 }}>
          {opts.mobile ? null : (
            <Stack direction="row" justifyContent="flex-end">
              <IconButton
                size="small"
                aria-label={t("a11y.closeMenu")}
                onClick={() => setNavCollapsed(true)}
                sx={{ color: tone.textMuted, mt: -0.5, me: -0.5 }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          )}
          <Typography
            variant="caption"
            sx={{ textAlign: "start", color: tone.textMuted }}
          >
            {t("brand.codename")} · {t("brand.tagline")}
          </Typography>
        </Stack>

        <Box component="nav" aria-label={t("nav.main")}>
          {NAV_GROUPS.map((group) => {
            const groupSelected = group.items.some((key) =>
              isWebNavSelected(key, pathname, searchParams),
            );
            const collapsed =
              Boolean(group.collapsedByDefault) &&
              collapsedGroups[group.id] !== false &&
              !groupSelected;
            return (
            <Box key={group.id} sx={{ mb: group.labelKey ? 1.5 : 0.5 }}>
              {group.labelKey ? (
                <Typography
                  component={group.collapsedByDefault ? "button" : "span"}
                  variant="caption"
                  aria-expanded={group.collapsedByDefault ? !collapsed : undefined}
                  onClick={
                    group.collapsedByDefault
                      ? () =>
                          setCollapsedGroups((prev) => ({
                            ...prev,
                            [group.id]: prev[group.id] === false,
                          }))
                      : undefined
                  }
                  sx={{
                    display: "block",
                    width: "100%",
                    textAlign: "start",
                    background: "none",
                    border: 0,
                    cursor: group.collapsedByDefault ? "pointer" : "default",
                    px: 1.5,
                    pt: 1,
                    pb: 0.5,
                    color: tone.accent,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    fontSize: 11,
                    fontWeight: 550,
                  }}
                >
                  {t(`nav.${group.labelKey}`)}
                  {group.collapsedByDefault
                    ? collapsed
                      ? " ▸"
                      : " ▾"
                    : ""}
                </Typography>
              ) : null}
              {collapsed ? null : (
              <List dense disablePadding>
                {group.items.map((key) => {
                  const href = navItemHref(key, searchParams.get("project"));
                  const selected = isWebNavSelected(key, pathname, searchParams);
                  return (
                    // Real <li> wrapper (WCAG 1.3.1 "list" rule — axe-core
                    // flagged the previous markup, an <a> as a direct child
                    // of <ul class="MuiList-root">, as invalid list
                    // structure). ListItemButton alone doesn't render an
                    // <li>; MUI's documented fix is to wrap it in
                    // ListItem disablePadding.
                    <ListItem key={key} disablePadding>
                      <ListItemButton
                        component={Link}
                        href={asMuiHref(href)}
                        selected={selected}
                        aria-current={selected ? "page" : undefined}
                        onClick={opts.mobile ? () => setNavOpen(false) : undefined}
                        sx={{
                          borderRadius: 2,
                          mb: 0.5,
                          pl: group.labelKey ? 2.5 : 1.5,
                          color: tone.color,
                          "&.Mui-selected": {
                            backgroundColor: tone.selectedBg,
                            color: tone.brand,
                          },
                          "&.Mui-selected:hover": {
                            backgroundColor: tone.hoverBg,
                          },
                          "&.Mui-selected .MuiListItemText-primary": {
                            fontWeight: 600,
                            color: tone.brand,
                          },
                          "&:hover": {
                            backgroundColor: tone.hoverBg,
                          },
                        }}
                      >
                        <ListItemText
                          primary={t(`nav.${key}`)}
                          primaryTypographyProps={{
                            fontSize: { xs: 13, sm: 14 },
                            color: "inherit",
                          }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
              )}
            </Box>
            );
          })}
        </Box>

        <Stack spacing={1} sx={{ mt: "auto", px: 1, pt: 3 }}>
          {showUpgradeCta ? (
            <Button
              component={Link}
              href="/plan"
              size="small"
              variant="contained"
              onClick={opts.mobile ? () => setNavOpen(false) : undefined}
              sx={{
                fontWeight: 700,
                bgcolor: c.accent,
                color: c.onAccent,
                "&:hover": { bgcolor: c.accentHover },
              }}
            >
              {t("nav.upgradePro")}
            </Button>
          ) : null}
          {meQuery.data?.user ? (
            <Box>
              <Typography
                variant="caption"
                sx={{ display: "block", color: tone.textSoft }}
              >
                {meQuery.data.user.displayName ?? meQuery.data.user.email}
              </Typography>
              <Button
                size="small"
                onClick={() => void logout()}
                sx={{ mt: 0.5, color: tone.accent }}
              >
                {t("auth.logout")}
              </Button>
              {meQuery.data.user.role === "admin" ? (
                <Button
                  size="small"
                  href="/admin"
                  sx={{ color: tone.color, display: "block" }}
                >
                  {t("nav.admin")}
                </Button>
              ) : null}
              <Button
                size="small"
                href="/investors"
                sx={{ color: tone.chrome, display: "block" }}
              >
                {t("dashboard.investors")}
              </Button>
            </Box>
          ) : (
            <Stack spacing={1}>
              <Button
                size="small"
                variant="contained"
                onClick={() => {
                  if (opts.mobile) setNavOpen(false);
                  window.location.assign(`/${locale}/welcome`);
                }}
                sx={{
                  fontWeight: 700,
                  bgcolor: c.accent,
                  color: c.onAccent,
                  "&:hover": { bgcolor: c.accentHover },
                }}
              >
                {t("nav.welcome")}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (opts.mobile) setNavOpen(false);
                  window.location.assign(`/${locale}/auth/login`);
                }}
                sx={{
                  borderColor: tone.outlineBorder,
                  color: tone.color,
                }}
              >
                {t("auth.login")}
              </Button>
            </Stack>
          )}
          <Stack
            direction="row"
            alignItems="center"
            spacing={0}
            sx={{ pt: 1, display: { xs: "none", md: "flex" } }}
          >
            {themeToggle({ tone: opts.tone ?? "dark" })}
            {langMenu("atlas-lang-menu", {
              mobile: opts.mobile,
              tone: opts.tone ?? "dark",
            })}
          </Stack>
        </Stack>
      </>
    );
  };

  const drawerPaperSx = (tone: NavTone) => {
    const chrome = navChrome[tone];
    return {
      width: DRAWER_WIDTH,
      maxWidth: "100vw",
      border: 0,
      borderInlineEnd: chrome.border,
      backgroundColor: chrome.bgcolor,
      backgroundImage: "none",
      backdropFilter: tone === "sidebar" ? "none" : "blur(18px) saturate(1.15)",
      WebkitBackdropFilter: tone === "sidebar" ? "none" : "blur(18px) saturate(1.15)",
      boxShadow: "none",
      color: chrome.color,
      py: 2.5,
      px: 1.5,
      display: "flex",
      flexDirection: "column" as const,
      overflowX: "hidden" as const,
      "--Paper-shadow": "none",
      "--Paper-overlay": "none",
      "& :focus-visible, & .MuiButtonBase-root.Mui-focusVisible": {
        outlineColor: chrome.brand,
      },
    };
  };

  const drawerPaperProps = {
    "aria-label": t("nav.main"),
    component: "aside" as const,
    elevation: 0 as const,
    square: true as const,
    style: {
      ["--Paper-shadow" as string]: "none",
      ["--Paper-overlay" as string]: "none",
    },
  };

  if (isMarketing) {
    const marketingTone = navChrome.dark;
    return (
      <Box
        sx={{
          minHeight: "100vh",
          width: "100%",
          maxWidth: "100%",
          overflowX: "clip",
          bgcolor: c.ink,
        }}
      >
        <Box
          component="header"
          sx={{
            position: "fixed",
            top: 0,
            insetInline: 0,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            px: { xs: 1.5, sm: 2, md: 3 },
            py: { xs: 1, sm: 1.5 },
            flexWrap: "wrap",
            bgcolor: marketingTone.bgcolor,
            borderBottom: marketingTone.border,
            backdropFilter: "blur(16px) saturate(1.1)",
            WebkitBackdropFilter: "blur(16px) saturate(1.1)",
          }}
        >
          {brandMark("/welcome", { size: "sm", tone: "dark" })}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button
                component={Link}
                href="/plan"
                size="small"
                sx={{
                  color: marketingTone.chrome,
                  fontWeight: 650,
                  display: { xs: "none", sm: "inline-flex" },
                }}
              >
                {t("landing.ctaPricing")}
              </Button>
              {isAuthed ? (
                <Button
                  component={Link}
                  href={WEB_POST_AUTH_PATH}
                  size="small"
                  variant="contained"
                  sx={{
                    bgcolor: c.accent,
                    color: c.onAccent,
                    fontWeight: 700,
                    "&:hover": { bgcolor: c.accentHover },
                  }}
                >
                  {t("landing.ctaContinue")}
                </Button>
              ) : (
                <>
                  <Button
                    component="a"
                    href={`/${locale}/auth/register`}
                    size="small"
                    variant="contained"
                    sx={{
                      bgcolor: c.accent,
                      color: c.onAccent,
                      fontWeight: 700,
                      "&:hover": { bgcolor: c.accentHover },
                    }}
                  >
                    {t("auth.register")}
                  </Button>
                  <Button
                    component="a"
                    href={`/${locale}/auth/login`}
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: marketingTone.outlineBorder,
                      color: marketingTone.color,
                      fontWeight: 650,
                    }}
                  >
                    {t("auth.login")}
                  </Button>
                </>
              )}
            </Stack>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0}
              sx={{
                color: marketingTone.color,
                "& .MuiIconButton-root": {
                  minWidth: 36,
                  minHeight: 36,
                  p: 0.5,
                },
              }}
            >
              {themeToggle({ tone: "dark" })}
              {langMenu("atlas-lang-menu-marketing", { tone: "dark" })}
            </Stack>
          </Stack>
        </Box>
        <Box
          component="main"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          aria-label={t("a11y.mainContent")}
          sx={{ outline: "none" }}
        >
          {children}
        </Box>
      </Box>
    );
  }

  const appMobileToneKey: NavTone = mode === "dark" ? "sidebar" : "light";
  const appMobileTone = navChrome[appMobileToneKey];

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100%",
        overflowX: "clip",
      }}
    >
      <a href="#main-content" className="skip-link" onClick={focusMain}>
        {t("a11y.skipToContent")}
      </a>

      {showProductNav ? (
        <>
          {/* Mobile: same light chrome as top bar — no color flip when opened */}
          <Drawer
            variant="temporary"
            anchor={anchor}
            open={navOpen}
            onClose={() => setNavOpen(false)}
            ModalProps={{ keepMounted: false }}
            sx={{
              display: { xs: "block", md: "none" },
              [`& .MuiDrawer-paper`]: drawerPaperSx(appMobileToneKey),
            }}
            PaperProps={{
              ...drawerPaperProps,
              id: navId,
            }}
          >
            <Stack direction="row" justifyContent="flex-end" sx={{ px: 0.5, pt: 0.5 }}>
              <IconButton
                aria-label={t("a11y.closeMenu")}
                onClick={() => setNavOpen(false)}
                sx={{ color: "inherit" }}
              >
                <CloseIcon />
              </IconButton>
            </Stack>
            {nav({ mobile: true, tone: appMobileToneKey })}
          </Drawer>

          {/* Desktop: docked sidebar — closable; hidden when collapsed */}
          <Drawer
            variant="permanent"
            anchor={anchor}
            open
            sx={{
              display: {
                xs: "none",
                md: navCollapsed ? "none" : "block",
              },
              width: DRAWER_WIDTH,
              flexShrink: 0,
              [`& .MuiDrawer-paper`]: {
                ...drawerPaperSx("sidebar"),
                insetInlineStart: 0,
                insetInlineEnd: "auto",
              },
            }}
            PaperProps={{ ...drawerPaperProps, id: dockedNavId }}
          >
            {nav({ mobile: false, tone: "sidebar" })}
          </Drawer>
        </>
      ) : null}

      <Box
        component="main"
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        aria-label={t("a11y.mainContent")}
        sx={{
          flex: 1,
          minWidth: 0,
          width: {
            xs: "100%",
            md:
              navCollapsed || !showProductNav
                ? "100%"
                : `calc(100% - ${DRAWER_WIDTH}px)`,
          },
          maxWidth: "100%",
          overflowX: "clip",
          // Studio is a full-bleed workspace: no page padding around it.
          p: isStudioWorkspace ? 0 : { xs: 1.5, sm: 2.5, md: 3 },
          pb: isStudioWorkspace ? 0 : { xs: 3, md: 5 },
          outline: "none",
          textAlign: "start",
        }}
      >
        <Box
          component="header"
          sx={{
            mb: isStudioWorkspace ? 0 : 2,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mt: isStudioWorkspace ? 0 : { xs: -1.5, sm: -2.5, md: -3 },
            mx: isStudioWorkspace ? 0 : { xs: -1.5, sm: -2.5, md: -3 },
            px: { xs: 1.5, sm: 2, md: 3 },
            minHeight: 56,
            bgcolor: appMobileTone.bgcolor,
            borderBottom: appMobileTone.border,
            backdropFilter: "blur(16px) saturate(1.1)",
            WebkitBackdropFilter: "blur(16px) saturate(1.1)",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.5}
            sx={{
              flexShrink: 0,
              "& .MuiIconButton-root": {
                minHeight: 44,
                color: appMobileTone.textMuted,
              },
            }}
          >
            {showProductNav ? (
              <IconButton
                ref={menuButtonRef}
                edge="start"
                onClick={() => {
                  if (isDesktop) {
                    setNavCollapsed((collapsed) => !collapsed);
                    return;
                  }
                  setNavOpen(true);
                }}
                aria-label={t("a11y.openMenu")}
                aria-expanded={isDesktop ? !navCollapsed : navOpen}
                aria-controls={isDesktop ? dockedNavId : navId}
                sx={{ minWidth: 44, p: 0.5 }}
              >
                <MenuIcon />
              </IconButton>
            ) : null}
            <Stack
              direction="row"
              alignItems="center"
              spacing={0}
              sx={{ "&& .MuiIconButton-root": { minWidth: 32, width: 32, p: 0 } }}
            >
              {langMenu("atlas-lang-menu-header", {
                tone: appMobileToneKey,
                dense: true,
              })}
              {themeToggle({ tone: appMobileToneKey })}
            </Stack>
          </Stack>
          {brandMark(isAuthed ? WEB_POST_AUTH_PATH : "/welcome", { size: "sm", tone: appMobileToneKey })}
        </Box>
        {showProductNav && !isStudioWorkspace ? (
          <PageContainer maxWidth={920} noPadding>
            <AiCompanionBar />
          </PageContainer>
        ) : null}
        <PageContainer
          maxWidth={isStudioWorkspace ? "full" : 920}
          noPadding={isStudioWorkspace}
          sx={{
            mb: isStudioWorkspace ? 0 : { xs: 2, md: 3 },
            ...(isStudioWorkspace
              ? {}
              : {
                  bgcolor: mode === "dark" ? "rgba(42, 48, 58, 0.6)" : "rgba(250, 250, 250, 0.66)",
                  backdropFilter: "blur(18px) saturate(1.15)",
                  WebkitBackdropFilter: "blur(18px) saturate(1.15)",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                }),
            textAlign: "start",
            minWidth: 0,
          }}
        >
          {pageBody}
        </PageContainer>
      </Box>
    </Box>
  );
}
