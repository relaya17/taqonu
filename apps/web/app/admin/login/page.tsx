"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
  Divider,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiPost, downloadVerifiedSourcesPack } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () =>
      apiPost<{ user: { role: string } }>("/api/v1/auth/login", {
        email,
        password,
      }),
    onSuccess: (data) => {
      if (data.user.role !== "admin") {
        throw new Error("החשבון אינו אדמין — השתמשו בהתחברות הרגילה");
      }
      router.push("/admin");
      router.refresh();
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 440, mx: "auto", py: 4 }}>
      <Box>
        <Typography variant="h1">התחברות אדמין</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          כתובת נפרדת מהאפליקציה: <strong>/admin</strong> · רק role=admin
        </Typography>
      </Box>

      <Alert severity="info">
        ידע לסוכנים ולאפליקציה חייב להיות מרשימת מקורות מאומתים בלבד. אפשר
        להוריד את הרשימה למחשב לפני/אחרי הכניסה.
      </Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("json")}
        >
          הורדת מקורות מאומתים (JSON)
        </Button>
        <Button
          variant="outlined"
          onClick={() => downloadVerifiedSourcesPack("markdown")}
        >
          הורדה (Markdown)
        </Button>
      </Stack>

      <Divider />

      <TextField
        label="אימייל"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        fullWidth
      />
      <TextField
        label="סיסמה"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        fullWidth
      />
      <Button
        variant="contained"
        disabled={login.isPending}
        onClick={() => login.mutate()}
      >
        כניסה לאדמין
      </Button>
      {login.isError ? (
        <Alert severity="error">{(login.error as Error).message}</Alert>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        משתמשים רגילים: התחברות באפליקציה תחת{" "}
        <Box component="a" href="/he/auth/login" sx={{ color: "primary.main" }}>
          /auth/login
        </Box>
      </Typography>
    </Stack>
  );
}
