"use client";

import { useState } from "react";
import {
  Alert,
  Box,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

type ApprovalRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CONSUMED";

interface ApprovalRequestItem {
  id: string;
  entityType: string;
  action: string;
  requestedBy: string;
  requestedAt: string;
  status: ApprovalRequestStatus;
  reason: string;
  context: Record<string, unknown>;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
}

interface ApprovalListResponse {
  items: ApprovalRequestItem[];
}

function statusColor(
  s: ApprovalRequestStatus,
): "warning" | "success" | "error" | "default" {
  if (s === "PENDING") return "warning";
  if (s === "APPROVED" || s === "CONSUMED") return "success";
  if (s === "REJECTED") return "error";
  return "default";
}

const STATUS_LABEL: Record<ApprovalRequestStatus, string> = {
  PENDING: "ממתין",
  APPROVED: "אושר",
  REJECTED: "נדחה",
  CONSUMED: "נוצל",
};

export function ApprovalQueuePanel() {
  const queryClient = useQueryClient();
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  const approvals = useQuery({
    queryKey: ["admin-approvals", "PENDING"],
    queryFn: () =>
      apiGet<ApprovalListResponse>("/api/v1/approvals?status=PENDING"),
    retry: false,
    refetchInterval: 30_000,
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      approve,
      reason,
    }: {
      id: string;
      approve: boolean;
      reason: string;
    }) =>
      apiPost<ApprovalRequestItem>(`/api/v1/approvals/${id}/decide`, {
        approve,
        reason,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-approvals"] });
    },
  });

  if (approvals.isLoading) {
    return <Typography color="text.secondary">טוען תור אישורים…</Typography>;
  }

  if (approvals.isError) {
    return (
      <Alert severity="error">
        {(approvals.error as Error).message ?? "נכשלה שליפת תור האישורים."}
      </Alert>
    );
  }

  const items = approvals.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        בקשות אישור הממתינות להחלטת אדמין (למשל CONFIGURATION.EXECUTE) — כל
        אישור מאשר ביצוע פעולה אחת בלבד ("אישור אחד, ביצוע אחד").
      </Typography>
      {decide.isError ? (
        <Alert severity="error">{(decide.error as Error).message}</Alert>
      ) : null}
      {items.length === 0 ? (
        <Alert severity="success">אין בקשות אישור ממתינות.</Alert>
      ) : (
        <Table size="small" aria-label="תור אישורים">
          <TableHead>
            <TableRow>
              <TableCell>ישות · פעולה</TableCell>
              <TableCell>נדרש על ידי</TableCell>
              <TableCell>סיבה</TableCell>
              <TableCell>סטטוס</TableCell>
              <TableCell>הכרעה</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => {
              const reasonValue = reasonById[item.id] ?? "";
              const pending = item.status === "PENDING";
              const isThisMutating =
                decide.isPending && decide.variables?.id === item.id;
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <Typography fontWeight={700} variant="body2">
                      {item.entityType}.{item.action}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.requestedAt}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{item.requestedBy}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{item.reason}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={STATUS_LABEL[item.status]}
                      color={statusColor(item.status)}
                    />
                  </TableCell>
                  <TableCell>
                    {pending ? (
                      <Stack spacing={1} sx={{ minWidth: 220 }}>
                        <TextField
                          size="small"
                          placeholder="נימוק להחלטה (חובה)"
                          value={reasonValue}
                          onChange={(e) =>
                            setReasonById((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        />
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            disabled={
                              isThisMutating || reasonValue.trim().length === 0
                            }
                            onClick={() =>
                              decide.mutate({
                                id: item.id,
                                approve: true,
                                reason: reasonValue.trim(),
                              })
                            }
                          >
                            אישור
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            disabled={
                              isThisMutating || reasonValue.trim().length === 0
                            }
                            onClick={() =>
                              decide.mutate({
                                id: item.id,
                                approve: false,
                                reason: reasonValue.trim(),
                              })
                            }
                          >
                            דחייה
                          </Button>
                        </Stack>
                      </Stack>
                    ) : (
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {item.decidedBy ?? "—"} · {item.decisionReason ?? "—"}
                        </Typography>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Stack>
  );
}
