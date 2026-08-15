"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AtlasColorMode } from "@/styles/theme";

const STORAGE_KEY = "atlas.colorMode";
const CHANGE_EVENT = "atlas-color-mode";

interface ColorModeContextValue {
  mode: AtlasColorMode;
  toggleMode: () => void;
  setMode: (mode: AtlasColorMode) => void;
  ready: boolean;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

function readStoredMode(): AtlasColorMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // ignore
  }
  return "light";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function writeMode(next: AtlasColorMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ColorModeProvider({ children }: { children: ReactNode }) {
  // Server snapshot is always light so SSR HTML matches the first hydrate pass.
  // After hydrate, React switches to the stored value without a mismatch warning.
  const mode = useSyncExternalStore(subscribe, readStoredMode, () => "light");

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
