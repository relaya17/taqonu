"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiPost } from "@/lib/api";

const WIDTH = 240;

const LINKS = [
  { href: "/admin", label: "מרכז פיקוד" },
  { href: "/admin/marketplace", label: "Marketplace" },
  { href: "/admin/oracle", label: "Admin Oracle" },
  { href: "/admin/users", label: "משתמשים" },
  { href: "/admin/leads", label: "לידים" },
  { href: "/admin/login", label: "התחברות אדמין" },
  { href: "/he/truth", label: "ATLAS HEALTH" },
  { href: "/he/plan", label: "מחירים / BYO" },
  { href: "/he/welcome", label: "דף נחיתה" },
  { href: "/investors", label: "משקיעים" },
  { href: "/he", label: "חזרה ל-ArletOS" },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const nav = (
    <Box component="nav" aria-label="ניווט אדמין">
      <Typography
        sx={{
          px: 2,
          mb: 0.5,
          fontFamily: '"Syne", "Frank Ruhl Libre", serif',
          fontWeight: 700,
          fontSize: "1.35rem",
          letterSpacing: "-0.03em",
        }}
      >
        ArletOS Tenant Admin
      </Typography>
      <Typography
        variant="caption"
        sx={{ px: 2, mb: 2, display: "block", opacity: 0.7 }}
      >
        ניהול דייר — לא Atlas Admin (פורט 3200)
      </Typography>
      <List dense>
        {LINKS.map((link) => {
          const selected =
            link.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(link.href);
          return (
            <ListItemButton
              key={link.href}
              component={Link}
              href={link.href}
              selected={selected}
              aria-current={selected ? "page" : undefined}
              onClick={() => setOpen(false)}
              sx={{ borderRadius: 2, mx: 1, mb: 0.5 }}
            >
              <ListItemText primary={link.label} />
            </ListItemButton>
          );
        })}
      </List>
      <Button
        sx={{ mx: 2, mt: 2 }}
        onClick={() => void apiPost("/api/v1/auth/logout", {}).then(() => {
          window.location.href = "/admin/login";
        })}
      >
        התנתקות
      </Button>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
        maxWidth: "100%",
        overflowX: "clip",
        flexDirection: "row-reverse",
      }}
    >
      <a
        href="#admin-main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("admin-main");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        דלג לתוכן
      </a>
      {isMobile ? (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          anchor="right"
          ModalProps={{ keepMounted: true }}
          PaperProps={{ "aria-label": "ניווט אדמין", id: "admin-nav" }}
        >
          <Stack direction="row" justifyContent="flex-end" sx={{ px: 1, pt: 1 }}>
            <IconButton
              aria-label="סגור תפריט"
              onClick={() => setOpen(false)}
              sx={{ color: "inherit" }}
            >
              <CloseIcon />
            </IconButton>
          </Stack>
          <Box sx={{ width: WIDTH, py: 1, maxWidth: "100vw", overflowX: "hidden" }}>
            {nav}
          </Box>
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          anchor="right"
          sx={{
            width: WIDTH,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: {
              width: WIDTH,
              maxWidth: "100vw",
              border: 0,
              background:
                "linear-gradient(180deg, #12141A 0%, #16191F 45%, #1C1F26 100%)",
              color: "#DCDDE1",
              borderInlineStart: "1px solid rgba(154,158,168,0.2)",
              overflowX: "hidden",
            },
          }}
          PaperProps={{ "aria-label": "ניווט אדמין", component: "aside" }}
        >
          <Box sx={{ py: 2 }}>{nav}</Box>
        </Drawer>
      )}
      <Box
        component="main"
        id="admin-main"
        tabIndex={-1}
        aria-label="תוכן ראשי"
        sx={{
          flex: 1,
          minWidth: 0,
          maxWidth: "100%",
          overflowX: "clip",
          p: { xs: 2, md: 4 },
          width: { xs: "100%", md: `calc(100% - ${WIDTH}px)` },
          outline: "none",
        }}
      >
        {isMobile ? (
          <IconButton
            aria-label="פתח תפריט"
            aria-expanded={open}
            aria-controls="admin-nav"
            onClick={() => setOpen(true)}
            sx={{ mb: 2 }}
          >
            <MenuIcon />
          </IconButton>
        ) : null}
        {children}
      </Box>
    </Box>
  );
}
