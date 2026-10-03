"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";

/**
 * Old standalone routes now live as a view inside a hub page. Keep the old
 * URL working: forward to `${to}?view=${view}` and carry every other query
 * param (e.g. `project`) along.
 */
export function HubRedirect({ to, view }: { readonly to: string; readonly view: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    const params = new URLSearchParams(query);
    params.set("view", view);
    router.replace(`${to}?${params.toString()}`);
  }, [router, to, view, query]);

  return null;
}
