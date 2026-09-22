"use client";

import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/api";
import { inboxKindMessageKey } from "@/lib/inbox-kind";
import { Link } from "@/i18n/routing";

interface InboxItem {
  id: string;
  kind: "memory.pending" | "approval.waiting" | "patch.ready";
  title: string;
  href: string;
  createdAt: string;
  dismissed: boolean;
}

export function NotificationsPanel({ embedded = false }: { embedded?: boolean }) {
  const t = useTranslations("notifications");
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      apiGet<{ items: InboxItem[]; unreadCount: number; channel: string }>(
        "/api/v1/notifications",
      ),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => apiPost("/api/v1/notifications/dismiss", { id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const items = inbox.data?.items ?? [];
  const unread = items.filter((item) => !item.dismissed);

  return (
    <Stack
      spacing={embedded ? 2 : 3}
      sx={{
        maxWidth: embedded ? "100%" : 820,
        width: "100%",
        mx: "auto",
        textAlign: "center",
        alignItems: "center",
      }}
    >
      {!embedded ? (
        <Box>
          <Typography variant="h1" sx={{ fontSize: "2.4rem" }}>
            {t("title")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("help")}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("help")}
        </Typography>
      )}
      {inbox.isError ? (
        <Alert severity="error">{(inbox.error as Error).message}</Alert>
      ) : null}
      {dismiss.isError ? (
        <Alert severity="error">{(dismiss.error as Error).message}</Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        {t("unread", { count: inbox.data?.unreadCount ?? unread.length })}
      </Typography>
      <Stack spacing={0} sx={{ width: "100%" }}>
        {unread.length === 0 ? (
          <Typography color="text.secondary">{t("empty")}</Typography>
        ) : (
          unread.map((item) => (
            <Box
              key={item.id}
              sx={{ py: 2, borderBottom: "1px solid rgba(26,31,42,0.12)" }}
            >
              <Stack
                direction="row"
                spacing={1}
                justifyContent="center"
                alignItems="center"
                flexWrap="wrap"
                sx={{ mb: 0.5, gap: 1 }}
              >
                <Chip size="small" label={t(`kind.${inboxKindMessageKey(item.kind)}`)} />
                <Button component={Link} href={item.href} size="small">
                  {t("open")}
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={dismiss.isPending}
                  onClick={() => dismiss.mutate(item.id)}
                >
                  {t("dismiss")}
                </Button>
              </Stack>
              <Typography fontWeight={650}>{item.title}</Typography>
            </Box>
          ))
        )}
      </Stack>
    </Stack>
  );
}
