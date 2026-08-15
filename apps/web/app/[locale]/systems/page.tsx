"use client";

import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface ManagedSystemRow {
  id: string;
  projectId: string | null;
  slug: string;
  name: string;
  kind: "CUSTOMER" | "LAB" | "ATLAS_SELF";
  posture: "CLEAR" | "WATCH" | "BLOCKED" | "UNKNOWN";
  verdictHint: string;
  summary: string;
  evidenceCoverage: number | null;
  criticalGaps: number;
  mediumRisks: number;
  selfManaged: boolean;
  loopPhase: "DISCOVER" | "UNDERSTAND" | "VERIFY" | "ACT";
  actEligible: boolean;
}

interface ManagedSystemList {
  items: ManagedSystemRow[];
  note: string;
}

const POSTURE_ORDER: Record<ManagedSystemRow["posture"], number> = {
  BLOCKED: 0,
  WATCH: 1,
  UNKNOWN: 2,
  CLEAR: 3,
};

function postureColor(
  posture: ManagedSystemRow["posture"],
): "success" | "warning" | "error" | "default" {
  switch (posture) {
    case "CLEAR":
      return "success";
    case "WATCH":
      return "warning";
    case "BLOCKED":
      return "error";
    default:
      return "default";
  }
}

export default function SystemsPage() {
  const t = useTranslations("systems");
  const query = useQuery({
    queryKey: ["managed-systems"],
    queryFn: () => apiGet<ManagedSystemList>("/api/v1/systems"),
  });

  const items = [...(query.data?.items ?? [])].sort(
    (a, b) => POSTURE_ORDER[a.posture] - POSTURE_ORDER[b.posture],
  );
  const blocked = items.filter((row) => row.posture === "BLOCKED");

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("loop")}
        </Typography>
      </Box>

      {query.isError ? (
        <Alert severity="info">{(query.error as Error).message}</Alert>
      ) : null}

      {query.data?.note ? (
        <Alert severity="info">{query.data.note}</Alert>
      ) : null}

      {blocked.length > 0 ? (
        <Alert severity="error">
          {t("blockedFirst", { count: blocked.length })}
        </Alert>
      ) : null}

      {items.length === 0 && !query.isLoading ? (
        <Typography color="text.secondary">{t("empty")}</Typography>
      ) : null}

      {items.map((system) => (
        <Box
          key={system.id}
          sx={{
            py: 2,
            borderBottom: "1px solid rgba(26,31,42,0.12)",
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography fontWeight={700}>{system.name}</Typography>
            <Chip size="small" color={postureColor(system.posture)} label={system.posture} />
            <Chip size="small" variant="outlined" label={system.loopPhase} />
            {system.selfManaged ? (
              <Chip size="small" variant="outlined" label={t("self")} />
            ) : (
              <Chip size="small" variant="outlined" label={system.kind} />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {system.summary}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {system.evidenceCoverage == null
              ? t("coverageUnknown")
              : t("coverage", { pct: system.evidenceCoverage })}
            {" · "}
            {t("critical", { count: system.criticalGaps })}
            {" · "}
            {t("medium", { count: system.mediumRisks })}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
            <Button
              component={Link}
              href={`/systems/${system.id}`}
              size="small"
              variant="contained"
            >
              {t("openSystem")}
            </Button>
            {system.projectId ? (
              <>
                <Button
                  component={Link}
                  href={`/truth?project=${system.projectId}`}
                  size="small"
                  variant="outlined"
                >
                  {t("openTruth")}
                </Button>
                <Button
                  component={Link}
                  href={`/health?project=${system.projectId}`}
                  size="small"
                  variant="text"
                >
                  {t("openHealth")}
                </Button>
                <Button
                  component={Link}
                  href={`/?desk=patches&project=${system.projectId}`}
                  size="small"
                  variant="text"
                >
                  {t("openPatches")}
                </Button>
              </>
            ) : null}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
