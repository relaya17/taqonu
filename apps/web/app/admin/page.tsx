"use client";

import { Alert, Box, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import Link from "next/link";

interface Overview {
  userCount: number;
  adminCount: number;
  providers: { local: number; google: number; github: number };
  cloudAuth: boolean;
}

export default function AdminHomePage() {
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiGet<Overview>("/api/v1/admin/overview"),
    retry: false,
  });

  if (overview.isError) {
    return (
      <Stack spacing={2} sx={{ maxWidth: 640 }}>
        <Typography variant="h1">Admin</Typography>
        <Alert severity="warning">
          נדרשת התחברות כאדמין.{" "}
          <Link href="/admin/login">התחברות</Link>
        </Alert>
      </Stack>
    );
  }

  const data = overview.data;

  return (
    <Stack spacing={3} sx={{ maxWidth: 800 }}>
      <Box>
        <Typography variant="h1">לוח בקרה — אדמין</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          כתובת נפרדת: <strong>/admin</strong> · משתמשים, ספקים, מצב ענן
        </Typography>
      </Box>

      {data ? (
        <Stack spacing={2}>
          <Typography>משתמשים: {data.userCount}</Typography>
          <Typography>אדמינים: {data.adminCount}</Typography>
          <Typography>
            ספקים — מקומי: {data.providers.local} · Google: {data.providers.google} ·
            GitHub: {data.providers.github}
          </Typography>
          <Alert severity={data.cloudAuth ? "success" : "info"}>
            {data.cloudAuth
              ? "Supabase Cloud פעיל — OAuth Google/GitHub זמין"
              : "מצב מקומי — אימייל/סיסמה פעיל; הפעילו Supabase ל-Google/GitHub"}
          </Alert>
        </Stack>
      ) : null}
    </Stack>
  );
}
