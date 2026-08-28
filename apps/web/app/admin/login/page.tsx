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
import { DEV_CREDENTIALS, isDevLoginPrefill } from "@/lib/dev-credentials";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.email : "");
  const [password, setPassword] = useState(isDevLoginPrefill ? DEV_CREDENTIALS.password : "");

  const login = useMutation({
    mutationFn: () =>
      apiPost<{ user: { role: string } }>("/api/v1/auth/login", {
        email,
        password,
      }),
    onSuccess: (data) => {
      if (data.user.role !== "admin" && data.user.role !== "owner") {
        throw new Error("החשבון אינו אדמין — השתמשו בהתחברות הרגילה");
      }
      router.push("/admin");
      router.refresh();
    },
  });

  const canSubmit = !login.isPending && Boolean(email) && password.length >= 8;

  return (
    <Box
      sx={{
        minHeight: "70vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Stack
        spacing={3}
        sx={{
          maxWidth: 460,
          width: "100%",
          p: { xs: 2.5, md: 3.5 },
          textAlign: "center",
          alignItems: "center",
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(154,158,168,0.14), transparent 55%), linear-gradient(165deg, #12141A 0%, #1C1F26 100%)",
          border: "1px solid rgba(154,158,168,0.22)",
          color: "#DCDDE1",
        }}
      >
        <Box>
          <Typography
            sx={{
              fontFamily: '"Syne", "Frank Ruhl Libre", sans-serif',
              fontWeight: 700,
              fontSize: "2rem",
              letterSpacing: "-0.03em",
            }}
          >
            כניסת פיקוד
          </Typography>
        <Typography sx={{ mt: 1, color: "rgba(210, 216, 224, 0.92)", textAlign: "center" }}>
            /admin · role=admin בלבד · ניטור · ידע · אוטומציה
          </Typography>
          {isDevLoginPrefill ? (
            <Alert severity="info" sx={{ mt: 2, textAlign: "start" }}>
              מצב פיתוח — {DEV_CREDENTIALS.email} · {DEV_CREDENTIALS.password}
            </Alert>
          ) : null}
        </Box>

        <Alert
          severity="info"
          sx={{ bgcolor: "rgba(154,158,168,0.08)", color: "#DCDDE1" }}
        >
          ידע לסוכנים חייב ממקורות מאומתים. הורידו את הרשימה לפני/אחרי הכניסה.
        </Alert>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="center" sx={{ width: "100%" }}>
          <Button
            variant="outlined"
            onClick={() => downloadVerifiedSourcesPack("json")}
            sx={{ borderColor: "rgba(154,158,168,0.45)", color: "#DCDDE1" }}
          >
            מקורות JSON
          </Button>
          <Button
            variant="outlined"
            onClick={() => downloadVerifiedSourcesPack("markdown")}
            sx={{ borderColor: "rgba(154,158,168,0.45)", color: "#DCDDE1" }}
          >
            Markdown
          </Button>
        </Stack>

        <Divider sx={{ borderColor: "rgba(154,158,168,0.18)" }} />

        <TextField
          label="אימייל"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          fullWidth
          inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
          InputLabelProps={{ sx: { color: "rgba(210, 216, 224, 0.9)" } }}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#F4F5F7",
              bgcolor: "#343B48",
              "& fieldset": { borderColor: "rgba(232,234,238,0.42)" },
            },
          }}
        />
        <TextField
          label="סיסמה"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          fullWidth
          inputProps={{ dir: "rtl", style: { textAlign: "start" } }}
          InputLabelProps={{ sx: { color: "rgba(210, 216, 224, 0.9)" } }}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#F4F5F7",
              bgcolor: "#343B48",
              "& fieldset": { borderColor: "rgba(232,234,238,0.42)" },
            },
          }}
        />
        <Button
          variant="contained"
          disabled={!canSubmit}
          onClick={() => login.mutate()}
          sx={{
            bgcolor: "#D2D4D8",
            color: "#12141A",
            fontWeight: 700,
            "&:hover": { bgcolor: "#E8EAEE" },
          }}
        >
          כניסה למרכז הפיקוד
        </Button>
        <Button
          variant="outlined"
          disabled={!canSubmit}
          onClick={() => {
            void apiPost("/api/v1/auth/register", {
              email,
              password,
              displayName: DEV_CREDENTIALS.displayName,
              locale: "he",
            })
              .catch(() => undefined)
              .then(() => login.mutate());
          }}
          sx={{ borderColor: "rgba(232,234,238,0.45)", color: "#F4F5F7" }}
        >
          הרשמה ואז כניסה
        </Button>
        {login.isError ? (
          <Alert severity="error" sx={{ textAlign: "start" }}>{(login.error as Error).message}</Alert>
        ) : null}

        <Typography variant="body2" sx={{ color: "rgba(170,200,198,0.85)" }}>
          משתמשים רגילים:{" "}
          <Box component="a" href="/he/auth/login" sx={{ color: "#9A9EA8" }}>
            /he/auth/login
          </Box>
        </Typography>
      </Stack>
    </Box>
  );
}
