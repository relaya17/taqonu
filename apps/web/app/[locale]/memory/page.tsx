"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { deskAliasHref } from "@/lib/studio-surfaces";

/** Deep links land on the personal desk inside the dashboard. */
export default function MemoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  useEffect(() => {
    router.replace(deskAliasHref("memory", project));
  }, [router, project]);
  return null;
}
