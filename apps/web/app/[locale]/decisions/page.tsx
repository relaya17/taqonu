"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

export default function DecisionsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/?desk=decisions");
  }, [router]);
  return null;
}
