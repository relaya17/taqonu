"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";
import { AUTH_SESSION_QUERY_KEY, fetchAuthSession } from "@/lib/auth-session";

/** waiveGateSchema (packages/shared/src/schemas/gate.schema.ts). */
const WAIVE_REASON_MIN = 3;
const WAIVE_REASON_MAX = 2000;

interface GateNode {
  id: string;
  title: string;
  status: string;
  blockerReason: string | null;
  waivedBy?: string | null;
  waivedReason?: string | null;
}

interface GateGraph {
  id: string;
  name: string;
  nodes: GateNode[];
  edges: Array<{ from: string; to: string }>;
  plainLanguageSummary: string;
  evaluatedAt: string;
}

export function GatesView() {
  const t = useTranslations("gates");
  const tx = useTranslations("gatesExtras");
  const queryClient = useQueryClient();
  const [waiveNode, setWaiveNode] = useState<GateNode | null>(null);
  const [waivedBy, setWaivedBy] = useState("");
  const [reason, setReason] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [waivedNotice, setWaivedNotice] = useState<string | null>(null);

  const session = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: () => fetchAuthSession<{ id: string; email: string }>(),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!waivedBy && session.data?.user.email) setWaivedBy(session.data.user.email);
  }, [session.data, waivedBy]);

  const gates = useQuery({
    queryKey: ["gates"],
    queryFn: () => apiGet<{ graph: GateGraph }>("/api/v1/gates"),
  });

  const evaluate = useMutation({
    mutationFn: () => apiPost<{ graph: GateGraph }>("/api/v1/gates/evaluate", {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["gates"] });
    },
  });

  const graph = gates.data?.graph ?? evaluate.data?.graph;

  const waive = useMutation({
    mutationFn: (input: { graphId: string; gateId: string }) =>
      apiPost<{ graph: GateGraph }>(
        `/api/v1/gates/${encodeURIComponent(input.graphId)}/waive`,
        { gateId: input.gateId, waivedBy: waivedBy.trim(), reason: reason.trim() },
      ),
    onSuccess: (data, input) => {
      queryClient.setQueryData(["gates"], { graph: data.graph });
      setWaivedNotice(tx("waivedNotice", { gate: input.gateId }));
      closeWaive();
    },
  });

  function openWaive(node: GateNode) {
    waive.reset();
    setReason("");
    setConfirmStep(false);
    setWaiveNode(node);
  }

  function closeWaive() {
    setWaiveNode(null);
    setConfirmStep(false);
  }

  const reasonValid =
    reason.trim().length >= WAIVE_REASON_MIN && reason.trim().length <= WAIVE_REASON_MAX;
  const color = (status: string) => {
    if (status === "PASS" || status === "WAIVED") return "success" as const;
    if (status === "FAIL" || status === "BLOCKED") return "error" as const;
    return "warning" as const;
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 920 }}>
      <Box>
        <Typography variant="h1">{t("title")}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}
        </Typography>
      </Box>

      <Button
        variant="contained"
        onClick={() => evaluate.mutate()}
        disabled={evaluate.isPending}
        sx={{ alignSelf: "start" }}
      >
        {t("evaluate")}
      </Button>

      {graph ? (
        <>
          {waivedNotice ? (
            <Alert severity="success" onClose={() => setWaivedNotice(null)}>
              {waivedNotice}
            </Alert>
          ) : null}
          <Alert severity="info">{graph.plainLanguageSummary}</Alert>
          <Typography variant="caption" color="text.secondary">
            {t("evaluatedAt", { at: graph.evaluatedAt })}
          </Typography>
          <Stack spacing={1.5}>
            {graph.nodes.map((node) => (
              <Box
                key={node.id}
                sx={{
                  py: 1.5,
                  borderBottom: "1px solid rgba(26,31,42,0.12)",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={700}>{node.title}</Typography>
                  <Chip size="small" color={color(node.status)} label={node.status} />
                </Stack>
                {node.blockerReason ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {node.blockerReason}
                  </Typography>
                ) : null}
                {node.status === "WAIVED" && node.waivedBy ? (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {tx("waivedBy", { by: node.waivedBy })}
                  </Typography>
                ) : null}
                {node.status === "FAIL" || node.status === "BLOCKED" ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    sx={{ mt: 1 }}
                    onClick={() => openWaive(node)}
                  >
                    {tx("waive")}
                  </Button>
                ) : null}
              </Box>
            ))}
          </Stack>
        </>
      ) : gates.isError ? (
        <Alert severity="error">{(gates.error as Error).message}</Alert>
      ) : evaluate.isError ? (
        <Alert severity="error">{(evaluate.error as Error).message}</Alert>
      ) : (
        <Typography color="text.secondary">{t("empty")}</Typography>
      )}

      <Dialog open={Boolean(waiveNode)} onClose={closeWaive} fullWidth maxWidth="sm">
        <DialogTitle>{tx("dialogTitle", { gate: waiveNode?.title ?? "" })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{tx("dialogBody")}</DialogContentText>
          <TextField
            label={tx("waivedByLabel")}
            value={waivedBy}
            onChange={(e) => setWaivedBy(e.target.value)}
            required
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            inputProps={{ maxLength: 200 }}
            disabled={confirmStep}
          />
          <TextField
            label={tx("reasonLabel")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            fullWidth
            multiline
            minRows={3}
            sx={{ mt: 2 }}
            inputProps={{ maxLength: WAIVE_REASON_MAX }}
            helperText={tx("reasonHelp", { min: WAIVE_REASON_MIN })}
            error={reason.length > 0 && !reasonValid}
            disabled={confirmStep}
          />
          {confirmStep ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {tx("confirm", { gate: waiveNode?.title ?? "" })}
            </Alert>
          ) : null}
          {waive.isError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {(waive.error as Error).message}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeWaive}>{tx("cancel")}</Button>
          {confirmStep ? (
            <Button
              variant="contained"
              color="warning"
              disabled={waive.isPending || !graph || !waiveNode}
              onClick={() =>
                graph && waiveNode
                  ? waive.mutate({ graphId: graph.id, gateId: waiveNode.id })
                  : undefined
              }
            >
              {waive.isPending ? tx("waiving") : tx("confirmWaive")}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={!waivedBy.trim() || !reasonValid}
              onClick={() => setConfirmStep(true)}
            >
              {tx("continue")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
