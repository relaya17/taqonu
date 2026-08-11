"use client";

import { Alert, Box, Chip, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiGet } from "@/lib/api";

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  provider: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiGet<{ items: UserRow[] }>("/api/v1/admin/users"),
    retry: false,
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
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <Box>
        <Typography variant="h1">משתמשים</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          {items.length} רשומים
        </Typography>
      </Box>
      <Stack spacing={0}>
        {items.map((user) => (
          <Box
            key={user.id}
            sx={{
              py: 2,
              borderBottom: "1px solid rgba(20,32,34,0.12)",
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr auto" },
              gap: 1,
            }}
          >
            <Box>
              <Typography fontWeight={700}>
                {user.displayName ?? user.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {user.email} · {user.provider} · {new Date(user.createdAt).toLocaleString("he-IL")}
              </Typography>
            </Box>
            <Chip size="small" label={user.role} color={user.role === "admin" ? "secondary" : "default"} />
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
