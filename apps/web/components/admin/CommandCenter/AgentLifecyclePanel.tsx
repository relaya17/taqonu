"use client";

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
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";

interface AgentLifecycleItem {
  agentId: string;
  enabled: boolean;
  core: boolean;
}

interface AgentLifecycleResponse {
  items: AgentLifecycleItem[];
}

export function AgentLifecyclePanel() {
  const queryClient = useQueryClient();

  const lifecycle = useQuery({
    queryKey: ["admin-agent-lifecycle"],
    queryFn: () => apiGet<AgentLifecycleResponse>("/api/v1/agents/lifecycle"),
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: ({ agentId, enable }: { agentId: string; enable: boolean }) =>
      apiPost<AgentLifecycleItem>(
        `/api/v1/agents/${agentId}/${enable ? "enable" : "disable"}`,
        {},
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-agent-lifecycle"] });
    },
  });

  if (lifecycle.isLoading) {
    return <Typography color="text.secondary">טוען מצב סוכנים…</Typography>;
  }

  if (lifecycle.isError) {
    return (
      <Alert severity="error">
        {(lifecycle.error as Error).message ?? "נכשלה שליפת מצב הסוכנים."}
      </Alert>
    );
  }

  const items = lifecycle.data?.items ?? [];

  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        מפל חיים תפעולי לסוכני ה-Fabric — סוכני ליבה (core) מוגנים מכיבוי דרך
        overlay זה.
      </Typography>
      {toggle.isError ? (
        <Alert severity="error">{(toggle.error as Error).message}</Alert>
      ) : null}
      <Table size="small" aria-label="מצב סוכנים">
        <TableHead>
          <TableRow>
            <TableCell>סוכן</TableCell>
            <TableCell>סוג</TableCell>
            <TableCell>מצב</TableCell>
            <TableCell>פעולה</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const isThisMutating =
              toggle.isPending && toggle.variables?.agentId === item.agentId;
            return (
              <TableRow key={item.agentId}>
                <TableCell>
                  <Typography component="code" variant="body2">
                    {item.agentId}
                  </Typography>
                </TableCell>
                <TableCell>
                  {item.core ? (
                    <Chip size="small" label="ליבה" variant="outlined" />
                  ) : (
                    <Chip size="small" label="רגיל" variant="outlined" color="default" />
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={item.enabled ? "פעיל" : "מושבת"}
                    color={item.enabled ? "success" : "default"}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isThisMutating || (item.enabled && item.core)}
                    onClick={() =>
                      toggle.mutate({ agentId: item.agentId, enable: !item.enabled })
                    }
                  >
                    {item.enabled ? "השבת" : "הפעל"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Stack>
  );
}
