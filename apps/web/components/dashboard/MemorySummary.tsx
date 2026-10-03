"use client";

import { Alert, Box, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";

interface MemoryMoat {
  activeCount: number;
  supersededOrStale: number;
  pendingApproval: number;
  byType: Record<string, number>;
  byEpistemic: Record<string, number>;
  top: {
    id: string;
    type: string;
    epistemicState: string;
    statement: string;
    confidence: number;
  }[];
}

export function MemorySummary({ projectId }: { projectId?: string }) {
  const t = useTranslations("memorySummary");

  const moat = useQuery({
    queryKey: ["memory-moat", projectId ?? ""],
    staleTime: 60_000,
    retry: false,
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      const qs = params.toString();
      return apiGet<MemoryMoat>(`/api/v1/memory/moat${qs ? `?${qs}` : ""}`);
    },
  });

  const entries = (rec: Record<string, number>) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]);

  return (
    <Box
      component="section"
      aria-labelledby="memory-summary-title"
      sx={{
        width: "100%",
        textAlign: "start",
        p: 2.5,
        borderRadius: 2,
        border: "1px solid rgba(26,31,42,0.14)",
      }}
    >
      <Typography id="memory-summary-title" variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("title")}
      </Typography>

      {moat.isLoading ? (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <Skeleton width="60%" />
          <Skeleton width="40%" />
        </Stack>
      ) : moat.isError ? (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {t("unavailable", { message: (moat.error as Error).message })}
        </Alert>
      ) : moat.data ? (
        <Stack spacing={1.25} sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" color="primary" label={t("active", { count: moat.data.activeCount })} />
            <Chip
              size="small"
              color={moat.data.pendingApproval > 0 ? "warning" : "default"}
              label={t("pending", { count: moat.data.pendingApproval })}
            />
            <Chip
              size="small"
              variant="outlined"
              label={t("stale", { count: moat.data.supersededOrStale })}
            />
          </Stack>

          {moat.data.activeCount === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("empty")}
            </Typography>
          ) : (
            <>
              <Box>
                <Typography variant="subtitle2" component="h3">
                  {t("byType")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {entries(moat.data.byType)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" component="h3">
                  {t("byEpistemic")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {entries(moat.data.byEpistemic)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </Typography>
              </Box>
            </>
          )}

          {moat.data.top.length > 0 ? (
            <Box>
              <Typography variant="subtitle2" component="h3">
                {t("topTitle")}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {moat.data.top.slice(0, 5).map((m) => (
                  <Typography component="li" variant="body2" key={m.id}>
                    {m.statement}{" "}
                    <Typography component="span" variant="caption" color="text.secondary">
                      ({m.type} · {m.epistemicState})
                    </Typography>
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
