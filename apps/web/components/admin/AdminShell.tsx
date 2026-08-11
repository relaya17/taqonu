"use client";

import type { ReactNode } from "react";
import { useState } from "react";
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
import { useTheme } from "@mui/material/styles";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiPost } from "@/lib/api";

const WIDTH = 240;

const LINKS = [
  { href: "/admin", label: "לוח בקרה" },
  { href: "/admin/users", label: "משתמשים" },
  { href: "/admin/leads", label: "לידים" },
  { href: "/admin/login", label: "התחברות אדמין" },
  { href: "/investors", label: "דף משקיעים" },
  { href: "/he", label: "חזרה ל-ArletOS" },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [open, setOpen] = useState(false);

  const nav = (
    <Box component="nav" aria-label="ניווט אדמין">
      <Typography
        sx={{
          px: 2,
          mb: 2,
          fontFamily: '"Frank Ruhl Libre", serif',
          fontWeight: 700,
          fontSize: "1.25rem",
        }}
      >
        ArletOS Admin
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
    <Box sx={{ display: "flex", minHeight: "100vh", flexDirection: "row-reverse" }}>
      <a href="#admin-main" className="skip-link">
        דלג לתוכן
      </a>
      {isMobile ? (
        <Drawer open={open} onClose={() => setOpen(false)} anchor="right">
          <Box sx={{ width: WIDTH, py: 2 }}>{nav}</Box>
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          anchor="right"
          sx={{
            width: WIDTH,
            [`& .MuiDrawer-paper`]: {
              width: WIDTH,
              border: 0,
              background: "linear-gradient(180deg, #0F3D3E 0%, #14282A 100%)",
              color: "#F4F7F5",
            },
          }}
        >
          <Box sx={{ py: 2 }}>{nav}</Box>
        </Drawer>
      )}
      <Box
        component="main"
        id="admin-main"
        tabIndex={-1}
        sx={{
          flex: 1,
          p: { xs: 2, md: 4 },
          width: { xs: "100%", md: `calc(100% - ${WIDTH}px)` },
        }}
      >
        {isMobile ? (
          <IconButton aria-label="פתח תפריט" onClick={() => setOpen(true)} sx={{ mb: 2 }}>
            <MenuIcon />
          </IconButton>
        ) : null}
        {children}
      </Box>
    </Box>
  );
}
