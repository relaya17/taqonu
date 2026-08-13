"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  Box,
  Drawer,
  IconButton,
  List,
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
import { useColorMode } from "@/components/providers/ColorModeProvider";

const DRAWER_WIDTH = 248;

type NavKey =
  | "dashboard"
  | "projects"
  | "studio"
  | "workbench"
  | "agents"
  | "partners"
  | "patches"
  | "health"
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
  studio: "/studio",
  workbench: "/workbench",
  agents: "/agents",
  partners: "/partners",
  patches: "/patches",
  health: "/health",
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
  readonly labelKey?: "opsGroup" | "workspaceGroup";
  readonly items: readonly NavKey[];
}[] = [
  {
    id: "main",
    items: [
      "dashboard",
      "projects",
      "studio",
      "workbench",
      "agents",
      "partners",
      "plan",
      "welcome",
    ],
  },
  {
    id: "ops",
    labelKey: "opsGroup",
    items: ["patches", "health", "readiness", "qa", "processAudit"],
  },
  {
    id: "workspace",
    labelKey: "workspaceGroup",
    items: [
      "models",
      "experts",
      "memory",
      "decisions",
      "integrations",
      "legalMedia",
      "settings",
    ],
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
  const isRtl = locale === "he" || locale === "ar";
  const { mode, toggleMode } = useColorMode();
  const mainRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  /** Small screens: closed by default; hamburger opens overlay drawer. */
  const [navOpen, setNavOpen] = useState(false);
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

  const nav = (opts: { mobile: boolean }) => (
    <>
      <Stack spacing={0.5} sx={{ px: 1.5, mb: 3 }}>
        <Typography
          component={Link}
          href="/"
          onClick={opts.mobile ? () => setNavOpen(false) : undefined}
          variant="h5"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            letterSpacing: "-0.03em",
            color: "inherit",
            textDecoration: "none",
            display: "inline-block",
            borderRadius: 1,
            "&:focus-visible": {
              outline: "3px solid #C45C26",
              outlineOffset: 2,
            },
          }}
        >
          {t("brand.name")}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.75 }}>
          {t("brand.codename")} · {t("brand.tagline")}
        </Typography>
      </Stack>

      <Box component="nav" aria-label={t("nav.main")}>
        {NAV_GROUPS.map((group) => (
          <Box key={group.id} sx={{ mb: group.labelKey ? 1.5 : 0.5 }}>
            {group.labelKey ? (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  px: 1.5,
                  pt: 1,
                  pb: 0.5,
                  opacity: 0.65,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  fontSize: 11,
                }}
              >
                {t(`nav.${group.labelKey}`)}
              </Typography>
            ) : null}
            <List dense disablePadding>
              {group.items.map((key) => {
                const href = PATHS[key];
                const selected = isNavSelected(key, pathname);
                return (
                  <ListItemButton
                    key={key}
                    component={Link}
                    href={href}
                    selected={selected}
                    aria-current={selected ? "page" : undefined}
                    onClick={opts.mobile ? () => setNavOpen(false) : undefined}
                    sx={{
                      borderRadius: 2,
                      mb: 0.5,
                      pl: group.labelKey ? 2.5 : 1.5,
                      color: "inherit",
                      "&.Mui-selected": {
                        backgroundColor: "rgba(196, 92, 38, 0.28)",
                      },
                      "&:hover": {
                        backgroundColor: "rgba(255,255,255,0.08)",
                      },
                    }}
                  >
                    <ListItemText
                      primary={t(`nav.${key}`)}
                      primaryTypographyProps={{ fontSize: { xs: 13, sm: 14 } }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      <Stack spacing={1} sx={{ mt: "auto", px: 1, pt: 3 }}>
        {showUpgradeCta ? (
          <Button
            component={Link}
            href="/plan"
            size="small"
            variant="contained"
            color="secondary"
            onClick={opts.mobile ? () => setNavOpen(false) : undefined}
            sx={{ fontWeight: 700 }}
          >
            {t("nav.upgradePro")}
          </Button>
        ) : null}
        {meQuery.data?.user ? (
          <Box>
            <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
              {meQuery.data.user.displayName ?? meQuery.data.user.email}
            </Typography>
            <Button
              size="small"
              color="secondary"
              onClick={() => void logout()}
              sx={{ mt: 0.5, color: "#F4F7F5" }}
            >
              {t("auth.logout")}
            </Button>
            {meQuery.data.user.role === "admin" ? (
              <Button
                size="small"
                href="/admin"
                sx={{ color: "#F4F7F5", display: "block" }}
              >
                {t("nav.admin")}
              </Button>
            ) : null}
            <Button
              size="small"
              href="/investors"
              sx={{ color: "#F4F7F5", display: "block" }}
            >
              {t("dashboard.investors")}
            </Button>
          </Box>
        ) : (
          <Button
            component={Link}
            href="/auth/login"
            size="small"
            variant="outlined"
            color="secondary"
            onClick={opts.mobile ? () => setNavOpen(false) : undefined}
          >
            {t("auth.login")}
          </Button>
        )}

        <Stack
          direction="row"
          spacing={1}
          role="group"
          aria-label={t("nav.languages")}
          alignItems="center"
        >
          <IconButton
            size="small"
            onClick={toggleMode}
            aria-label={
              mode === "dark" ? t("a11y.themeLight") : t("a11y.themeDark")
            }
            sx={{ color: "#F4F7F5" }}
          >
            {mode === "dark" ? (
              <LightModeOutlinedIcon fontSize="small" />
            ) : (
              <DarkModeOutlinedIcon fontSize="small" />
            )}
          </IconButton>
          {(["he", "en", "ar"] as const).map((code) => (
            <Button
              key={code}
              component={Link}
              href={pathname}
              locale={code}
              size="small"
              variant={locale === code ? "contained" : "outlined"}
              color="secondary"
              aria-pressed={locale === code}
              aria-label={t(`a11y.lang.${code}`)}
              lang={code}
              sx={{ minWidth: 44, px: 1.2 }}
            >
              {code.toUpperCase()}
            </Button>
          ))}
        </Stack>
      </Stack>
    </>
  );

  const drawerPaperSx = {
    width: DRAWER_WIDTH,
    maxWidth: "100vw",
    border: 0,
    background:
      "linear-gradient(180deg, rgba(15,61,62,0.96) 0%, rgba(20,40,42,0.98) 100%)",
    color: "#F4F7F5",
    py: 2.5,
    px: 1.5,
    display: "flex",
    flexDirection: "column" as const,
    overflowX: "hidden" as const,
  };

  if (isMarketing) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          width: "100%",
          maxWidth: "100%",
          overflowX: "clip",
          bgcolor: "#050C0D",
        }}
      >
        <Box
          component="header"
          sx={{
            position: "fixed",
            top: 0,
            insetInline: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            px: { xs: 2, md: 3 },
            py: 1.5,
            background: "linear-gradient(180deg, rgba(5,12,13,0.92), transparent)",
          }}
        >
          <Typography
            component={Link}
            href="/welcome"
            sx={{
              fontFamily: '"Syne", "Fraunces", sans-serif',
              fontWeight: 700,
              fontSize: "1.15rem",
              color: "#E8F4F2",
              textDecoration: "none",
              letterSpacing: "-0.03em",
            }}
          >
            {t("brand.name")}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              component={Link}
              href="/plan"
              size="small"
              sx={{ color: "#3EC8BE", fontWeight: 650 }}
            >
              {t("nav.plan")}
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                window.location.assign(`/${locale}/auth/login`);
              }}
              sx={{
                bgcolor: "#3EC8BE",
                color: "#041214",
                fontWeight: 700,
                "&:hover": { bgcolor: "#5AD8CF" },
              }}
            >
              {t("auth.login")}
            </Button>
            {(["he", "en", "ar"] as const).map((code) => (
              <Button
                key={code}
                component={Link}
                href={pathname}
                locale={code}
                size="small"
                variant={locale === code ? "contained" : "text"}
                sx={{
                  minWidth: 36,
                  color: locale === code ? "#041214" : "#E8F4F2",
                  bgcolor: locale === code ? "#3EC8BE" : "transparent",
                }}
              >
                {code.toUpperCase()}
              </Button>
            ))}
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

      {/* Mobile: overlay drawer opened by hamburger */}
      <Drawer
        variant="temporary"
        anchor={anchor}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: "block", md: "none" },
          [`& .MuiDrawer-paper`]: drawerPaperSx,
        }}
        PaperProps={{
          "aria-label": t("nav.main"),
          component: "aside",
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
        {nav({ mobile: true })}
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
          [`& .MuiDrawer-paper`]: drawerPaperSx,
        }}
        PaperProps={{
          "aria-label": t("nav.main"),
          component: "aside",
        }}
      >
        {nav({ mobile: false })}
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
          p: { xs: 2, sm: 3, md: 4 },
          outline: "none",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ mb: 2, minWidth: 0, display: { xs: "flex", md: "none" } }}
          component="header"
        >
          <IconButton
            ref={menuButtonRef}
            edge="start"
            onClick={() => setNavOpen(true)}
            aria-label={t("a11y.openMenu")}
            aria-expanded={navOpen}
            aria-controls={navId}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            component="p"
            fontWeight={700}
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("brand.name")}
          </Typography>
        </Stack>
        <AiCompanionBar />
        {children}
      </Box>
    </Box>
  );
}
