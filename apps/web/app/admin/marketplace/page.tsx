"use client";

import { useMemo, useState } from "react";
import { Alert, Box, Button, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { PluginCard } from "@/components/admin/Marketplace/PluginCard";
import { PluginDetailDialog } from "@/components/admin/Marketplace/PluginDetailDialog";
import { ReasonDialog } from "@/components/admin/Marketplace/ReasonDialog";
import {
  RegisterPluginDialog,
  type NewPluginManifestInput,
} from "@/components/admin/Marketplace/RegisterPluginDialog";
import type { PluginManifest, PluginManifestStatus } from "@/components/admin/Marketplace/types";
import { PLUGIN_STATUSES, STATUS_LABELS } from "@/components/admin/Marketplace/types";

const TABS: Array<{ label: string; status: PluginManifestStatus | "ALL" }> = [
  { label: "הכל", status: "ALL" },
  ...PLUGIN_STATUSES.map((s) => ({ label: STATUS_LABELS[s], status: s })),
];

type ReasonAction = { kind: "approve" | "reject"; plugin: PluginManifest } | null;

export default function MarketplacePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);
  const [detailPlugin, setDetailPlugin] = useState<PluginManifest | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);

  const statusFilter = TABS[tab]?.status ?? "ALL";

  const plugins = useQuery({
    queryKey: ["admin-plugins", statusFilter],
    queryFn: () =>
      apiGet<{ items: PluginManifest[] }>(
        statusFilter === "ALL"
          ? "/api/v1/plugins"
          : `/api/v1/plugins?status=${statusFilter}`,
      ),
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-plugins"] });

  const approve = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiPost<{ ok: boolean; plugin: PluginManifest }>(
        `/api/v1/plugins/${input.id}/approve`,
        { reason: input.reason },
      ),
    onMutate: (input) => setBusyPluginId(input.id),
    onSuccess: async () => {
      setActionError(null);
      setReasonAction(null);
      await invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
    onSettled: () => setBusyPluginId(null),
  });

  const reject = useMutation({
    mutationFn: (input: { id: string; reason: string }) =>
      apiPost<{ ok: boolean; plugin: PluginManifest }>(
        `/api/v1/plugins/${input.id}/reject`,
        { reason: input.reason },
      ),
    onMutate: (input) => setBusyPluginId(input.id),
    onSuccess: async () => {
      setActionError(null);
      setReasonAction(null);
      await invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
    onSettled: () => setBusyPluginId(null),
  });

  const enable = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ ok: boolean; plugin: PluginManifest }>(`/api/v1/plugins/${id}/enable`, {}),
    onMutate: (id) => setBusyPluginId(id),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
    onSettled: () => setBusyPluginId(null),
  });

  const disable = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ ok: boolean; plugin: PluginManifest }>(`/api/v1/plugins/${id}/disable`, {}),
    onMutate: (id) => setBusyPluginId(id),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
    onSettled: () => setBusyPluginId(null),
  });

  const uninstall = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ ok: boolean; plugin: PluginManifest | undefined }>(
        `/api/v1/plugins/${id}/uninstall`,
        {},
      ),
    onMutate: (id) => setBusyPluginId(id),
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
    onSettled: () => setBusyPluginId(null),
  });

  const register = useMutation({
    mutationFn: (manifest: NewPluginManifestInput) =>
      apiPost<{ ok: boolean; plugin: PluginManifest }>("/api/v1/plugins", manifest),
    onSuccess: async () => {
      setRegisterOpen(false);
      await invalidate();
    },
  });

  const items = plugins.data?.items ?? [];

  const counts = useMemo(() => {
    const all = plugins.data?.items ?? [];
    return {
      total: all.length,
    };
  }, [plugins.data]);

  if (plugins.isError) {
    return (
      <Alert severity="warning">
        אין הרשאה. <Link href="/admin/login">התחברות אדמין</Link>
      </Alert>
    );
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 1100, width: "100%" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography variant="h1">מרקטפלייס פלאגינים</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {counts.total} פלאגינים רשומים · אישור / דחייה / הפעלה / השבתה / הסרה
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => setRegisterOpen(true)} sx={{ fontWeight: 700 }}>
          רישום פלאגין חדש
        </Button>
      </Box>

      {actionError ? <Alert severity="error">{actionError}</Alert> : null}

      <Tabs
        value={tab}
        onChange={(_, v: number) => setTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        {TABS.map((t) => (
          <Tab key={t.status} label={t.label} />
        ))}
      </Tabs>

      {plugins.isLoading ? (
        <Typography color="text.secondary">טוען…</Typography>
      ) : items.length === 0 ? (
        <Alert severity="info">אין פלאגינים במצב זה.</Alert>
      ) : (
        <Stack spacing={1.5}>
          {items.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              busy={busyPluginId === plugin.id}
              onOpenDetail={setDetailPlugin}
              onApprove={(p) => setReasonAction({ kind: "approve", plugin: p })}
              onReject={(p) => setReasonAction({ kind: "reject", plugin: p })}
              onEnable={(p) => enable.mutate(p.id)}
              onDisable={(p) => disable.mutate(p.id)}
              onUninstall={(p) => uninstall.mutate(p.id)}
            />
          ))}
        </Stack>
      )}

      <PluginDetailDialog plugin={detailPlugin} onClose={() => setDetailPlugin(null)} />

      <ReasonDialog
        open={reasonAction !== null}
        title={reasonAction?.kind === "approve" ? "אישור פלאגין" : "דחיית פלאגין"}
        description={
          reasonAction
            ? `${reasonAction.plugin.name} (${reasonAction.plugin.id}) — פעולה זו מתועדת ואינה ניתנת לביטול.`
            : ""
        }
        confirmLabel={reasonAction?.kind === "approve" ? "אישור" : "דחייה"}
        confirmColor={reasonAction?.kind === "approve" ? "success" : "error"}
        submitting={approve.isPending || reject.isPending}
        onClose={() => setReasonAction(null)}
        onConfirm={(reason) => {
          if (!reasonAction) return;
          if (reasonAction.kind === "approve") {
            approve.mutate({ id: reasonAction.plugin.id, reason });
          } else {
            reject.mutate({ id: reasonAction.plugin.id, reason });
          }
        }}
      />

      <RegisterPluginDialog
        open={registerOpen}
        submitting={register.isPending}
        submitError={register.isError ? (register.error as Error).message : null}
        onClose={() => setRegisterOpen(false)}
        onSubmit={(manifest) => register.mutate(manifest)}
      />
    </Stack>
  );
}
