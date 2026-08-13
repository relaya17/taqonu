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
import Link from "next/link";
import { apiDelete, apiGet, apiPatch } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  provider: string;
  createdAt: string;
  disabled?: boolean;
  emailVerified?: boolean;
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiGet<{ items: UserRow[] }>("/api/v1/admin/users"),
    retry: false,
  });

  const patchUser = useMutation({
    mutationFn: (input: {
      id: string;
      role?: "user" | "admin";
      disabled?: boolean;
    }) =>
      apiPatch<{ user: UserRow }>(`/api/v1/admin/users/${input.id}`, {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.disabled !== undefined ? { disabled: input.disabled } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/admin/users/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  if (users.isError) {
    return (
      <Alert severity="warning">
        אין הרשאה. <Link href="/admin/login">התחברות אדמין</Link>
      </Alert>
    );
  }

  const items = users.data?.items ?? [];

  return (
    <Stack spacing={3} sx={{ maxWidth: 960 }}>
      <Box>
        <Typography variant="h1">משתמשים</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {items.length} רשומים · קידום / השבתה / מחיקה
        </Typography>
      </Box>
      {patchUser.isError || removeUser.isError ? (
        <Alert severity="error">
          {((patchUser.error ?? removeUser.error) as Error).message}
        </Alert>
      ) : null}
      <Stack spacing={0}>
        {items.map((user) => (
          <Box
            key={user.id}
            sx={{
              py: 2,
              borderBottom: "1px solid rgba(20,32,34,0.12)",
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr auto" },
              gap: 1.5,
              alignItems: "center",
            }}
          >
            <Box>
              <Typography fontWeight={700}>
                {user.displayName ?? user.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.email} · {user.provider} ·{" "}
                {new Date(user.createdAt).toLocaleString("he-IL")}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
                <Chip
                  size="small"
                  label={user.role}
                  color={user.role === "admin" ? "secondary" : "default"}
                />
                {user.disabled ? (
                  <Chip size="small" color="warning" label="מושבת" />
                ) : null}
                {user.emailVerified ? (
                  <Chip size="small" variant="outlined" label="מאומת" />
                ) : (
                  <Chip size="small" variant="outlined" label="לא מאומת" />
                )}
              </Stack>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  patchUser.mutate({
                    id: user.id,
                    role: user.role === "admin" ? "user" : "admin",
                  })
                }
              >
                {user.role === "admin" ? "הורד ל־user" : "הפוך לאדמין"}
              </Button>
              <Button
                size="small"
                color="warning"
                variant="outlined"
                onClick={() =>
                  patchUser.mutate({
                    id: user.id,
                    disabled: !user.disabled,
                  })
                }
              >
                {user.disabled ? "הפעלה" : "השבתה"}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => {
                  if (window.confirm(`למחוק את ${user.email}?`)) {
                    removeUser.mutate(user.id);
                  }
                }}
              >
                מחיקה
              </Button>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
