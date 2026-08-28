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
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { useTranslations, useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/routing";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { AiCompanionBar } from "@/components/layout/AiCompanionBar";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { PageContainer } from "@/components/layout/PageContainer";
import { useColorMode } from "@/components/providers/ColorModeProvider";
import { atlasChrome as c } from "@/styles/palette";

const DRAWER_WIDTH = 248;

type NavTone = "dark" | "light";

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
  light: {
    bgcolor: "rgba(241, 242, 244, 0.94)",
    border: "1px solid rgba(26, 28, 34, 0.14)",
    color: c.textOnLight,
    textMuted: "rgba(26, 28, 34, 0.58)",
    textSoft: "rgba(26, 28, 34, 0.7)",
    accent: c.steelMid,
    chrome: c.textSecondaryOnLight,
    brand: c.textOnLight,
    selectedBg: "rgba(42, 46, 54, 0.12)",
    hoverBg: "rgba(42, 46, 54, 0.07)",
    outlineBorder: "rgba(42, 46, 54, 0.28)",
  },
} as const;

type NavKey =
  | "dashboard"
  | "projects"
  | "systems"
  | "studio"
  | "workbench"
  | "agents"
  | "partners"
  | "patches"
  | "health"
  | "truth"
  | "observer"
  | "sentinel"
  | "readiness"
  | "qa"
  | "processAudit"
  | "models"
  | "experts"
  | "memory"
  | "decisions"
  | "integrations"
  | "plan"
  | "welcome"
  | "legalMedia"
  | "settings";

const PATHS: Record<NavKey, string> = {
  dashboard: "/",
  projects: "/projects",
  systems: "/systems",
  studio: "/studio",
  workbench: "/workbench",
  agents: "/agents",
  partners: "/partners",
  patches: "/patches",
  health: "/health",
  truth: "/truth",
  observer: "/observer",
  sentinel: "/sentinel",
  readiness: "/readiness",
  qa: "/qa",
  processAudit: "/process-audit",
  models: "/models",
  experts: "/experts",
  memory: "/memory",
  decisions: "/decisions",
  integrations: "/integrations",
  plan: "/plan",
  welcome: "/welcome",
  legalMedia: "/legal-media",
  settings: "/settings",
};

/** Slim primary nav — state/chat/agent/proof removed; QA+health under dashboard ops. */
const NAV_GROUPS: readonly {
  readonly id: string;
  readonly labelKey?: "opsGroup" | "workspaceGroup" | "buildGroup";
  readonly collapsedByDefault?: boolean;
  readonly items: readonly NavKey[];
}[] = [
  {
    id: "main",
    items: ["systems", "dashboard", "projects", "plan"],
  },
  {
    id: "ops",
    labelKey: "opsGroup",
    items: ["truth", "health", "readiness", "qa", "processAudit", "observer", "sentinel"],
  },
  {
    id: "build",
    labelKey: "buildGroup",
    collapsedByDefault: true,
    items: ["studio", "workbench", "agents", "experts"],
  },
  {
    id: "workspace",
    labelKey: "workspaceGroup",
    items: ["models", "integrations", "partners", "legalMedia", "settings"],
  },
];

