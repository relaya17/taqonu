"use client";

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";

interface UnifiedAuditEntry {
  id?: string;
  at?: string;
  type: string;
  toolName: string | null;
  entityType: string | null;
  action: string | null;
  actorId: string | null;
  actorKind: "USER" | "AGENT" | "SYSTEM";
  agentId: string | null;
  projectId?: string | null;
  reason: string;
  result: "SUCCESS" | "FAILURE" | "PARTIAL";
}

interface AuditMinePage {
  unified: UnifiedAuditEntry[];
  nextCursor: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
}

const PAGE_SIZE = 50;

export function ActivityView() {
  const t = useTranslations("activityView");
  const locale = useLocale();
  const [filter, setFilter] = useState("");

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: ProjectItem[] }>("/api/v1/projects"),
    staleTime: 60_000,
  });

  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects.data?.items ?? []) map.set(p.id, p.name);
    return map;
  }, [projects.data]);

  const activity = useInfiniteQuery({
    queryKey: ["audit-mine"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (pageParam) params.set("cursor", pageParam);
      return apiGet<AuditMinePage>(`/api/v1/audit/mine?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor ?? null,
  });

  const entries = useMemo(() => {
    const all = (activity.data?.pages ?? []).flatMap((p) => p.unified ?? []);
    return [...all].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  }, [activity.data]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) =>
      [e.type, e.entityType, e.action, e.toolName]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle)),
    );
  }, [entries, filter]);

  const formatTime = (iso: string | undefined) => {
    if (!iso) return t("unknownTime");
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  };

  const actorLabel = (kind: UnifiedAuditEntry["actorKind"]) =>
    kind === "AGENT" ? t("actorAgent") : kind === "SYSTEM" ? t("actorSystem") : t("actorHuman");

  const resultLabel = (r: UnifiedAuditEntry["result"]) =>
    r === "SUCCESS" ? t("resultSuccess") : r === "FAILURE" ? t("resultFailure") : t("resultPartial");

  return (
    <Stack spacing={3} sx={{ maxWidth: 880, width: "100%" }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <TextField
        size="small"
        label={t("filterLabel")}
        placeholder={t("filterPlaceholder")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ maxWidth: 420 }}
      />

      {activity.isLoading ? (
        <Stack spacing={1} aria-busy="true" aria-label={t("loading")}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : activity.isError ? (
        <Alert severity="error">{(activity.error as Error).message}</Alert>
      ) : entries.length === 0 ? (
        <Alert severity="info">{t("empty")}</Alert>
      ) : visible.length === 0 ? (
        <Alert severity="info">{t("noMatches")}</Alert>
      ) : (
        <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {visible.map((entry, idx) => {
            const projectName = entry.projectId
              ? projectNames.get(entry.projectId)
              : undefined;
            const entityAction = [entry.entityType, entry.action]
              .filter(Boolean)
              .join(" / ");
            return (
              <Box
                component="li"
                key={entry.id ?? `${entry.at ?? ""}-${idx}`}
                sx={{ py: 1.5, borderBottom: "1px solid rgba(26,31,42,0.12)" }}
              >
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography fontWeight={700} sx={{ wordBreak: "break-word" }}>
                    {entry.type}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={actorLabel(entry.actorKind)}
                  />
                  <Chip
                    size="small"
                    color={
                      entry.result === "SUCCESS"
                        ? "success"
                        : entry.result === "FAILURE"
                          ? "error"
                          : "warning"
                    }
                    label={resultLabel(entry.result)}
                  />
                  {projectName ? <Chip size="small" label={projectName} /> : null}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  <Box component="time" dateTime={entry.at ?? undefined}>
                    {formatTime(entry.at)}
                  </Box>
                  {entityAction ? ` · ${t("entity", { value: entityAction })}` : ""}
                  {entry.toolName ? ` · ${t("tool", { value: entry.toolName })}` : ""}
                  {entry.agentId ? ` · ${t("agent", { value: entry.agentId })}` : ""}
                </Typography>
                {entry.reason ? (
                  <Typography variant="body2" sx={{ mt: 0.5, wordBreak: "break-word" }}>
                    {entry.reason}
                  </Typography>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}

      {activity.hasNextPage ? (
        <Button
          variant="outlined"
          sx={{ alignSelf: "flex-start" }}
          disabled={activity.isFetchingNextPage}
          onClick={() => void activity.fetchNextPage()}
        >
          {activity.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
        </Button>
      ) : null}
    </Stack>
  );
}
