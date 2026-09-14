"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";

/**
 * Workbench merged into Studio (Chat + Cloud & Tools tabs) — this route stays
 * as a redirect so old links/bookmarks keep working. See:
 * apps/web/components/studio/{ChatPanel,CloudToolsPanel}.tsx
 */
export default function WorkbenchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  useEffect(() => {
    router.replace(
      project ? `/studio?tab=chat&project=${project}` : "/studio?tab=chat",
    );
  }, [router, project]);
  return null;
}
