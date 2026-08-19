"use client";

import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

type PluginManifestStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "ENABLED"
  | "DISABLED";

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  declaredTools: string[];
  declaredCapabilities: string[];
  declaredEntityActions: { entityType: string; action: string }[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  installedAt?: string;
  status: PluginManifestStatus;
}

interface PluginsListResponse {
  items: PluginManifest[];
}

function statusColor(
  s: PluginManifestStatus,
): "warning" | "success" | "error" | "default" {
  if (s === "PENDING_REVIEW") return "warning";
  if (s === "APPROVED" || s === "ENABLED") return "success";
  if (s === "REJECTED") return "error";
  return "default";
}

const STATUS_LABEL: Record<PluginManifestStatus, string> = {
  PENDING_REVIEW: "ממתין לבדיקה",
  APPROVED: "אושר",
  REJECTED: "נדחה",
  ENABLED: "פעיל",
  DISABLED: "מושבת",
};

function riskColor(
  r: PluginManifest["riskLevel"],
): "success" | "info" | "warning" | "error" {
  if (r === "LOW") return "success";
  if (r === "MEDIUM") return "info";
  if (r === "HIGH") return "warning";
  return "error";
}

export function PluginsPanel() {
  const queryClient = useQueryClient();
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const plugins = useQuery({
    queryKey: ["admin-plugins"],
    queryFn: () => apiGet<PluginsListResponse>("/api/v1/plugins"),
    retry: false,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-plugins"] });

  const approve = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/plugins/${id}/approve`, {
        reason: reasonById[id]?.trim() || "Approved via Command Center",
      }),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) =>
      apiPost(`/api/v1/plugins/${id}/reject`, {
        reason: reasonById[id]?.trim() || "Rejected via Command Center",
      }),
    onSuccess: invalidate,
  });
  const enable = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/plugins/${id}/enable`, {}),
    onSuccess: invalidate,
  });
  const disable = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/plugins/${id}/disable`, {}),
    onSuccess: invalidate,
  });
  const uninstall = useMutation({
    mutationFn: (id: string) => apiPost(`/api/v1/plugins/${id}/uninstall`, {}),
    onSuccess: invalidate,
  });

  const pending = approve.isPending || reject.isPending || enable.isPending || disable.isPending || uninstall.isPending;

  if (plugins.isLoading) {
    return <Typography color="text.secondary">טוען פלאגינים…</Typography>;
  }

  if (plugins.isError) {
    return (
      <Alert severity="error">
        {(plugins.error as Error).message ?? "נכשלה שליפת רשימת הפלאגינים."}
      </Alert>
    );
  }

  const items = plugins.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        רישום/אישור/הפעלה של Plugin SDK — נתונים דקלרטיביים בלבד (ללא הרצת קוד
        צד-שלישי, ראו הערת scope בשרת). לניהול מלא/עיון בשוק:{" "}
        <Link href="/admin/marketplace">Marketplace</Link>.
      </Typography>

      {(approve.isError || reject.isError || enable.isError || disable.isError || uninstall.isError) ? (
        <Alert severity="error">
          {(
            (approve.error ?? reject.error ?? enable.error ?? disable.error ?? uninstall.error) as
              | Error
              | undefined
          )?.message ?? "הפעולה נכשלה."}
        </Alert>
      ) : null}

      {items.length === 0 ? (
        <Alert severity="info">אין פלאגינים רשומים.</Alert>
      ) : (
        <Table size="small" aria-label="פלאגינים">
          <TableHead>
            <TableRow>
              <TableCell>שם</TableCell>
              <TableCell>מזהה / גרסה</TableCell>
              <TableCell>סטטוס</TableCell>
              <TableCell>סיכון</TableCell>
              <TableCell>יכולות</TableCell>
              <TableCell align="right">פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Typography fontWeight={600}>{p.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {p.author}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography component="code" variant="body2">
                    {p.id}@{p.version}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" label={STATUS_LABEL[p.status]} color={statusColor(p.status)} />
                </TableCell>
                <TableCell>
                  <Chip size="small" label={p.riskLevel} color={riskColor(p.riskLevel)} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {p.declaredCapabilities.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    ) : (
                      p.declaredCapabilities.map((c) => (
                        <Chip key={c} size="small" variant="outlined" label={c} />
                      ))
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                    {p.status === "PENDING_REVIEW" ? (
                      <>
                        <TextField
                          size="small"
                          placeholder="סיבה (אופציונלי)"
                          value={reasonById[p.id] ?? ""}
                          onChange={(e) =>
                            setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          sx={{ width: 160 }}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          disabled={pending}
                          onClick={() => approve.mutate(p.id)}
                        >
                          אשר
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="error"
                          disabled={pending}
                          onClick={() => reject.mutate(p.id)}
                        >
                          דחה
                        </Button>
                      </>
                    ) : null}
                    {p.status === "APPROVED" || p.status === "DISABLED" ? (
                      <Button
                        size="small"
                        variant="contained"
                        disabled={pending}
                        onClick={() => enable.mutate(p.id)}
                      >
                        הפעל
                      </Button>
                    ) : null}
                    {p.status === "ENABLED" ? (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={pending}
                        onClick={() => disable.mutate(p.id)}
                      >
                        השבת
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      variant="text"
                      color="error"
                      disabled={pending}
                      onClick={() => uninstall.mutate(p.id)}
                    >
                      הסר
                    </Button>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
