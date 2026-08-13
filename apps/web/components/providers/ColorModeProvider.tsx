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

const STORAGE_KEY = "atlas.colorMode";

interface ColorModeContextValue {
  mode: AtlasColorMode;
  toggleMode: () => void;
  setMode: (mode: AtlasColorMode) => void;
  ready: boolean;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function readStoredMode(): AtlasColorMode {
  if (typeof window === "undefined") return "light";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "dark" || raw === "light") return raw;
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch {
    // ignore
  }
  return "light";
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AtlasColorMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setModeState(readStoredMode());
    setReady(true);
  }, []);

  const setMode = useCallback((next: AtlasColorMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "dark" ? "light" : "dark");
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, toggleMode, setMode, ready }),
    [mode, toggleMode, setMode, ready],
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
