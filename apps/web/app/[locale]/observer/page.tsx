"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

/**
 * Observer merged into Studio's "Checks" tab — this route stays as a
 * redirect so old links/bookmarks keep working. See:
 * apps/web/components/studio/ObserverPanel.tsx
 */
export default function ObserverPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio?tab=checks&check=observer");
  }, [router]);
  return null;
}
