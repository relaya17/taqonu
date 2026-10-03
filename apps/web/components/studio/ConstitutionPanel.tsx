"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface ChecklistItem {
  id: string;
  domain: string;
  title: string;
  description: string;
  severityIfMissing: string;
  profiles: string[];
  detectorKey: string;
  remediationHint: string;
}

interface CheckResult {
  itemId: string;
  domain: string;
  title: string;
  status: string;
  severity: string | null;
  evidenceRefs: string[];
  notes: string;
  epistemicState: string;
}

interface OmissionFinding {
  id: string;
  domain: string;
  title: string;
  whyCritical: string;
  evidenceGap: string;
  suggestedCheck: string;
  severity: string;
}

interface DomainScore {
  domain: string;
  score: number;
  applicable: number;
  passed: number;
  failed: number;
  warned: number;
  unknown: number;
}

interface ConstitutionReport {
  id: string;
  projectId: string | null;
  projectName: string;
  detectedProfiles: string[];
  overallScore: number;
  domainScores: DomainScore[];
  results: CheckResult[];
  omissions: OmissionFinding[];
  plainLanguageSummary: string;
  createdAt: string;
  epistemicState: string;
  autoRemediationDrafts?: unknown[];
}

const STATUS_KEYS = new Set([
  "PASS",
  "FAIL",
  "WARN",
  "SKIPPED_NOT_APPLICABLE",
  "UNKNOWN",
]);

function statusColor(
  status: string,
): "success" | "error" | "warning" | "default" {
  if (status === "PASS") return "success";
  if (status === "FAIL") return "error";
  if (status === "WARN") return "warning";
  return "default";
}

/**
 * Engineering Constitution checklist + run. Reports history is admin-only
 * on the API; it is shown only when that request succeeds.
 */
