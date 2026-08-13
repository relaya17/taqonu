"use client";

import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { apiGet, downloadVerifiedSourcesPack } from "@/lib/api";
import Link from "next/link";

interface Overview {
  userCount: number;
  adminCount: number;
  providers: { local: number; google: number; github: number; apple: number };
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
          כתובת נפרדת מהאפליקציה: <strong>/admin</strong> · משתמשים, ספקים, ידע
          מאומת
        </Typography>
      </Box>

      <Alert severity="success">
        מדיניות: כל מידע חיצוני לסוכנים/לאפליקציה חייב להיות ממקור מאומת
        (allow-list). הזרקת URL שאינו ברשימה נחסמת ב־API.
      </Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("json")}
        >
          הורדת רשימת מקורות מאומתים (JSON)
        </Button>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("markdown")}
        >
          הורדה Markdown
        </Button>
      </Stack>

      {data ? (
        <Stack spacing={2}>
          <Typography>משתמשים: {data.userCount}</Typography>
          <Typography>אדמינים: {data.adminCount}</Typography>
          <Typography>
            ספקים — מקומי: {data.providers.local} · Google:{" "}
            {data.providers.google} · Apple: {data.providers.apple} · GitHub:{" "}
            {data.providers.github}
          </Typography>
          <Alert severity={data.cloudAuth ? "success" : "info"}>
            {data.cloudAuth
              ? "Supabase Cloud פעיל — OAuth Google/Apple/GitHub זמין"
              : "מצב מקומי — אימייל/סיסמה פעיל; הפעילו Supabase ל-Google/Apple/GitHub"}
          </Alert>
        </Stack>
      ) : null}
    </Stack>
  );
}
