"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Box,
  ClickAwayListener,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  MenuList,
  Paper,
  Popper,
  Typography,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import MenuIcon from "@mui/icons-material/Menu";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useShellChrome } from "@/components/layout/shell-chrome";

export interface StudioMenuEntry {
  readonly id: string;
  readonly label: string;
  /** Keyboard hint shown at the end, e.g. "Ctrl+S". */
  readonly shortcut?: string;
  readonly onSelect?: () => void;
  /** In-app link (locale-aware). */
  readonly href?: string;
  /** Full-page link outside the Next router (e.g. an API redirect). */
  readonly externalHref?: string;
  readonly disabled?: boolean;
  /** Marks the current room / view, like VS Code's checkmarks. */
  readonly checked?: boolean;
  /** Draw a separator above this entry. */
  readonly dividerBefore?: boolean;
  /** Small caption heading above this entry (a group title). */
  readonly groupTitle?: string;
}

export interface StudioMenuDef {
  readonly id: string;
  readonly label: string;
  readonly items: readonly StudioMenuEntry[];
  /** Underline the title when its room is open (Run / Cloud / Checks). */
  readonly active?: boolean;
}

const CHROME_BG = "#101216";
const INK = "#D4D6DB";
const MUTED = "#8B9099";

/**
 * VS Code–style title bar: one row with ☰ (small screens only), the menu bar
 * (File, Edit, View, Run, …), the project in the middle and a few icons at
 * the end. Menus are real ARIA menus: arrows move between titles, Down or
 * Enter opens, hovering another title while one is open switches to it.
 */
