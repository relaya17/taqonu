import type { AtlasColorMode } from "@/styles/theme";

/**
 * The color mode has to be readable on the server: it feeds the MUI theme, so
 * a server/client disagreement changes every Emotion class name and breaks
 * hydration of any Suspense boundary that resolves after the first pass.
 */
export const COLOR_MODE_COOKIE = "atlas.colorMode";

export function parseColorMode(value: string | undefined): AtlasColorMode {
  return value === "dark" ? "dark" : "light";
}
