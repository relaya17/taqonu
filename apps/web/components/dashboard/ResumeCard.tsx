"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import { Link } from "@/i18n/routing";
import { asMuiHref, studioProjectHref } from "@/lib/studio-surfaces";

interface ProjectResume {
  projectId: string;
  stateSnapshotId: string | null;
  currentState: string;
  lastActivity: string | null;
  lastDecision: string | null;
  openTasks: string[];
  recommendedNextAction: string | null;
  relevantMemories: string[];
  relevantRepositoryChanges: string[];
  conflictCount: number;
  epistemicState: "FACT" | "INFERRED" | "UNKNOWN" | "CONFLICTED";
}

export function ResumeCard({ projectId }: { projectId: string }) {
  const t = useTranslations("resumeCard");
  const locale = useLocale();

  const resume = useQuery({
    queryKey: ["project-resume", projectId],
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: false,
    queryFn: () =>
      apiGet<ProjectResume>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/resume`,
      ),
  });

  if (!projectId) return null;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  };

  const data = resume.data;

  return (
    <Box
      component="section"
      aria-labelledby="resume-card-title"
      sx={{
        width: "100%",
        textAlign: "start",
        p: 2.5,
        borderRadius: 2,
        border: "1px solid rgba(26,31,42,0.14)",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
      >
        <Typography id="resume-card-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("title")}
        </Typography>
        <Button
          component={Link}
          href={asMuiHref(studioProjectHref(projectId))}
          variant="contained"
          size="small"
        >
          {t("continueInStudio")}
        </Button>
      </Stack>

      {resume.isLoading ? (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Skeleton width="70%" />
          <Skeleton width="50%" />
          <Skeleton width="60%" />
        </Stack>
      ) : resume.isError ? (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t("unavailable", { message: (resume.error as Error).message })}
        </Alert>
      ) : data ? (
        <Stack spacing={1.25} sx={{ mt: 1.5 }}>
          <Typography>{data.currentState}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              variant="outlined"
              label={
                data.lastActivity
                  ? t("lastActivity", { when: formatTime(data.lastActivity) })
                  : t("noActivity")
              }
            />
            <Chip
              size="small"
              color={data.conflictCount > 0 ? "warning" : "default"}
              label={t("conflicts", { count: data.conflictCount })}
            />
          </Stack>

          <Box>
            <Typography variant="subtitle2" component="h3">
              {t("lastDecisionLabel")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {data.lastDecision ?? t("noDecision")}
            </Typography>
          </Box>

          {data.recommendedNextAction ? (
            <Box>
              <Typography variant="subtitle2" component="h3">
                {t("nextActionLabel")}
              </Typography>
              <Typography variant="body2">{data.recommendedNextAction}</Typography>
            </Box>
          ) : null}

          <Box>
            <Typography variant="subtitle2" component="h3">
              {t("openTasksLabel")}
            </Typography>
            {data.openTasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("noTasks")}
              </Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.openTasks.slice(0, 6).map((task, i) => (
                  <Typography component="li" variant="body2" key={`${i}-${task}`}>
                    {task}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>

          {data.relevantMemories.length > 0 ? (
            <Box>
              <Typography variant="subtitle2" component="h3">
                {t("memoriesLabel")}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.relevantMemories.slice(0, 5).map((m, i) => (
                  <Typography component="li" variant="body2" key={`${i}-${m}`}>
                    {m}
                  </Typography>
                ))}
              </Box>
            </Box>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}
