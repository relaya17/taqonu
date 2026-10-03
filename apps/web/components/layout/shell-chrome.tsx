"use client";

import { createContext, useContext } from "react";

/**
 * What the app shell lends to a full-screen workspace (Studio) that draws its
 * own title bar: the small-screen navigation drawer and the signed-in account.
 * Null outside the signed-in shell.
 */
export interface ShellChrome {
  /** Open the small-screen navigation drawer (the ☰ button). */
  readonly openNav: () => void;
  readonly navOpen: boolean;
  /** id of the drawer paper, for aria-controls. */
  readonly navId: string;
  readonly signOut: () => Promise<void>;
  readonly user: { readonly email: string; readonly displayName: string | null } | null;
}

export const ShellChromeContext = createContext<ShellChrome | null>(null);

export function useShellChrome(): ShellChrome | null {
  return useContext(ShellChromeContext);
}
