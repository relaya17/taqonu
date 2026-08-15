"use client";

import { Alert, Box, Button, Chip, Collapse, Stack, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";

interface ExecutiveLine {
  id: string;
  title: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  why: string;
  evidenceRefs: string[];
  nextAction: string;
  epistemicState: string;
}

interface ExecutiveReport {
  id: string;
  projectId: string;
  systemId: string | null;
  projectName: string;
  generatedAt: string;
  overall: "READY" | "CONDITIONAL" | "BLOCKED" | "UNKNOWN";
  productionReadiness: number;
  buckets: {
    verifiedPct: number;
    unverifiedPct: number;
    unknownPct: number;
  };
  counts: {
    criticalBlockers: number;
    highRisks: number;
    medium: number;
    verifiedClaims: number;
    unverifiedClaims: number;
  };
  topRisks: ExecutiveLine[];
  recommendedActions: string[];
  markdown: string;
  verdict: {
    plainLanguageSummary: string;
  };
}

function overallColor(
  overall: ExecutiveReport["overall"],
): "success" | "warning" | "error" | "default" {
  switch (overall) {
    case "READY":
      return "success";
    case "CONDITIONAL":
      return "warning";
    case "BLOCKED":
      return "error";
    default:
      return "default";
  }
}

function severityColor(
  severity: ExecutiveLine["severity"],
): "error" | "warning" | "info" {
  if (severity === "CRITICAL") return "error";
  if (severity === "HIGH") return "warning";
  return "info";
}

export function ExecutiveAuditPanel(props: {
  systemId: string;
  projectId: string;
}) {
  const t = useTranslations("systems");
  const locale = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);

  const audit = useMutation({
    mutationFn: async () => {
      await apiPost(`/api/v1/partners/audit-spine`, {
        projectId: props.projectId,
        includeConstitution: true,
        issueCertificate: true,
      });
      const params = new URLSearchParams();
      params.set("locale", locale === "ar" ? "ar" : locale === "he" ? "he" : "en");
      return apiGet<ExecutiveReport>(
        `/api/v1/systems/${props.systemId}/executive-report?${params.toString()}`,
      );
    },
  });

  const download = () => {
    if (!audit.data?.markdown) return;
    const blob = new Blob([audit.data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlas-executive-${audit.data.projectName}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const report = audit.data;

  return (
    <Box>
      <Typography fontWeight={700}>{t("executiveTitle")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t("runAuditHint")}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="contained"
          disabled={audit.isPending}
          onClick={() => audit.mutate()}
        >
          {audit.isPending ? t("auditRunning") : t("runAudit")}
        </Button>
        {report ? (
          <Button size="small" variant="outlined" onClick={download}>
            {t("downloadExecutive")}
          </Button>
        ) : null}
      </Stack>
      {audit.isError ? (
        <Alert severity="error" sx={{ mt: 1.5 }}>
          {(audit.error as Error).message}
        </Alert>
      ) : null}

      {report ? (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              color={overallColor(report.overall)}
              label={`${report.overall} · ${report.productionReadiness}/100`}
              sx={{ fontWeight: 700 }}
            />
            <Chip
              size="small"
              color="success"
              variant="outlined"
              label={t("bucketVerified", { pct: report.buckets.verifiedPct })}
            />
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label={t("bucketUnverified", { pct: report.buckets.unverifiedPct })}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t("bucketUnknown", { pct: report.buckets.unknownPct })}
            />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {report.verdict.plainLanguageSummary}
          </Typography>

          {report.topRisks.length > 0 ? (
            <Box>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                {t("topRisks")}
              </Typography>
              {report.topRisks.map((risk) => (
                <Box
                  key={risk.id}
                  sx={{
                    py: 1,
                    borderBottom: "1px solid rgba(26,31,42,0.08)",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      size="small"
                      color={severityColor(risk.severity)}
                      label={risk.severity}
                    />
                    <Typography variant="body2">{risk.title}</Typography>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setOpenId(openId === risk.id ? null : risk.id)}
                    >
                      {t("openFinding")}
                    </Button>
                  </Stack>
                  <Collapse in={openId === risk.id}>
                    <Stack spacing={0.5} sx={{ mt: 1, ps: 0.5 }}>
                      <Typography variant="body2">
                        {t("findingWhy")}: {risk.why}
                      </Typography>
                      <Typography variant="body2">
                        {t("findingNext")}: {risk.nextAction}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t("evidenceRefs")}:{" "}
                        {risk.evidenceRefs.length ? risk.evidenceRefs.join(", ") : "—"}
                      </Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button
                          component={Link}
                          href={`/truth?project=${props.projectId}`}
                          size="small"
                        >
                          {t("openTruth")}
                        </Button>
                        <Button
                          component={Link}
                          href={`/health?project=${props.projectId}`}
                          size="small"
                          variant="outlined"
                        >
                          {t("openHealth")}
                        </Button>
                      </Stack>
                    </Stack>
                  </Collapse>
                </Box>
              ))}
            </Box>
          ) : null}

          {report.recommendedActions.length > 0 ? (
            <Box>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                {t("recommendedActions")}
              </Typography>
              {report.recommendedActions.map((action) => (
                <Typography key={action} variant="body2" sx={{ mb: 0.5 }}>
                  · {action}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}
