"use client";

import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => apiPost<{ user: { role: string } }>("/api/v1/auth/login", { email, password }),
    onSuccess: (data) => {
      if (data.user.role !== "admin") {
        throw new Error("החשבון אינו אדמין");
      }
      router.push("/admin");
      router.refresh();
    },
  });

  return (
    <Stack spacing={3} sx={{ maxWidth: 420, mx: "auto", py: 4 }}>
      <Box>
        <Typography variant="h1">התחברות אדמין</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          /admin — משתמש עם role=admin בלבד
        </Typography>
      </Box>
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
        כניסה
      </Button>
      {login.isError ? (
        <Alert severity="error">{(login.error as Error).message}</Alert>
      ) : null}
    </Stack>
  );
}
