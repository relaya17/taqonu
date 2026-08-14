"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

/** Deep links land on the personal desk inside the dashboard. */
export default function MemoryPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?desk=memory");
  }, [router]);
  return null;
}
