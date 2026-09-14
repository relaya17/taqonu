"use client";

import { useState } from "react";
import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/api";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const panelBorder = "1px solid rgba(232,234,238,0.12)";
const panelBg = "rgba(28,31,38,0.92)";

/**
 * Agent chat thread for a linked project — moved here from the old standalone
 * Workbench page (apps/web/app/[locale]/workbench/page.tsx) so it can live as
 * a tab inside Studio. Same endpoint, same behavior; only the shell changed.
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
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState<ChatTurn[]>([]);

  const chat = useMutation({
    mutationFn: async () => {
      const focus = selectedPath ? `\n\n[Workbench focus file: ${selectedPath}]` : "";
      const res = await apiPost<{ answer: string }>("/api/v1/conversation/message", {
        message: `${message.trim()}${focus}`,
        projectId: projectId || null,
      });
      return res.answer || t("agentFallback");
    },
    onSuccess: (reply) => {
      setThread((prev) => [
        ...prev,
        { role: "user", text: message.trim() },
        { role: "assistant", text: reply },
      ]);
      setMessage("");
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
            {t("chatEmpty")}
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
        {chat.isError ? <Alert severity="error">{(chat.error as Error).message}</Alert> : null}
      </Stack>
    </Box>
  );
}
