"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EpistemicChip } from "@/components/epistemic/EpistemicChip";
import { apiGet, apiPost } from "@/lib/api";
import { Link } from "@/i18n/routing";
import type { EpistemicState } from "@atlas/shared";

interface Project {
  id: string;
  slug: string;
  name: string;
}

interface EvidenceRef {
  id: string;
  kind: string;
  reference: string;
  excerpt?: string;
  epistemicState?: EpistemicState;
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  epistemicLabel?: EpistemicState | undefined;
  evidenceRefs?: EvidenceRef[] | undefined;
  knowledgePlainLanguage?: string | null | undefined;
}

interface ConversationResponse {
  messageId: string;
  threadId: string;
  answer: string;
  epistemicLabel: EpistemicState;
  evidenceRefs: EvidenceRef[];
  knowledgePlainLanguage: string | null;
  memoryContext: {
    items: Array<{ id: string; statement: string; epistemicState: string }>;
    note: string;
    truncated: boolean;
    budget: number;
  };
}

interface StoredThreadResponse {
  threadId: string;
  items: Array<{
    role: "user" | "assistant";
    content: string;
    epistemicLabel?: EpistemicState;
    evidenceRefs?: EvidenceRef[];
    at: string;
  }>;
}

const PORTFOLIO = "__portfolio__";
const THREAD_STORAGE_KEY = "atlas.conversation.threadId";

export default function ChatPage() {
  const t = useTranslations("chat");
  const te = useTranslations("epistemic");
  const locale = useLocale() as "en" | "he" | "ar";
  const [projectId, setProjectId] = useState(PORTFOLIO);
  const [message, setMessage] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THREAD_STORAGE_KEY);
      if (saved) setThreadId(saved);
    } catch {
      // ignore storage failures
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (threadId) {
        window.localStorage.setItem(THREAD_STORAGE_KEY, threadId);
      } else {
        window.localStorage.removeItem(THREAD_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [threadId, hydrated]);

  const historyQuery = useQuery({
    queryKey: ["conversation-thread", threadId],
    enabled: hydrated && Boolean(threadId) && turns.length === 0,
    queryFn: () =>
      apiGet<StoredThreadResponse>(
        `/api/v1/conversation/threads/${encodeURIComponent(threadId!)}`,
      ),
  });

  useEffect(() => {
    const items = historyQuery.data?.items;
    if (!items || items.length === 0 || turns.length > 0) return;
    setTurns(
      items.map((item) => ({
        role: item.role,
        content: item.content,
        epistemicLabel: item.epistemicLabel,
        evidenceRefs: item.evidenceRefs,
      })),
    );
  }, [historyQuery.data, turns.length]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ items: Project[] }>("/api/v1/projects"),
  });

  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: async (text: string) =>
      apiPost<ConversationResponse>("/api/v1/conversation/message", {
        message: text,
        projectId: projectId === PORTFOLIO ? null : projectId,
        threadId,
        aiProviderId: "arletos-included",
        locale,
      }),
    onSuccess: (data, text) => {
      setThreadId(data.threadId);
      setTurns((prev) => [
        ...prev,
        { role: "user", content: text },
        {
          role: "assistant",
          content: data.answer,
          epistemicLabel: data.epistemicLabel,
          evidenceRefs: data.evidenceRefs,
          knowledgePlainLanguage: data.knowledgePlainLanguage,
        },
      ]);
      setMessage("");
    },
  });

  const send = () => {
    const text = message.trim();
    if (!text || mutation.isPending) return;
    mutation.mutate(text);
  };

  const clearThread = () => {
    setTurns([]);
    setThreadId(null);
    try {
      window.localStorage.removeItem(THREAD_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 860 }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("subtitle")}{" "}
          <Link href="/agent">{t("openAgent")}</Link>
        </Typography>
      </Box>

      <Alert severity="info">{t("disciplineHint")}</Alert>

      <TextField
        select
        label={t("projectLabel")}
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        sx={{ maxWidth: 360 }}
        helperText={projects.length === 0 ? t("noProjects") : undefined}
      >
        <MenuItem value={PORTFOLIO}>{t("portfolio")}</MenuItem>
        {projects.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.name}
          </MenuItem>
        ))}
      </TextField>

      <Stack
        spacing={2}
        sx={{
          borderTop: "1px solid rgba(20,32,34,0.14)",
          pt: 2,
          minHeight: 200,
        }}
      >
        {turns.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {historyQuery.isFetching ? t("restoring") : t("empty")}
          </Typography>
        ) : null}

        {turns.map((turn, idx) => (
          <Box
            key={`${turn.role}-${idx}`}
            sx={{
              alignSelf: turn.role === "user" ? "flex-end" : "stretch",
              maxWidth: turn.role === "user" ? "85%" : "100%",
              bgcolor:
                turn.role === "user"
                  ? "rgba(20,32,34,0.06)"
                  : "transparent",
              px: turn.role === "user" ? 1.5 : 0,
              py: turn.role === "user" ? 1 : 0,
              borderRadius: 1,
            }}
          >
            <Typography variant="overline" color="text.secondary">
              {turn.role === "user" ? t("you") : t("atlas")}
            </Typography>
            {turn.role === "assistant" && turn.epistemicLabel ? (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 1 }}
              >
                <EpistemicChip state={turn.epistemicLabel} />
                {turn.epistemicLabel === "INSUFFICIENT_EVIDENCE" ? (
                  <Typography variant="body2" color="warning.main">
                    {te("INSUFFICIENT_EVIDENCE")}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
            {turn.role === "assistant" &&
            turn.epistemicLabel === "INSUFFICIENT_EVIDENCE" ? (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                {t("insufficientAlert")}
              </Alert>
            ) : null}
            <Typography sx={{ whiteSpace: "pre-wrap" }}>{turn.content}</Typography>
            {turn.role === "assistant" ? (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="overline">{t("evidence")}</Typography>
                {turn.evidenceRefs && turn.evidenceRefs.length > 0 ? (
                  <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                    {turn.evidenceRefs.map((ref) => (
                      <Typography
                        key={`${ref.kind}-${ref.id}`}
                        variant="body2"
                        color="text.secondary"
                      >
                        [{ref.kind}] {ref.reference}
                        {ref.epistemicState ? ` · ${ref.epistemicState}` : ""}
                        {ref.excerpt ? ` — ${ref.excerpt}` : ""}
                      </Typography>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="warning.main">
                    {t("noEvidenceRefs")}
                  </Typography>
                )}
              </Box>
            ) : null}
          </Box>
        ))}
      </Stack>

      {mutation.isError ? (
        <Alert severity="error">{(mutation.error as Error).message}</Alert>
      ) : null}

      <TextField
        multiline
        minRows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t("placeholder")}
        fullWidth
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          onClick={send}
          disabled={mutation.isPending || !message.trim()}
        >
          {t("send")}
        </Button>
        <Button
          variant="outlined"
          onClick={clearThread}
          disabled={turns.length === 0 && !threadId}
        >
          {t("clear")}
        </Button>
      </Stack>
    </Stack>
  );
}