export function StudioMenuBar({
  menus,
  center,
  end,
  ariaLabel,
}: {
  readonly menus: readonly StudioMenuDef[];
  readonly center?: ReactNode;
  readonly end?: ReactNode;
  readonly ariaLabel: string;
}) {
  const tRoot = useTranslations();
  const shell = useShellChrome();
  const [openId, setOpenId] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const titleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Phones: every menu in one list behind "⋯", grouped by menu title. */
  const COMPACT = "__compact__";
  const compactRef = useRef<HTMLButtonElement | null>(null);

  const openMenu = (id: string) => {
    if (id === COMPACT) {
      setAnchorEl(compactRef.current);
      setOpenId(COMPACT);
      return;
    }
    const el = titleRefs.current[id];
    if (!el) return;
    setAnchorEl(el);
    setOpenId(id);
  };
  const closeMenu = (returnFocus = false) => {
    const anchor = anchorEl;
    setOpenId(null);
    setAnchorEl(null);
    if (returnFocus) anchor?.focus();
  };

  const moveTitleFocus = (fromIndex: number, delta: number, keepOpen: boolean) => {
    const next = (fromIndex + delta + menus.length) % menus.length;
    const id = menus[next]?.id;
    if (!id) return;
    titleRefs.current[id]?.focus();
    if (keepOpen) openMenu(id);
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward) {
      event.preventDefault();
      moveTitleFocus(index, 1, false);
    } else if (event.key === backward) {
      event.preventDefault();
      moveTitleFocus(index, -1, false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(menus[index]!.id);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const index = menus.findIndex((m) => m.id === openId);
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      closeMenu(event.key === "Escape");
      return;
    }
    if (index < 0 || openId === COMPACT) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const backward = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward || event.key === backward) {
      event.preventDefault();
      moveTitleFocus(index, event.key === forward ? 1 : -1, true);
    }
  };

  const openDef: StudioMenuDef | null =
    openId === COMPACT
      ? {
          id: COMPACT,
          label: ariaLabel,
          items: menus.flatMap((menu, menuIndex) =>
            menu.items.map((item, index): StudioMenuEntry => {
              const entry: StudioMenuEntry = {
                ...item,
                id: `${menu.id}:${item.id}`,
                dividerBefore: index === 0 ? menuIndex > 0 : Boolean(item.dividerBefore),
              };
              return index === 0 ? { ...entry, groupTitle: menu.label } : entry;
            }),
          ),
        }
      : (menus.find((m) => m.id === openId) ?? null);

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        minHeight: 38,
        px: { xs: 0.5, md: 1 },
        bgcolor: CHROME_BG,
        borderBottom: "1px solid #262930",
        color: INK,
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {shell ? (
        <IconButton
          size="small"
          onClick={shell.openNav}
          aria-label={tRoot("a11y.openMenu")}
          aria-expanded={shell.navOpen}
          aria-controls={shell.navId}
          sx={{ display: { xs: "inline-flex", md: "none" }, color: INK, minWidth: 36, minHeight: 36 }}
        >
          <MenuIcon fontSize="small" />
        </IconButton>
      ) : null}

      <Box
        role="menubar"
        aria-label={ariaLabel}
        sx={{
          display: { xs: "none", md: "flex" },
          alignItems: "center",
          minWidth: 0,
          flexShrink: 1,
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {menus.map((menu, index) => (
          <Box
            key={menu.id}
            component="button"
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openId === menu.id}
            tabIndex={index === 0 ? 0 : -1}
            data-studio-menu={menu.id}
            ref={(el: HTMLButtonElement | null) => {
              titleRefs.current[menu.id] = el;
            }}
            onClick={() => (openId === menu.id ? closeMenu(true) : openMenu(menu.id))}
            onMouseEnter={() => {
              if (openId && openId !== menu.id) openMenu(menu.id);
            }}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => onTitleKeyDown(event, index)}
            sx={{
              all: "unset",
              boxSizing: "border-box",
              cursor: "pointer",
              px: 1,
              py: 0.5,
              fontSize: 13,
              lineHeight: "20px",
              whiteSpace: "nowrap",
              borderRadius: 1,
              color: openId === menu.id || menu.active ? "#EEF0F3" : INK,
              bgcolor: openId === menu.id ? "rgba(255,255,255,0.10)" : "transparent",
              boxShadow: menu.active ? "inset 0 -2px 0 #4C8DFF" : "none",
              "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
              "&:focus-visible": { outline: "2px solid #4C8DFF", outlineOffset: -2 },
            }}
          >
            {menu.label}
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "center",
          px: { xs: 0.5, md: 2 },
        }}
      >
        {center}
      </Box>

      {end ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>{end}</Box>
      ) : null}

      <IconButton
        ref={compactRef}
        size="small"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={openId === COMPACT}
        onClick={() => (openId === COMPACT ? closeMenu(true) : openMenu(COMPACT))}
        sx={{ display: { xs: "inline-flex", md: "none" }, color: INK, minWidth: 36, minHeight: 36 }}
      >
        <MoreHorizIcon fontSize="small" />
      </IconButton>

      <Popper
        open={Boolean(openDef && anchorEl)}
        anchorEl={anchorEl}
        placement="bottom-start"
        sx={{ zIndex: 1300 }}
      >
        <Paper
          elevation={8}
          sx={{
            bgcolor: "#1F2228",
            color: INK,
            border: "1px solid #30343C",
            maxHeight: "calc(100dvh - 60px)",
            overflowY: "auto",
          }}
        >
          <ClickAwayListener
            onClickAway={(event) => {
              const target = event.target as Node | null;
              if (target && (anchorEl?.contains(target) ?? false)) return;
              closeMenu();
            }}
          >
            <MenuList
              autoFocusItem={Boolean(openDef)}
              dense
              aria-label={openDef?.label}
              onKeyDown={onMenuKeyDown}
              sx={{ minWidth: 260, py: 0.5 }}
            >
              {(openDef?.items ?? []).flatMap((item) => {
                const nodes: ReactNode[] = [];
                if (item.dividerBefore) {
                  nodes.push(<Divider key={`${item.id}-divider`} sx={{ my: 0.5, borderColor: "#30343C" }} />);
                }
                if (item.groupTitle) {
                  nodes.push(
                    <ListSubheader
                      key={`${item.id}-group`}
                      component="div"
                      role="presentation"
                      sx={{ bgcolor: "transparent", color: MUTED, lineHeight: "28px", fontSize: 11.5 }}
                    >
                      {item.groupTitle}
                    </ListSubheader>,
                  );
                }
                const linkProps = item.href
                  ? { component: Link, href: item.href }
                  : item.externalHref
                    ? { component: "a", href: item.externalHref }
                    : {};
                nodes.push(
                  <MenuItem
                    key={item.id}
                    {...linkProps}
                    disabled={Boolean(item.disabled)}
                    selected={Boolean(item.checked)}
                    onClick={() => {
                      closeMenu();
                      item.onSelect?.();
                    }}
                    sx={{ fontSize: 13, gap: 1, minHeight: 30 }}
                  >
                    <ListItemIcon sx={{ minWidth: 22, color: INK }}>
                      {item.checked ? <CheckIcon fontSize="small" /> : null}
                    </ListItemIcon>
                    <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13 }} />
                    {item.shortcut ? (
                      <Typography
                        component="span"
                        dir="ltr"
                        sx={{ fontSize: 12, color: MUTED, ms: 3, fontFamily: "ui-monospace, monospace" }}
                      >
                        {item.shortcut}
                      </Typography>
                    ) : null}
                  </MenuItem>,
                );
                return nodes;
              })}
            </MenuList>
          </ClickAwayListener>
        </Paper>
      </Popper>
    </Box>
  );
}
