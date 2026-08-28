"use client";

import { useEffect, useState, type ReactNode } from "react";

interface ClientOnlyProps {
  children: ReactNode;
  /** If true, render nothing on server instead of a placeholder */
  noPlaceholder?: boolean;
}

/**
 * Render children only after mount. Avoids App Router streaming hydrating a
 * page against a theme the layout already flipped (light SSR → dark client).
 */
export function ClientOnly({ children, noPlaceholder }: ClientOnlyProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    if (noPlaceholder) {
      return null;
    }
    return <div style={{ minHeight: "48vh", width: "100%" }} />;
  }

  return children;
}
