"use client";

import { Alert, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet } from "@/lib/api";
import type { EpistemicState } from "@atlas/shared";

type RecurrenceItem = {
  signature: string;
  occurrences: number;
  epistemicState: "INFERRED";
  recommendation: string;
  memories: Array<{ id: string; epistemicState: string; statement: string }>;
  evidenceRefs: Array<{ kind: string; id: string }>;
};

function isEpistemicState(value: string): value is EpistemicState {
  return (
    value === "FACT" ||
    value === "CONFIRMED" ||
    value === "VERIFIED" ||
    value === "OBSERVED" ||
    value === "INFERRED" ||
    value === "ASSUMED" ||
    value === "PROPOSED" ||
    value === "UNVERIFIED" ||
    value === "CONTRADICTED" ||
    value === "STALE" ||
    value === "UNKNOWN" ||
    value === "CONFLICTED" ||
    value === "INSUFFICIENT_EVIDENCE"
  );
}

export function RecurrenceNotice({ projectId }: { projectId: string }) {
  const t = useTranslations("dashboard");
  const query = useQuery({
    queryKey: ["recurrence", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ items: RecurrenceItem[] }>(
        `/api/v1/recurrence?projectId=${encodeURIComponent(projectId)}`,
      ),
  });
  const items = query.data?.items ?? [];
  if (!projectId || items.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ width: "100%", maxWidth: 720 }}>
      <Typography fontWeight={700}>{t("recurrenceTitle")}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t("recurrenceHelp")}
      </Typography>
      {items.map((item) => (
        <Alert key={item.signature} severity="info" sx={{ textAlign: "start" }}>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <EpistemicChip state="INFERRED" />
              <Typography variant="body2">
                {t("recurrenceLine", {
                  signature: item.signature,
                  count: item.occurrences,
                })}
              </Typography>
            </Stack>
            <Typography variant="body2">{item.recommendation}</Typography>
            {item.memories.map((memory) => (
              <Stack key={memory.id} direction="row" spacing={1} alignItems="center">
                {isEpistemicState(memory.epistemicState) ? (
                  <EpistemicChip state={memory.epistemicState} />
                ) : null}
                <Typography variant="caption">{memory.statement}</Typography>
              </Stack>
            ))}
            <Typography variant="caption" color="text.secondary">
              {t("recurrenceEvidence", { count: item.evidenceRefs.length })}
            </Typography>
          </Stack>
        </Alert>
      ))}
    </Stack>
  );
}
