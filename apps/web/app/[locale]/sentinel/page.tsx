"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

/**
 * Sentinel merged into Studio's "Checks" tab — this route stays as a
 * redirect so old links/bookmarks keep working. See:
 * apps/web/components/studio/SentinelPanel.tsx
 */
export default function SentinelPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio?tab=checks&check=sentinel");
  }, [router]);
  return null;
}
