"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { deskAliasHref } from "@/lib/studio-surfaces";

export default function DecisionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  useEffect(() => {
    router.replace(deskAliasHref("decisions", project));
  }, [router, project]);
  return null;
}
