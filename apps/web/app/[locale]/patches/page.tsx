"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";

export default function PatchesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = searchParams.get("project");
  useEffect(() => {
    router.replace(
      project ? `/?desk=patches&project=${project}` : "/?desk=patches",
    );
  }, [router, project]);
  return null;
}
