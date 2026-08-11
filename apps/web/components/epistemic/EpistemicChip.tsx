"use client";

import { Chip } from "@mui/material";
import { useTranslations } from "next-intl";
import type { EpistemicState } from "@atlas/shared";

const COLORS: Record<
  EpistemicState,
  "default" | "success" | "info" | "warning" | "error" | "secondary"
> = {
  FACT: "success",
  CONFIRMED: "info",
  VERIFIED: "success",
  OBSERVED: "info",
  INFERRED: "secondary",
  ASSUMED: "warning",
  PROPOSED: "warning",
  UNVERIFIED: "warning",
  CONTRADICTED: "error",
  STALE: "default",
  UNKNOWN: "default",
  CONFLICTED: "error",
  INSUFFICIENT_EVIDENCE: "warning",
};

export function EpistemicChip({ state }: { state: EpistemicState }) {
  const t = useTranslations("epistemic");
  let label: string = state;
  try {
    label = t(state);
  } catch {
    label = state;
  }
  return (
    <Chip
      size="small"
      color={COLORS[state] ?? "default"}
      label={label}
      sx={{ fontWeight: 600 }}
    />
  );
}
