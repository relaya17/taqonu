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
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(62,200,190,0.14), transparent 55%), linear-gradient(165deg, #071214 0%, #0F1F22 100%)",
          border: "1px solid rgba(62,200,190,0.22)",
          color: "#E8F4F2",
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
          <Typography sx={{ mt: 1, color: "rgba(180,210,208,0.88)" }}>
            /admin · role=admin בלבד · ניטור · ידע · אוטומציה
          </Typography>
        </Box>

        <Alert
          severity="info"
          sx={{ bgcolor: "rgba(62,200,190,0.08)", color: "#E8F4F2" }}
        >
          ידע לסוכנים חייב ממקורות מאומתים. הורידו את הרשימה לפני/אחרי הכניסה.
        </Alert>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="outlined"
            onClick={() => downloadVerifiedSourcesPack("json")}
            sx={{ borderColor: "rgba(62,200,190,0.45)", color: "#E8F4F2" }}
          >
            מקורות JSON
          </Button>
          <Button
            variant="outlined"
            onClick={() => downloadVerifiedSourcesPack("markdown")}
            sx={{ borderColor: "rgba(62,200,190,0.45)", color: "#E8F4F2" }}
          >
            Markdown
          </Button>
        </Stack>

        <Divider sx={{ borderColor: "rgba(62,200,190,0.18)" }} />

        <TextField
          label="אימייל"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          fullWidth
          InputLabelProps={{ sx: { color: "rgba(180,210,208,0.8)" } }}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#E8F4F2",
              "& fieldset": { borderColor: "rgba(62,200,190,0.35)" },
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
          InputLabelProps={{ sx: { color: "rgba(180,210,208,0.8)" } }}
          sx={{
            "& .MuiOutlinedInput-root": {
              color: "#E8F4F2",
              "& fieldset": { borderColor: "rgba(62,200,190,0.35)" },
            },
          }}
        />
        <Button
          variant="contained"
          disabled={!canSubmit}
          onClick={() => login.mutate()}
          sx={{
            bgcolor: "#3EC8BE",
            color: "#041214",
            fontWeight: 700,
            "&:hover": { bgcolor: "#5AD8CF" },
          }}
        >
          כניסה למרכז הפיקוד
        </Button>
        {login.isError ? (
          <Alert severity="error">{(login.error as Error).message}</Alert>
        ) : null}

        <Typography variant="body2" sx={{ color: "rgba(170,200,198,0.85)" }}>
          משתמשים רגילים:{" "}
          <Box component="a" href="/he/auth/login" sx={{ color: "#3EC8BE" }}>
            /he/auth/login
          </Box>
        </Typography>
      </Stack>
    </Box>
  );
}
