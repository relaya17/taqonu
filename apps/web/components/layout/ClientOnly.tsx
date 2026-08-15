"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Render children only after mount. Avoids App Router streaming hydrating a
 * page against a theme the layout already flipped (light SSR → dark client).
 */
export function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div style={{ minHeight: "48vh", width: "100%" }} />;
  }

  return children;
}
