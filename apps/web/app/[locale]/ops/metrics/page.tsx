"use client";

import {
  Alert,
  Box,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import { Link } from "@/i18n/routing";
import {
  AUTH_SESSION_QUERY_KEY,
  fetchAuthSession,
  sessionGate,
} from "@/lib/auth-session";

/** Roles allowed by GET /api/v1/metrics (requireAdmin: admin or Control Plane). */
const METRICS_ROLES = new Set(["admin", "operator", "owner"]);

interface MetricSample {
  name: string;
  value: number;
  tags?: Record<string, string>;
  at: string;
}

interface MetricsResponse {
  service: string;
  sampleCount: number;
  byName: Record<string, { count: number; last: number | null }>;
  recent: MetricSample[];
  note?: string;
}

export default function OpsMetricsPage() {
  const t = useTranslations("opsMetrics");
  const tAccess = useTranslations("opsAccess");

  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => fetchAuthSession<{ role: string }>(),
    retry: false,
  });
  const gate = sessionGate(sessionQuery);
  const role = sessionQuery.data
    ? sessionQuery.data.role || sessionQuery.data.user.role
    : "";
  const allowed = gate === "signed-in" && METRICS_ROLES.has(role);

  const metricsQuery = useQuery({
    queryKey: ["ops-metrics"],
    queryFn: () => apiGet<MetricsResponse>("/api/v1/metrics"),
    refetchInterval: 15_000,
    enabled: allowed,
    retry: false,
  });

  const forbidden =
    metricsQuery.isError &&
    metricsQuery.error instanceof Error &&
    /admin|forbidden|not signed in|unauthori[sz]ed|\b40[13]\b/i.test(
      metricsQuery.error.message,
    );

  if (gate === "checking") {
    return (
      <Typography color="text.secondary">{tAccess("checking")}</Typography>
    );
  }

  if (!allowed || forbidden) {
    return (
      <Stack spacing={3} sx={{ maxWidth: 960 }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
            {t("title")}
          </Typography>
        </Box>
        <Alert severity="info">
          {gate === "signed-out" ? (
            <>
              {tAccess("signedOut")}{" "}
              <Link href="/auth/login">{tAccess("signIn")}</Link>
            </>
          ) : gate === "unavailable" ? (
            tAccess("unavailable")
          ) : (
            tAccess("adminOnly")
          )}
        </Alert>
        <Box>
          <Link href="/settings">{tAccess("backToSettings")}</Link>
        </Box>
      </Stack>
    );
  }

  const data = metricsQuery.data;
  const byNameEntries = data
    ? Object.entries(data.byName).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      {metricsQuery.isError ? (
        <Alert severity="error">
          {metricsQuery.error instanceof Error
            ? metricsQuery.error.message
            : t("error")}
        </Alert>
      ) : null}

      {data ? (
        <Typography variant="body2" color="text.secondary">
          {t("sampleCount", { count: data.sampleCount })} · {data.service}
        </Typography>
      ) : null}

      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
          {t("byName")}
        </Typography>
        <Table size="small" aria-label={t("byName")}>
          <TableHead>
            <TableRow>
              <TableCell>{t("name")}</TableCell>
              <TableCell align="right">{t("count")}</TableCell>
              <TableCell align="right">{t("last")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {byNameEntries.map(([name, bucket]) => (
              <TableRow key={name}>
                <TableCell>
                  <Typography component="code" variant="body2">
                    {name}
                  </Typography>
                </TableCell>
                <TableCell align="right">{bucket.count}</TableCell>
                <TableCell align="right">
                  {bucket.last === null ? "—" : bucket.last}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
          {t("recent")}
        </Typography>
        {(data?.recent.length ?? 0) === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          <Table size="small" aria-label={t("recent")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("name")}</TableCell>
                <TableCell align="right">{t("value")}</TableCell>
                <TableCell>{t("tags")}</TableCell>
                <TableCell>{t("at")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.recent ?? []).map((sample, i) => (
                <TableRow key={`${sample.name}-${sample.at}-${i}`}>
                  <TableCell>
                    <Typography component="code" variant="body2">
                      {sample.name}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{sample.value}</TableCell>
                  <TableCell>
                    {sample.tags
                      ? Object.entries(sample.tags)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" component="span">
                      {sample.at}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>

      {data?.note ? (
        <Typography variant="caption" color="text.secondary">
          {data.note}
        </Typography>
      ) : null}
    </Stack>
  );
}