export function ConstitutionPanel({
  projectId,
  embedded = false,
}: {
  projectId: string;
  embedded?: boolean;
}) {
  const t = useTranslations("constitutionPanel");
  const queryClient = useQueryClient();
  const [intent, setIntent] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const checklist = useQuery({
    queryKey: ["constitution-checklist"],
    queryFn: () =>
      apiGet<{ items: ChecklistItem[]; domains: string[] }>(
        "/api/v1/constitution/checklist",
      ),
    staleTime: 5 * 60_000,
  });

  const reports = useQuery({
    queryKey: ["constitution-reports"],
    queryFn: () =>
      apiGet<{ items: ConstitutionReport[] }>("/api/v1/constitution/reports"),
    retry: false,
    staleTime: 60_000,
  });

  const run = useMutation({
    mutationFn: () =>
      apiPost<ConstitutionReport>("/api/v1/constitution/run", {
        projectId,
        ...(intent.trim() ? { intent: intent.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["constitution-reports"] });
    },
  });

  const statusLabel = (status: string) =>
    STATUS_KEYS.has(status)
      ? t(`status.${status}` as "status.PASS")
      : status;

  const report = run.data && run.data.projectId === projectId ? run.data : null;

  const shownResults = useMemo(() => {
    const rows = report?.results ?? [];
    return failedOnly
      ? rows.filter((r) => r.status === "FAIL" || r.status === "WARN")
      : rows;
  }, [report, failedOnly]);

  const projectReports = (reports.data?.items ?? []).filter(
    (r) => r.projectId === projectId,
  );

  const checklistByDomain = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const item of checklist.data?.items ?? []) {
      const list = map.get(item.domain) ?? [];
      list.push(item);
      map.set(item.domain, list);
    }
    return [...map.entries()];
  }, [checklist.data]);

  return (
    <Stack spacing={3} sx={{ maxWidth: embedded ? "100%" : 920, width: "100%" }}>
      <Box>
        <Typography variant="h2" sx={{ fontSize: { xs: "1.4rem", sm: "1.6rem" } }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {!projectId ? (
        <Alert severity="info">{t("noProject")}</Alert>
      ) : (
        <Stack spacing={1.5}>
          <TextField
            size="small"
            label={t("intent")}
            helperText={t("intentHelp")}
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            inputProps={{ maxLength: 4000 }}
            fullWidth
            multiline
            minRows={1}
          />
          <Button
            variant="contained"
            onClick={() => run.mutate()}
            disabled={run.isPending}
            sx={{ alignSelf: "flex-start", minHeight: 40 }}
          >
            {run.isPending ? t("running") : t("run")}
          </Button>
          {run.isError ? (
            <Alert severity="error">{(run.error as Error).message}</Alert>
          ) : null}
        </Stack>
      )}

      {report ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: "2.25rem", fontWeight: 700, lineHeight: 1 }}>
              {report.overallScore}
            </Typography>
            <Typography color="text.secondary">/ 100</Typography>
            <Chip
              size="small"
              color="error"
              label={t("failedCount", {
                count: report.results.filter((r) => r.status === "FAIL").length,
              })}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t("omissionCount", { count: report.omissions.length })}
            />
          </Stack>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            {report.plainLanguageSummary}
          </Typography>
          {report.detectedProfiles.length > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {t("profiles")}: {report.detectedProfiles.join(", ")}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {t("createdAt", { at: report.createdAt })}
          </Typography>

          <Box>
            <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
              {t("resultsTitle")}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={failedOnly}
                  onChange={(e) => setFailedOnly(e.target.checked)}
                />
              }
              label={t("failedOnly")}
            />
            {shownResults.length === 0 ? (
              <Typography color="text.secondary">{t("noResults")}</Typography>
            ) : (
              <Stack spacing={1} component="ul" sx={{ listStyle: "none", p: 0, m: 0 }}>
                {shownResults.map((r) => (
                  <Box
                    component="li"
                    key={r.itemId}
                    sx={{ py: 1, borderBottom: "1px solid", borderColor: "divider" }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" color={statusColor(r.status)} label={statusLabel(r.status)} />
                      <Chip size="small" variant="outlined" label={r.domain} />
                      {r.severity ? <Chip size="small" variant="outlined" label={r.severity} /> : null}
                      <Typography variant="body2" fontWeight={600}>
                        {r.title}
                      </Typography>
                    </Stack>
                    {r.notes ? (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {r.notes}
                      </Typography>
                    ) : null}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                      {t("evidence")}:{" "}
                      {r.evidenceRefs.length > 0 ? r.evidenceRefs.join(" · ") : t("noEvidence")}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          {report.omissions.length > 0 ? (
            <Box>
              <Typography variant="h3" sx={{ fontSize: "1.1rem", fontWeight: 700 }}>
                {t("omissionsTitle")}
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {report.omissions.map((o) => (
                  <Box key={o.id} sx={{ py: 1, borderBottom: "1px solid", borderColor: "divider" }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" color="warning" label={o.severity} />
                      <Chip size="small" variant="outlined" label={o.domain} />
                      <Typography variant="body2" fontWeight={600}>
                        {o.title}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {o.whyCritical}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {t("suggestedCheck")}: {o.suggestedCheck}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : projectId && !run.isPending ? (
        <Typography color="text.secondary">{t("empty")}</Typography>
      ) : null}

      {reports.isSuccess && projectReports.length > 0 ? (
        <Box>
          <Button
            variant="text"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            aria-controls="constitution-history"
          >
            {historyOpen ? t("hideHistory") : t("showHistory", { count: projectReports.length })}
          </Button>
          {historyOpen ? (
            <Stack id="constitution-history" spacing={0.5} sx={{ mt: 1 }}>
              {projectReports.map((r) => (
                <Typography key={r.id} variant="body2">
                  {r.createdAt} · {r.overallScore}/100 ·{" "}
                  {t("failedCount", {
                    count: r.results.filter((x) => x.status === "FAIL").length,
                  })}
                </Typography>
              ))}
            </Stack>
          ) : null}
        </Box>
      ) : null}

      <Box>
        <Button
          variant="text"
          onClick={() => setChecklistOpen((v) => !v)}
          aria-expanded={checklistOpen}
          aria-controls="constitution-checklist"
        >
          {checklistOpen
            ? t("hideChecklist")
            : t("showChecklist", { count: checklist.data?.items.length ?? 0 })}
        </Button>
        {checklist.isError ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {(checklist.error as Error).message}
          </Alert>
        ) : null}
        {checklistOpen ? (
          <Stack id="constitution-checklist" spacing={2} sx={{ mt: 1 }}>
            {checklistByDomain.length === 0 ? (
              <Typography color="text.secondary">{t("checklistEmpty")}</Typography>
            ) : (
              checklistByDomain.map(([domain, items]) => (
                <Box key={domain}>
                  <Typography variant="h3" sx={{ fontSize: "1rem", fontWeight: 700 }}>
                    {domain}
                  </Typography>
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    {items.map((item) => (
                      <Box key={item.id}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Chip size="small" variant="outlined" label={item.severityIfMissing} />
                          <Typography variant="body2" fontWeight={600}>
                            {item.title}
                          </Typography>
                        </Stack>
                        {item.description ? (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {item.description}
                          </Typography>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ))
            )}
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
}