function isNavSelected(key: NavKey, pathname: string): boolean {
  if (key === "projects" && /\/projects\/[^/]+\/state$/.test(pathname)) {
    return false;
  }
  const href = PATHS[key];
  if (!href || !pathname) {
    return false;
  }
  if (href === "/") {
    return pathname === "/";
  }
  const pathOnly = href.split("?")[0] ?? href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

interface AuthMe {
  authenticated?: boolean;
  user: { email: string; displayName: string | null; role: string };
  role?: string;
  capabilities?: string[];
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const { mode, toggleMode } = useColorMode();
  const isRtl = locale === "he" || locale === "ar";
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
  const anchor = isRtl ? "right" : "left";

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  const meQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const session = await apiGet<
        AuthMe & { authenticated: boolean; user: AuthMe["user"] | null }
      >("/api/v1/auth/session");
      if (!session.authenticated || !session.user) {
        throw new Error("Not signed in");
      }
      return {
        authenticated: true as const,
        user: session.user,
        role: session.role ?? session.user.role,
        capabilities: session.capabilities ?? [],
      };
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

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

  const isMarketing =
    pathname === "/welcome" || pathname.startsWith("/welcome/");
  const showUpgradeCta = planQuery.data?.tier === "free";

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
            outline: `3px solid ${c.accent}`,
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

  const langMenu = (menuId: string, opts?: { mobile?: boolean; tone?: NavTone }) => {
    const toneKey = opts?.tone ?? "dark";
    return (
      <LanguageSwitcher
        tone={toneKey}
        compact={opts?.mobile}
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
          {brandMark("/", {
            ...(opts.mobile ? { onClick: () => setNavOpen(false) } : {}),
            tone: opts.tone ?? "dark",
          })}
          <Typography
            variant="caption"
            sx={{ opacity: 0.7, textAlign: "start", color: tone.textMuted }}
          >
            {t("brand.codename")} · {t("brand.tagline")}
          </Typography>
        </Stack>

        <Box component="nav" aria-label={t("nav.main")}>
          {NAV_GROUPS.map((group) => {
            const groupSelected = group.items.some((key) =>
              isNavSelected(key, pathname),
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
                    opacity: 0.9,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    fontSize: 11,
                    fontWeight: 650,
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
                  const href = PATHS[key];
                  const selected = isNavSelected(key, pathname);
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
                        href={href}
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
                            color: tone.accent,
                          },
                          "&.Mui-selected .MuiListItemText-primary": {
                            fontWeight: 700,
                            color: tone.accent,
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
                sx={{ opacity: 0.8, display: "block", color: tone.textSoft }}
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
      backdropFilter: "blur(18px) saturate(1.15)",
      WebkitBackdropFilter: "blur(18px) saturate(1.15)",
      boxShadow: "none",
      color: chrome.color,
      py: 2.5,
      px: 1.5,
      display: "flex",
      flexDirection: "column" as const,
      overflowX: "hidden" as const,
      "--Paper-shadow": "none",
      "--Paper-overlay": "none",
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
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ display: { xs: "none", sm: "flex" } }}
            >
              <Button
                component={Link}
                href="/plan"
                size="small"
                sx={{ color: marketingTone.chrome, fontWeight: 650 }}
              >
                {t("landing.ctaPricing")}
              </Button>
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
              <IconButton
                size="small"
                onClick={() => setNavOpen(true)}
                aria-label={t("a11y.openMenu")}
                aria-expanded={navOpen}
                aria-controls={navId}
                sx={{
                  color: marketingTone.textMuted,
                  display: { xs: "inline-flex", sm: "none" },
                }}
              >
                <MenuIcon />
              </IconButton>
            </Stack>
          </Stack>
        </Box>
        <Drawer
          variant="temporary"
          anchor={anchor}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", sm: "none" },
            [`& .MuiDrawer-paper`]: drawerPaperSx("dark"),
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
          <Stack spacing={1} sx={{ px: 1.5, py: 1 }}>
            <Button
              component={Link}
              href="/welcome"
              onClick={() => setNavOpen(false)}
              sx={{
                color: marketingTone.color,
                justifyContent: "flex-start",
                fontWeight: 700,
              }}
            >
              {t("nav.welcome")}
            </Button>
            <Button
              component={Link}
              href="/plan"
              onClick={() => setNavOpen(false)}
              sx={{ color: marketingTone.chrome, justifyContent: "flex-start" }}
            >
              {t("landing.ctaPricing")}
            </Button>
            <Button
              component="a"
              href={`/${locale}/auth/register`}
              onClick={() => setNavOpen(false)}
              sx={{ color: marketingTone.color, justifyContent: "flex-start" }}
            >
              {t("auth.register")}
            </Button>
            <Button
              component="a"
              href={`/${locale}/auth/login`}
              onClick={() => setNavOpen(false)}
              sx={{ color: marketingTone.color, justifyContent: "flex-start" }}
            >
              {t("auth.login")}
            </Button>
          </Stack>
        </Drawer>
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

  const appMobileToneKey: NavTone = mode === "dark" ? "dark" : "light";
  const appMobileTone = navChrome[appMobileToneKey];

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100%",
        overflowX: "clip",
        flexDirection: isRtl ? "row-reverse" : "row",
      }}
    >
      <a href="#main-content" className="skip-link" onClick={focusMain}>
        {t("a11y.skipToContent")}
      </a>

      {/* Mobile: same light chrome as top bar — no color flip when opened */}
      <Drawer
        variant="temporary"
        anchor={anchor}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
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

      {/* Desktop: permanent sidebar */}
      <Drawer
        variant="permanent"
        anchor={anchor}
        open
        sx={{
          display: { xs: "none", md: "block" },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: drawerPaperSx("dark"),
        }}
        PaperProps={drawerPaperProps}
      >
        {nav({ mobile: false, tone: "dark" })}
      </Drawer>

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
            md: `calc(100% - ${DRAWER_WIDTH}px)`,
          },
          maxWidth: "100%",
          overflowX: "clip",
          p: { xs: 1.5, sm: 2.5, md: 3 },
          pb: { xs: 3, md: 5 },
          outline: "none",
          textAlign: "start",
        }}
      >
        <Box
          component="header"
          sx={{
            mb: 2,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            flexWrap: "wrap",
            mx: { xs: -1.5, sm: -2.5, md: 0 },
            px: { xs: 1.5, sm: 2, md: 0 },
            py: 1,
            bgcolor: { xs: appMobileTone.bgcolor, md: "transparent" },
            borderBottom: { xs: appMobileTone.border, md: "none" },
            backdropFilter: { xs: "blur(16px) saturate(1.1)", md: "none" },
            WebkitBackdropFilter: { xs: "blur(16px) saturate(1.1)", md: "none" },
          }}
        >
          <Box sx={{ display: { xs: "block", md: "none" } }}>
            {brandMark("/", { size: "sm", tone: appMobileToneKey })}
          </Box>
          <Box sx={{ display: { xs: "none", md: "block" }, flex: 1 }} />
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            useFlexGap
            flexWrap="wrap"
            sx={{
              "& .MuiIconButton-root": {
                minWidth: 32,
                minHeight: 36,
                p: 0.5,
                color: appMobileTone.textMuted,
              },
            }}
          >
            {themeToggle({ tone: appMobileToneKey })}
            {langMenu("atlas-lang-menu-header", {
              tone: appMobileToneKey,
            })}
            <IconButton
              ref={menuButtonRef}
              edge="end"
              onClick={() => setNavOpen(true)}
              aria-label={t("a11y.openMenu")}
              aria-expanded={navOpen}
              aria-controls={navId}
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <MenuIcon />
            </IconButton>
          </Stack>
        </Box>
        <PageContainer maxWidth={920} noPadding>
          <AiCompanionBar />
        </PageContainer>
        <PageContainer
          maxWidth={920}
          sx={{
            mb: { xs: 2, md: 3 },
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            textAlign: "start",
          }}
        >
          {children}
        </PageContainer>
      </Box>
    </Box>
  );
}
