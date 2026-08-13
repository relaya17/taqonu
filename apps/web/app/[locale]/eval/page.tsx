"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface EvalSuite {
  id: string;
  name: string;
  note?: string;
}

interface EvalResult {
  dimension: string;
  score: number;
  passed: boolean;
  notes: string | null;
}

interface EvalRun {
  id: string;
  suiteId: string;
  status: string;
  writeGateOpen: boolean;
  results: EvalResult[];
  completedAt: string | null;
}

const WRITE_SUITE = "11111111-1111-4111-8111-111111111111";
const SELF_SUITE = "22222222-2222-4222-8222-222222222222";

export default function EvalPage() {
  const t = useTranslations("eval");
  const queryClient = useQueryClient();
  const [suiteId, setSuiteId] = useState(WRITE_SUITE);

  const suites = useQuery({
    queryKey: ["eval-suites"],
    queryFn: () => apiGet<{ items: EvalSuite[] }>("/api/v1/eval/suites"),
  });

  const runs = useQuery({
    queryKey: ["eval-runs"],
    queryFn: () => apiGet<{ items: EvalRun[] }>("/api/v1/eval/runs"),
  });

  const run = useMutation({
    mutationFn: () =>
      apiPost<EvalRun>("/api/v1/eval/runs", { suiteId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["eval-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["gates"] });
      await queryClient.invalidateQueries({ queryKey: ["billing-plan"] });
    },
  });

  const latest = run.data ?? runs.data?.items?.[0];

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <TextField
        select
        label={t("suite")}
        value={suiteId}
        onChange={(e) => setSuiteId(e.target.value)}
        helperText={
          suites.data?.items.find((s) => s.id === suiteId)?.note ?? t("suiteHelp")
        }
      >
        <MenuItem value={WRITE_SUITE}>mvp-write-gate</MenuItem>
        <MenuItem value={SELF_SUITE}>def-000-self-audit</MenuItem>
      </TextField>

      <Button
        variant="contained"
        onClick={() => run.mutate()}
        disabled={run.isPending}
        sx={{ alignSelf: "start" }}
      >
        {t("run")}
      </Button>

      {run.isError ? (
        <Alert severity="error">{(run.error as Error).message}</Alert>
      ) : null}

      {latest ? (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip label={latest.status} color={latest.status === "PASSED" ? "success" : "error"} />
            <Chip
              label={latest.writeGateOpen ? t("gateOpen") : t("gateClosed")}
              color={latest.writeGateOpen ? "success" : "warning"}
              variant="outlined"
            />
          </Stack>
          <Stack spacing={1} sx={{ mt: 2 }}>
            {latest.results.map((r) => (
              <Box
                key={r.dimension}
                sx={{ py: 1, borderBottom: "1px solid rgba(26,31,42,0.12)" }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={700}>{r.dimension}</Typography>
                  <Chip
                    size="small"
                    label={`${Math.round(r.score * 100)}%`}
                    color={r.passed ? "success" : "error"}
                  />
                </Stack>
                {r.notes ? (
                  <Typography variant="body2" color="text.secondary">
                    {r.notes}
                  </Typography>
                ) : null}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : (
        <Typography color="text.secondary">{t("empty")}</Typography>
      )}
    </Stack>
  );
}
