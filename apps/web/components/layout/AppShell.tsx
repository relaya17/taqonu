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
  useMediaQuery,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslations, useLocale } from "next-intl";
import { useTheme } from "@mui/material/styles";
import { Link, usePathname } from "@/i18n/routing";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

const DRAWER_WIDTH = 248;

/** Primary nav — demo-critical surfaces only (contract/metrics live under Settings). */
const NAV_KEYS = [
  "dashboard",
  "projects",
  "state",
  "chat",
  "agent",
  "models",
  "agents",
  "patches",
  "proof",
  "readiness",
  "health",
  "partners",
  "qa",
  "experts",
  "legalMedia",
  "plan",
  "memory",
  "decisions",
  "integrations",
  "settings",
] as const;

const PATHS: Record<(typeof NAV_KEYS)[number], string> = {
  dashboard: "/",
  projects: "/projects",
  state: "/state",
  chat: "/chat",
  agent: "/agent",
  models: "/models",
  agents: "/agents",
  patches: "/patches",
  proof: "/proof",
  readiness: "/readiness",
  health: "/health",
  partners: "/partners",
  qa: "/qa",
  experts: "/experts",
  legalMedia: "/legal-media",
  plan: "/plan",
  memory: "/memory",
  decisions: "/decisions",
  integrations: "/integrations",
  settings: "/settings",
};

function isNavSelected(
  key: (typeof NAV_KEYS)[number],
  pathname: string,
): boolean {
  if (key === "state") {
    return (
      pathname === "/state" ||
      pathname.startsWith("/state/") ||
      /\/projects\/[^/]+\/state$/.test(pathname)
    );
  }
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
  const theme = useTheme();
  // noSsr: avoid first-paint desktop shell (no menu button) before matchMedia runs.
  const isMobile = useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileNavId = useId();
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (mobileOpen) {
      closeButtonRef.current?.focus();
    }
  }, [mobileOpen]);

  const meQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const session = await apiGet<AuthMe & { authenticated: boolean; user: AuthMe["user"] | null }>(
        "/api/v1/auth/session",
      );
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

  const logout = async () => {
    await apiPost("/api/v1/auth/logout", {});
    window.location.href = `/${locale}/auth/login`;
  };

  const closeMobileNav = () => {
    setMobileOpen(false);
    queueMicrotask(() => menuButtonRef.current?.focus());
  };

  const focusMain = (event?: MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    const main = mainRef.current ?? document.getElementById("main-content");
    main?.focus({ preventScroll: false });
    main?.scrollIntoView({ block: "start" });
  };

  const nav = (
    <>
      <Stack spacing={0.5} sx={{ px: 1.5, mb: 3 }}>
        <Typography
          component={Link}
          href="/"
          variant="h5"
          onClick={() => setMobileOpen(false)}
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
        <List dense disablePadding>
          {NAV_KEYS.map((key) => {
            const href = PATHS[key];
            const selected = isNavSelected(key, pathname);
            return (
              <ListItemButton
                key={key}
                component={Link}
                href={href}
                selected={selected}
                aria-current={selected ? "page" : undefined}
                onClick={() => setMobileOpen(false)}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  color: "inherit",
                  "&.Mui-selected": {
                    backgroundColor: "rgba(196, 92, 38, 0.28)",
                  },
                  "&:hover": {
                    backgroundColor: "rgba(255,255,255,0.08)",
                  },
                }}
              >
                <ListItemText primary={t(`nav.${key}`)} />
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Stack spacing={1} sx={{ mt: "auto", px: 1, pt: 3 }}>
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
          >
            {t("auth.login")}
          </Button>
        )}

        <Stack direction="row" spacing={1} role="group" aria-label={t("nav.languages")}>
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
    px: 1.5,
    py: 2.5,
    display: "flex",
    flexDirection: "column" as const,
    overflowX: "hidden" as const,
  };

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

      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={closeMobileNav}
          anchor={isRtl ? "right" : "left"}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: drawerPaperSx,
            "aria-label": t("nav.main"),
            id: mobileNavId,
          }}
        >
          <Stack direction="row" justifyContent="flex-end">
            <IconButton
              ref={closeButtonRef}
              onClick={closeMobileNav}
              aria-label={t("a11y.closeMenu")}
              sx={{ color: "#F4F7F5" }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
          {nav}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          anchor={isRtl ? "right" : "left"}
          open
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: drawerPaperSx,
          }}
          PaperProps={{ "aria-label": t("nav.main"), component: "aside" }}
        >
          {nav}
        </Drawer>
      )}

      <Box
        component="main"
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        aria-label={t("a11y.mainContent")}
        sx={{
          flex: 1,
          minWidth: 0,
          width: { xs: "100%", md: `calc(100% - ${DRAWER_WIDTH}px)` },
          maxWidth: "100%",
          overflowX: "clip",
          p: { xs: 2, sm: 3, md: 4 },
          outline: "none",
        }}
      >
        {isMobile ? (
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ mb: 2, minWidth: 0 }}
            component="header"
          >
            <IconButton
              ref={menuButtonRef}
              edge="start"
              onClick={() => setMobileOpen(true)}
              aria-label={t("a11y.openMenu")}
              aria-expanded={mobileOpen}
              aria-controls={mobileNavId}
            >
              <MenuIcon />
            </IconButton>
            <Typography
              component="p"
              fontWeight={700}
              sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {t("brand.name")}
            </Typography>
          </Stack>
        ) : null}
        {children}
      </Box>
    </Box>
  );
}
