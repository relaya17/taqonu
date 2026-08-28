"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AtlasColorMode } from "@/styles/theme";
import { COLOR_MODE_COOKIE } from "@/lib/color-mode";

const CHANGE_EVENT = "atlas-color-mode";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface ColorModeContextValue {
  mode: AtlasColorMode;
  toggleMode: () => void;
  setMode: (mode: AtlasColorMode) => void;
  ready: boolean;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function readCookieMode(): AtlasColorMode | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COLOR_MODE_COOKIE}=(dark|light)`),
  );
  return match ? (match[1] as AtlasColorMode) : null;
}

function writeMode(next: AtlasColorMode): void {
  document.cookie = `${COLOR_MODE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ColorModeProvider({
  initialMode,
  children,
}: {
  initialMode: AtlasColorMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<AtlasColorMode>(initialMode);

  useEffect(() => {
    const sync = () => setModeState(readCookieMode() ?? initialMode);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, [initialMode]);

  const setMode = useCallback((next: AtlasColorMode) => {
    writeMode(next);
  }, []);

  const toggleMode = useCallback(() => {
    writeMode(mode === "dark" ? "light" : "dark");
  }, [mode]);

  const value = useMemo(
    () => ({ mode, toggleMode, setMode, ready: true }),
    [mode, toggleMode, setMode],
  );

  return (
    <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>
  );
}

export function useColorMode(): ColorModeContextValue {
  const ctx = useContext(ColorModeContext);
  if (!ctx) {
    throw new Error("useColorMode must be used within ColorModeProvider");
  }
  return ctx;
}
