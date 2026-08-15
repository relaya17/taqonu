"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/** Seed a project picker from `?project=` without fighting later user changes. */
export function useProjectQueryParam(initial = "") {
  const searchParams = useSearchParams();
  const fromQuery = searchParams.get("project") ?? "";
  const [selectedId, setSelectedId] = useState(fromQuery || initial);
  useEffect(() => {
    if (fromQuery) setSelectedId(fromQuery);
  }, [fromQuery]);
  return [selectedId, setSelectedId] as const;
}
