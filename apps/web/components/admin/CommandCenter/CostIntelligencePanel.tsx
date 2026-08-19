"use client";

import {
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

interface CostIntelligenceProjectBreakdown {
  projectId: string | null;
  totalUsd: number;
  runCount: number;
  dispatchCount: number;
}

interface CostIntelligenceAgentBreakdown {
  agentId: string;
  totalUsd: number;
  runCount: number;
}

interface CostIntelligenceSummary {
  totalUsd: number;
  runCount: number;
  dispatchCount: number;
  byProject: CostIntelligenceProjectBreakdown[];
  byAgent: CostIntelligenceAgentBreakdown[];
  generatedAt: string;
  source: string;
  note: string;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function CostIntelligencePanel() {
  const cost = useQuery({
    queryKey: ["admin-cost-intelligence"],
    queryFn: () => apiGet<CostIntelligenceSummary>("/api/v1/cost-intelligence"),
    retry: false,
  });

  if (cost.isLoading) {
    return <Typography color="text.secondary">טוען אינטליגנציית עלויות…</Typography>;
  }

  if (cost.isError) {
    return (
      <Alert severity="error">
        {(cost.error as Error).message ?? "נכשלה שליפת נתוני עלויות."}
      </Alert>
    );
  }

  const data = cost.data;
  if (!data) return null;

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        פילוח עלויות LLM אמיתי, מבוסס יומן ה-audit ({data.source}).
      </Typography>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.5}>
        <Typography variant="body2">
          סה"כ עלות: <strong>{fmtUsd(data.totalUsd)}</strong>
        </Typography>
        <Typography variant="body2">
          הרצות: <strong>{data.runCount}</strong>
        </Typography>
        <Typography variant="body2">
          Dispatches: <strong>{data.dispatchCount}</strong>
        </Typography>
      </Stack>

      <Typography variant="h2" sx={{ fontSize: "1.1rem", mt: 1 }}>
        לפי פרויקט
      </Typography>
      {data.byProject.length === 0 ? (
        <Typography color="text.secondary">אין נתונים.</Typography>
      ) : (
        <Table size="small" aria-label="עלות לפי פרויקט">
          <TableHead>
            <TableRow>
              <TableCell>פרויקט</TableCell>
              <TableCell align="right">עלות</TableCell>
              <TableCell align="right">הרצות</TableCell>
              <TableCell align="right">Dispatches</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.byProject.map((p, i) => (
              <TableRow key={p.projectId ?? `portfolio-${i}`}>
                <TableCell>
                  <Typography component="code" variant="body2">
                    {p.projectId ?? "כללי (ללא פרויקט)"}
                  </Typography>
                </TableCell>
                <TableCell align="right">{fmtUsd(p.totalUsd)}</TableCell>
                <TableCell align="right">{p.runCount}</TableCell>
                <TableCell align="right">{p.dispatchCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Typography variant="h2" sx={{ fontSize: "1.1rem", mt: 1 }}>
        לפי סוכן
      </Typography>
      {data.byAgent.length === 0 ? (
        <Typography color="text.secondary">אין נתונים.</Typography>
      ) : (
        <Table size="small" aria-label="עלות לפי סוכן">
          <TableHead>
            <TableRow>
              <TableCell>סוכן</TableCell>
              <TableCell align="right">עלות</TableCell>
              <TableCell align="right">הרצות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.byAgent.map((a) => (
              <TableRow key={a.agentId}>
                <TableCell>
                  <Typography component="code" variant="body2">
                    {a.agentId}
                  </Typography>
                </TableCell>
                <TableCell align="right">{fmtUsd(a.totalUsd)}</TableCell>
                <TableCell align="right">{a.runCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Typography variant="caption" color="text.secondary">
        {data.note}
      </Typography>
    </Stack>
  );
}
