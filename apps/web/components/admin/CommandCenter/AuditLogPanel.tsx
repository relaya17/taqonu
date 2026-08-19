"use client";

import { useState } from "react";
import {
  Alert,
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
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

type AuditRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AuditApprovalStatus = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
type AuditResultStatus = "SUCCESS" | "FAILURE" | "PARTIAL";
type AuditActorKind = "USER" | "AGENT" | "SYSTEM";

interface UnifiedAuditEntry {
  id?: string;
  at?: string;
  type: string;
  actorId: string | null;
  actorKind: AuditActorKind;
  reason: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  policy: string | null;
  risk: AuditRiskLevel;
  approval: AuditApprovalStatus;
  result: AuditResultStatus;
  projectId?: string | null;
  correlationId?: string;
  causationId?: string | null;
  ownerId?: string | null;
}

interface AuditLogResponse {
  items: Record<string, unknown>[];
  total: number;
  durableCount: number;
  durablePath: string;
  unified: UnifiedAuditEntry[];
  note: string;
}

function riskColor(
  r: AuditRiskLevel,
): "info" | "warning" | "error" | "success" {
  if (r === "CRITICAL" || r === "HIGH") return "error";
  if (r === "MEDIUM") return "warning";
  return "success";
}

function resultColor(
  r: AuditResultStatus,
): "success" | "error" | "warning" {
  if (r === "SUCCESS") return "success";
  if (r === "FAILURE") return "error";
  return "warning";
}

const APPROVAL_LABEL: Record<AuditApprovalStatus, string> = {
  NOT_REQUIRED: "לא נדרש",
  PENDING: "ממתין",
  APPROVED: "אושר",
  REJECTED: "נדחה",
};

export function AuditLogPanel() {
  const [actorIdInput, setActorIdInput] = useState("");
  const [actorId, setActorId] = useState("");

  const audit = useQuery({
    queryKey: ["admin-audit-log", actorId],
    queryFn: () =>
      apiGet<AuditLogResponse>(
        `/api/v1/audit${actorId ? `?actorId=${encodeURIComponent(actorId)}` : ""}`,
      ),
    retry: false,
  });

  const applyFilter = () => setActorId(actorIdInput.trim());

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        יומן ביקורת מאוחד (WHO / WHAT / WHEN / WHY / INPUT / OUTPUT / POLICY /
        RISK / APPROVAL / RESULT) — נשלף ישירות מהשרת.
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          label="סינון לפי מזהה מבצע (actorId)"
          value={actorIdInput}
          onChange={(e) => setActorIdInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilter();
          }}
        />
        <Chip
          label="סינון"
          onClick={applyFilter}
          color="primary"
          variant="outlined"
          clickable
        />
      </Stack>

      {audit.isLoading ? (
        <Typography color="text.secondary">טוען יומן ביקורת…</Typography>
      ) : null}

      {audit.isError ? (
        <Alert severity="error">
          {(audit.error as Error).message ?? "נכשלה שליפת יומן הביקורת."}
        </Alert>
      ) : null}

      {audit.data ? (
        <>
          <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Typography variant="body2">
              רשומות מאוחדות מוצגות: <strong>{audit.data.unified.length}</strong>
            </Typography>
            <Typography variant="body2">
              סה"כ רשומות בקובץ העמיד: <strong>{audit.data.durableCount}</strong>
            </Typography>
          </Stack>

          {audit.data.unified.length === 0 ? (
            <Typography color="text.secondary">אין רשומות ביקורת.</Typography>
          ) : (
            <Table size="small" aria-label="יומן ביקורת">
              <TableHead>
                <TableRow>
                  <TableCell>זמן</TableCell>
                  <TableCell>סוג</TableCell>
                  <TableCell>מבצע</TableCell>
                  <TableCell>סיכון</TableCell>
                  <TableCell>אישור</TableCell>
                  <TableCell>תוצאה</TableCell>
                  <TableCell>סיבה</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {audit.data.unified.map((entry, i) => (
                  <TableRow key={entry.id ?? entry.correlationId ?? i}>
                    <TableCell>
                      <Typography variant="body2">
                        {entry.at ? new Date(entry.at).toLocaleString() : "—"}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography component="code" variant="body2">
                        {entry.type}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {entry.actorId ? (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2">{entry.actorId}</Typography>
                          <Chip size="small" label={entry.actorKind} variant="outlined" />
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={entry.risk}
                        color={riskColor(entry.risk)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {APPROVAL_LABEL[entry.approval]}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={entry.result}
                        color={resultColor(entry.result)}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320, whiteSpace: "normal" }}>
                      <Typography variant="body2">{entry.reason}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Typography variant="caption" color="text.secondary">
            {audit.data.note}
          </Typography>
        </>
      ) : null}
    </Stack>
  );
}
