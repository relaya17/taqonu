"use client";

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface GateNode {
  id: string;
  title: string;
  status: string;
  blockerReason: string | null;
}

interface GateGraph {
  id: string;
  name: string;
  nodes: GateNode[];
  edges: Array<{ from: string; to: string }>;
  plainLanguageSummary: string;
  evaluatedAt: string;
}

export default function GatesPage() {
  const t = useTranslations("gates");
  const queryClient = useQueryClient();

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
              </Box>
            ))}
          </Stack>
        </>
      ) : (
        <Typography color="text.secondary">{t("empty")}</Typography>
      )}
    </Stack>
  );
}
