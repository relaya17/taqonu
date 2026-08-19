"use client";

import { Alert, Box, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type ComponentStatus = "HEALTHY" | "WARNING" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
type SystemStatus = "HEALTHY" | "WARNING" | "DEGRADED" | "CRITICAL";

interface ComponentHealth {
  status: ComponentStatus;
  detail?: string;
  latencyMs?: number;
}

interface SystemHealthResponse {
  status: SystemStatus;
  version: string;
  components: Record<string, ComponentHealth>;
}

const STATUS_LABEL: Record<ComponentStatus, string> = {
  HEALTHY: "תקין",
  WARNING: "אזהרה",
  DEGRADED: "פגוע חלקית",
  CRITICAL: "קריטי",
  UNKNOWN: "לא ידוע",
};

function statusColor(
  s: ComponentStatus,
): "success" | "warning" | "error" | "default" {
  if (s === "HEALTHY") return "success";
  if (s === "WARNING" || s === "DEGRADED") return "warning";
  if (s === "CRITICAL") return "error";
  return "default";
}

function alertSeverity(s: SystemStatus): "success" | "warning" | "error" {
  if (s === "HEALTHY") return "success";
  if (s === "CRITICAL") return "error";
  return "warning";
}

const COMPONENT_LABEL: Record<string, string> = {
  database: "בסיס נתונים",
  llmProviders: "ספקי LLM",
  worker: "Worker",
};

export function HealthPanel() {
  const health = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: () => apiGet<SystemHealthResponse>("/api/v1/health"),
    retry: false,
    refetchInterval: 30_000,
  });

  if (health.isLoading) {
    return <Typography color="text.secondary">טוען בדיקת בריאות…</Typography>;
  }

  if (health.isError) {
    return (
      <Alert severity="error">
        {(health.error as Error).message ?? "נכשלה שליפת בריאות המערכת."}
      </Alert>
    );
  }

  const data = health.data;
  if (!data) return null;

  const components = Object.entries(data.components);

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        בדיקת תלויות אמיתית (DB / ספקי AI / Worker) — {data.version}.
      </Typography>
      <Alert severity={alertSeverity(data.status)}>
        סטטוס כולל: {STATUS_LABEL[data.status]}
      </Alert>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
        {components.map(([name, c]) => (
          <Box
            key={name}
            sx={{
              p: 2,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              minWidth: 220,
              flex: "1 1 220px",
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontWeight={700}>
                {COMPONENT_LABEL[name] ?? name}
              </Typography>
              <Chip
                size="small"
                label={STATUS_LABEL[c.status]}
                color={statusColor(c.status)}
                variant={c.status === "UNKNOWN" ? "outlined" : "filled"}
              />
            </Stack>
            {c.detail ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                {c.detail}
              </Typography>
            ) : null}
            {typeof c.latencyMs === "number" ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                זמן תגובה: {c.latencyMs}ms
              </Typography>
            ) : null}
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
