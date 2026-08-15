"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { apiGet, apiPut } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface FacetState {
  facet: string;
  observed: boolean;
  count: number;
  epistemicState: string;
  note?: string;
}

interface ManagedSystem {
  id: string;
  projectId: string | null;
  name: string;
  kind: string;
  posture: "CLEAR" | "WATCH" | "BLOCKED" | "UNKNOWN";
  summary: string;
  evidenceCoverage: number | null;
  criticalGaps: number;
  mediumRisks: number;
  selfManaged: boolean;
  loopPhase: string;
  actEligible: boolean;
  facets: FacetState[];
}

interface Contract {
  identity: string;
  architecture: string | null;
  epistemicState: "PROPOSED" | "CONFIRMED" | "INFERRED";
  approvalPolicies: string[];
  evidenceRequirements: string[];
  financialInvariants: { id: string; statement: string }[];
}

interface Verification {
  overall: "PASS" | "FAIL" | "UNKNOWN";
  results: {
    id: string;
    statement: string;
    status: "PASS" | "FAIL" | "UNKNOWN";
    missingEvidence: string[];
  }[];
}

interface Detail {
  system: ManagedSystem;
  contract: Contract;
  verification: Verification;
}

function postureColor(
  posture: ManagedSystem["posture"],
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

export default function SystemDetailPage() {
  const t = useTranslations("systems");
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = params.id;

  const query = useQuery({
    queryKey: ["managed-system", id],
    queryFn: () => apiGet<Detail>(`/api/v1/systems/${id}`),
  });

  const confirm = useMutation({
    mutationFn: () =>
      apiPut<Detail>(`/api/v1/systems/${id}/contract`, {
        epistemicState: "CONFIRMED",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["managed-system", id] });
      await queryClient.invalidateQueries({ queryKey: ["managed-systems"] });
    },
  });

  const detail = query.data;
  const system = detail?.system;
  const projectId = system?.projectId;

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Button component={Link} href="/systems" size="small" sx={{ alignSelf: "flex-start" }}>
        {t("backToList")}
      </Button>

      {query.isError ? (
        <Alert severity="error">{(query.error as Error).message}</Alert>
      ) : null}

      {system ? (
        <>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h1">{system.name}</Typography>
              <Chip size="small" color={postureColor(system.posture)} label={system.posture} />
              <Chip size="small" variant="outlined" label={system.loopPhase} />
              {system.selfManaged ? (
                <Chip size="small" variant="outlined" label={t("self")} />
              ) : null}
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              {system.summary}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {system.evidenceCoverage == null
                ? t("coverageUnknown")
                : t("coverage", { pct: system.evidenceCoverage })}
              {" · "}
              {t("critical", { count: system.criticalGaps })}
              {" · "}
              {t("medium", { count: system.mediumRisks })}
              {" · "}
              {system.actEligible ? t("actReady") : t("actBlocked")}
            </Typography>
          </Box>

          {projectId ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                component={Link}
                href={`/truth?project=${projectId}`}
                variant="contained"
                size="small"
              >
                {t("openTruth")}
              </Button>
              <Button
                component={Link}
                href={`/health?project=${projectId}`}
                variant="outlined"
                size="small"
              >
                {t("openHealth")}
              </Button>
              <Button
                component={Link}
                href={`/readiness?project=${projectId}`}
                variant="outlined"
                size="small"
              >
                {t("openGates")}
              </Button>
              <Button
                component={Link}
                href={`/?desk=patches&project=${projectId}`}
                variant="text"
                size="small"
              >
                {t("openPatches")}
              </Button>
            </Stack>
          ) : (
            <Alert severity="info">{t("selfNoProject")}</Alert>
          )}

          <Box>
            <Typography fontWeight={700} sx={{ mb: 1 }}>
              {t("facetsTitle")}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {system.facets.map((facet) => (
                <Chip
                  key={facet.facet}
                  size="small"
                  color={facet.observed ? "success" : "default"}
                  variant={facet.observed ? "filled" : "outlined"}
                  label={
                    facet.observed
                      ? `${facet.facet} · ${facet.count}${facet.note ? ` · ${facet.note}` : ""}`
                      : `${facet.facet} · ${t("facetUnknown")}`
                  }
                />
              ))}
            </Stack>
          </Box>

          {detail ? (
            <Box>
              <Typography fontWeight={700}>{t("contractTitle")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {detail.contract.identity}
                {" · "}
                {detail.contract.epistemicState}
                {" · "}
                {t("invariantsOverall", { status: detail.verification.overall })}
              </Typography>
              {detail.contract.architecture ? (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {detail.contract.architecture}
                </Typography>
              ) : null}
              {detail.verification.results.map((row) => (
                <Alert
                  key={row.id}
                  severity={
                    row.status === "PASS"
                      ? "success"
                      : row.status === "FAIL"
                        ? "error"
                        : "info"
                  }
                  sx={{ mt: 1 }}
                >
                  {row.statement}
                  {row.missingEvidence.length > 0
                    ? ` — ${t("missingEvidence")}: ${row.missingEvidence.join(", ")}`
                    : ""}
                </Alert>
              ))}
              {detail.contract.epistemicState !== "CONFIRMED" ? (
                <Button
                  sx={{ mt: 1.5 }}
                  size="small"
                  variant="outlined"
                  disabled={confirm.isPending}
                  onClick={() => confirm.mutate()}
                >
                  {t("confirmContract")}
                </Button>
              ) : null}
              {confirm.isError ? (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {(confirm.error as Error).message}
                </Alert>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
