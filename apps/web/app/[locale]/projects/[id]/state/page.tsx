"use client";

import { use } from "react";
import { CurrentStateCenter } from "@/components/state/CurrentStateCenter";

export default function ProjectStatePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = use(params);
  return <CurrentStateCenter initialProjectId={id} />;
}
