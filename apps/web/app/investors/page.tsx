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
import Link from "next/link";
import { apiPost } from "@/lib/api";

const PILLARS = [
  {
    title: "אמת תיק, לא צ׳אט",
    body: "Current State עם תוויות אפיסטמיות — FACT מול INFERRED — על כל הפורטפוליו.",
  },
  {
    title: "מועצת מומחים",
    body: "הנדסה, QA, UI/UX, עיצוב, נגישות, אבטחה — בדיקות עם תוצאות, לא סיסמאות.",
  },
  {
    title: "AI כראיה בתשלום",
    body: "העלאת תמונות/מסמכים → Evidence. סיוע מבינות חיצוניות בקרדיטים — WRITE נשאר נעול.",
  },
] as const;

export default function InvestorsPage() {
  const [lang, setLang] = useState<"he" | "en">("he");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);

  const he = lang === "he";

  const contact = useMutation({
    mutationFn: () =>
      apiPost<{ id: string }>("/api/v1/contact", {
        name,
        email,
        company: company || undefined,
        role: role || undefined,
        message,
        source: "investors",
        locale: lang,
      }),
    onSuccess: (data) => setSentId(data.id),
  });

  return (
    <Box
      sx={{
        minHeight: "100vh",
        color: "#F4F7F5",
        background:
          "radial-gradient(ellipse 90% 70% at 80% 10%, rgba(196,92,38,0.28), transparent 55%), radial-gradient(ellipse 70% 50% at 10% 90%, rgba(15,61,62,0.9), transparent 50%), linear-gradient(165deg, #0B2425 0%, #14282A 45%, #1A3334 100%)",
      }}
    >
      <Box
        component="header"
        sx={{
          px: { xs: 2, md: 6 },
          py: 2.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          animation: "fadeIn 600ms ease both",
          "@keyframes fadeIn": {
            from: { opacity: 0 },
            to: { opacity: 1 },
          },
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontWeight: 700,
            fontSize: "1.35rem",
            letterSpacing: "-0.03em",
          }}
        >
          ArletOS
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            variant={he ? "contained" : "outlined"}
            color="secondary"
            onClick={() => setLang("he")}
            aria-pressed={he}
          >
            עב
          </Button>
          <Button
            size="small"
            variant={!he ? "contained" : "outlined"}
            color="secondary"
            onClick={() => setLang("en")}
            aria-pressed={!he}
          >
            EN
          </Button>
          <Button component={Link} href="/he" size="small" sx={{ color: "#F4F7F5" }}>
            {he ? "למוצר" : "Product"}
          </Button>
        </Stack>
      </Box>

      {/* Hero — one composition */}
      <Box
        component="section"
        aria-label={he ? "גיבור" : "Hero"}
        sx={{
          minHeight: { xs: "78vh", md: "88vh" },
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          px: { xs: 2, md: 6 },
          pb: { xs: 6, md: 10 },
          pt: { xs: 8, md: 4 },
          position: "relative",
          overflow: "hidden",
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, transparent 35%, rgba(8,20,21,0.75) 100%)",
            pointerEvents: "none",
          },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, maxWidth: 720 }}>
          <Typography
            component="p"
            sx={{
              fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
              fontWeight: 700,
              fontSize: { xs: "clamp(2.6rem, 10vw, 4.8rem)", md: "4.8rem" },
              lineHeight: 0.95,
              letterSpacing: "-0.04em",
              mb: 2,
              animation: "rise 900ms ease both",
              "@keyframes rise": {
                from: { opacity: 0, transform: "translateY(28px)" },
                to: { opacity: 1, transform: "translateY(0)" },
              },
            }}
          >
            ArletOS
          </Typography>
          <Typography
            sx={{
              fontSize: { xs: "1.2rem", md: "1.45rem" },
              maxWidth: 520,
              mb: 3,
              opacity: 0.92,
              animation: "rise 900ms ease both",
              animationDelay: "120ms",
            }}
          >
            {he
              ? "מערכת בינה הנדסית + QA אדפטיבי לתיק שלם — לא צ׳אטבוט, לא IDE."
              : "Engineering + Adaptive QA Intelligence OS for a whole portfolio — not a chatbot, not an IDE."}
          </Typography>
          <Typography
            sx={{
              maxWidth: 480,
              mb: 4,
              color: "rgba(244,247,245,0.78)",
              animation: "rise 900ms ease both",
              animationDelay: "200ms",
            }}
          >
            {he
              ? "מה נכון עכשיו בתיק? האם זה מספיק טוב? עם מומחים, ראיות, קונפליקטים — וסיוע AI בתשלום על תמונות ומסמכים."
              : "What is true across the portfolio? Is it good enough? Experts, evidence, conflicts — and paid AI assists on images and docs."}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{
              animation: "rise 900ms ease both",
              animationDelay: "280ms",
            }}
          >
            <Button
              href="#contact"
              variant="contained"
              color="secondary"
              size="large"
              sx={{ minHeight: 48 }}
            >
              {he ? "דברו איתנו" : "Talk to us"}
            </Button>
            <Button
              component={Link}
              href="/he/auth/register"
              variant="outlined"
              size="large"
              sx={{
                minHeight: 48,
                borderColor: "rgba(244,247,245,0.45)",
                color: "#F4F7F5",
              }}
            >
              {he ? "נסו את המוצר" : "Try the product"}
            </Button>
          </Stack>
        </Box>
      </Box>

      {/* Pillars */}
      <Box
        component="section"
        sx={{
          px: { xs: 2, md: 6 },
          py: { xs: 6, md: 10 },
          borderTop: "1px solid rgba(244,247,245,0.12)",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 4,
          }}
        >
          {he ? "למה זה קטגוריה חדשה" : "Why this is a new category"}
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: { xs: 3, md: 5 },
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
          }}
        >
          {PILLARS.map((item, i) => (
            <Box
              key={item.title}
              sx={{
                animation: "rise 700ms ease both",
                animationDelay: `${i * 80}ms`,
              }}
            >
              <Typography fontWeight={700} sx={{ mb: 1, fontSize: "1.15rem" }}>
                {he ? item.title : ["Portfolio truth, not chat", "Expert council", "Paid AI as evidence"][i]}
              </Typography>
              <Typography sx={{ color: "rgba(244,247,245,0.75)", lineHeight: 1.6 }}>
                {he
                  ? item.body
                  : [
                      "Current State with epistemic labels — FACT vs INFERRED — across the whole portfolio.",
                      "Engineering, QA, UI/UX, Design, A11y, Security — reviews with findings, not slogans.",
                      "Upload images/docs → Evidence. External model assists on credits — WRITE stays locked.",
                    ][i]}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Model */}
      <Box
        component="section"
        sx={{
          px: { xs: 2, md: 6 },
          py: { xs: 5, md: 8 },
          background: "rgba(0,0,0,0.22)",
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {he ? "מודל" : "Model"}
        </Typography>
        <Typography sx={{ maxWidth: 640, color: "rgba(244,247,245,0.8)", mb: 2 }}>
          {he
            ? "שכבה מקומית חינמית למהנדסים. ענן freemium (3 פרויקטים → Pro). קרדיטים לסיוע AI על ארטיפקטים. אדמין נפרד ב־/admin."
            : "Free local layer for engineers. Freemium cloud (3 projects → Pro). Credits for AI assists on artifacts. Separate admin at /admin."}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.65 }}>
          Atlas Core · ArletOS · ADR-009…013
        </Typography>
      </Box>

      {/* Contact */}
      <Box
        id="contact"
        component="section"
        sx={{
          px: { xs: 2, md: 6 },
          py: { xs: 6, md: 10 },
          maxWidth: 640,
        }}
      >
        <Typography
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 1,
          }}
        >
          {he ? "יצירת קשר למשקיעים" : "Investor contact"}
        </Typography>
        <Typography sx={{ mb: 3, color: "rgba(244,247,245,0.75)" }}>
          {he
            ? "השאירו פרטים — נחזור עם דמו, מפת דרכים ומודל."
            : "Leave details — we will follow up with a demo, roadmap, and model."}
        </Typography>

        {sentId ? (
          <Alert severity="success">
            {he ? "ההודעה התקבלה. תודה." : "Message received. Thank you."}
          </Alert>
        ) : (
          <Stack
            spacing={2}
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              contact.mutate();
            }}
          >
            <TextField
              required
              label={he ? "שם" : "Name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.06)" } }}
              InputLabelProps={{ sx: { color: "rgba(244,247,245,0.7)" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: "#F4F7F5",
                  "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
                },
              }}
            />
            <TextField
              required
              type="email"
              label={he ? "אימייל" : "Email"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.06)" } }}
              InputLabelProps={{ sx: { color: "rgba(244,247,245,0.7)" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: "#F4F7F5",
                  "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
                },
              }}
            />
            <TextField
              label={he ? "חברה" : "Company"}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              fullWidth
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.06)" } }}
              InputLabelProps={{ sx: { color: "rgba(244,247,245,0.7)" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: "#F4F7F5",
                  "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
                },
              }}
            />
            <TextField
              label={he ? "תפקיד" : "Role"}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              fullWidth
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.06)" } }}
              InputLabelProps={{ sx: { color: "rgba(244,247,245,0.7)" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: "#F4F7F5",
                  "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
                },
              }}
            />
            <TextField
              required
              multiline
              minRows={4}
              label={he ? "הודעה" : "Message"}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              fullWidth
              InputProps={{ sx: { bgcolor: "rgba(255,255,255,0.06)" } }}
              InputLabelProps={{ sx: { color: "rgba(244,247,245,0.7)" } }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  color: "#F4F7F5",
                  "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              color="secondary"
              size="large"
              disabled={contact.isPending}
              sx={{ alignSelf: "flex-start", minHeight: 48 }}
            >
              {he ? "שלחו" : "Send"}
            </Button>
            {contact.isError ? (
              <Alert severity="error">{(contact.error as Error).message}</Alert>
            ) : null}
          </Stack>
        )}
      </Box>

      <Box
        component="footer"
        sx={{
          px: { xs: 2, md: 6 },
          py: 3,
          borderTop: "1px solid rgba(244,247,245,0.1)",
          opacity: 0.7,
          fontSize: "0.85rem",
        }}
      >
        Atlas Core · ArletOS · {he ? "למשקיעים" : "For investors"} ·{" "}
        <Link href="/he" style={{ color: "inherit" }}>
          app
        </Link>
      </Box>
    </Box>
  );
}
