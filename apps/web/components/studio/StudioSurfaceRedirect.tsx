"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import type { StudioCheckId, StudioTab } from "@/lib/studio-surfaces";

/** Keep old Web routes reachable while Studio is the canonical workspace. */
export function StudioSurfaceRedirect({
  tab,
  check,
}: {
  tab: StudioTab;
  check?: StudioCheckId;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (check) params.set("check", check);
    if (project) params.set("project", project);
    router.replace(`/studio?${params.toString()}`);
  }, [router, tab, check, project]);

  return null;
}
