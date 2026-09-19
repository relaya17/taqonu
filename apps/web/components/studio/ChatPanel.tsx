"use client";

import { useEffect, useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

interface ThreadListItem {
  threadId: string;
  projectId: string | null;
  updatedAt: string;
  turnCount: number;
  preview: string;
}

interface ThreadTurn {
  role: "user" | "assistant";
  content: string;
}

const panelBorder = "1px solid rgba(232,234,238,0.12)";
const panelBg = "rgba(28,31,38,0.92)";

/**
 * Agent chat thread for a linked project — moved here from the old standalone
 * Workbench page (apps/web/app/[locale]/workbench/page.tsx) so it can live as
 * a tab inside Studio. History is loaded from the tenant-owned conversation
 * store so a reload continues the same thread.
 */
export function ChatPanel({
  projectId,
  selectedPath,
  embedded = false,
}: {
  projectId: string;
  selectedPath: string | null;
  embedded?: boolean;
}) {
  const t = useTranslations("workbench");
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["conversation-threads", projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiGet<{ items: ThreadListItem[] }>(
        `/api/v1/conversation/threads?projectId=${encodeURIComponent(projectId)}`,
      ),
  });

  useEffect(() => {
    setThreadId(listQuery.data?.items[0]?.threadId ?? null);
  }, [projectId, listQuery.data]);

  const threadQuery = useQuery({
    queryKey: ["conversation-thread", threadId],
    enabled: Boolean(threadId),
    queryFn: () =>
      apiGet<{ items: ThreadTurn[] }>(
        `/api/v1/conversation/threads/${encodeURIComponent(threadId!)}`,
      ),
  });

  const thread: ChatTurn[] = (threadQuery.data?.items ?? []).map((turn) => ({
    role: turn.role,
    text: turn.content,
  }));

  const chat = useMutation({
    mutationFn: async () => {
      const focus = selectedPath ? `\n\n${t("focusFile", { path: selectedPath })}` : "";
      return apiPost<{ answer: string; threadId: string }>("/api/v1/conversation/message", {
        message: `${message.trim()}${focus}`,
        projectId: projectId || null,
        threadId,
      });
    },
    onSuccess: async (res) => {
      setThreadId(res.threadId);
      setMessage("");
      await queryClient.invalidateQueries({
        queryKey: ["conversation-threads", projectId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversation-thread", res.threadId],
      });
    },
  });

  return (
    <Box
      sx={{
        border: panelBorder,
        borderRadius: 3,
        bgcolor: panelBg,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: embedded ? 420 : 280,
        boxShadow: embedded ? "0 12px 40px rgba(0,0,0,0.35)" : "none",
      }}
    >
      <Typography variant="overline" sx={{ px: 1.5, py: 1, borderBottom: panelBorder, color: "#DCDDE1" }}>
        {t("agentChat")}
      </Typography>
      <Box sx={{ flex: 1, overflow: "auto", p: 1.25 }}>
        {thread.length === 0 ? (
          <Typography variant="body2" sx={{ color: "#8B9099" }}>
            {threadQuery.isLoading || listQuery.isLoading ? t("sending") : t("chatEmpty")}
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            {thread.map((turn, i) => (
              <Box
                key={`${turn.role}-${i}`}
                sx={{
                  p: 1,
                  borderRadius: 1.5,
                  bgcolor: turn.role === "user" ? "rgba(154,158,168,0.12)" : "transparent",
                  border: turn.role === "assistant" ? panelBorder : "none",
                }}
              >
                <Typography variant="caption" fontWeight={700} sx={{ color: "#8B9099" }}>
                  {turn.role === "user" ? t("you") : t("agent")}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", color: "#DCDDE1" }}>
                  {turn.text}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Box>
      <Stack spacing={1} sx={{ p: 1.25, borderTop: panelBorder }}>
        <TextField
          size="small"
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t("chatPlaceholder")}
          disabled={!projectId}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#DCDDE1",
              bgcolor: "rgba(255,255,255,0.04)",
              "& fieldset": { borderColor: "rgba(232,234,238,0.2)" },
            },
          }}
        />
        <Button
          variant="contained"
          disabled={!projectId || !message.trim() || chat.isPending}
          onClick={() => chat.mutate()}
        >
          {chat.isPending ? t("sending") : t("send")}
        </Button>
        {listQuery.isError ? (
          <Alert severity="error">{(listQuery.error as Error).message}</Alert>
        ) : null}
        {threadQuery.isError ? (
          <Alert severity="error">{(threadQuery.error as Error).message}</Alert>
        ) : null}
        {chat.isError ? <Alert severity="error">{(chat.error as Error).message}</Alert> : null}
      </Stack>
    </Box>
  );
}
