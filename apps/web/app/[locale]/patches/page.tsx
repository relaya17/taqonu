"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

export default function PatchesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?desk=patches");
  }, [router]);
  return null;
}
