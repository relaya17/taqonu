"use client";

import { useMemo, useState } from "react";
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

const copy = {
  he: {
    product: "למוצר",
    partners: "Design Partners",
    heroHeadline: "שכבת האמת ההנדסית לצוותי AI",
    heroSupport:
      "יודעים מה מאומת, מה מסוכן, ומה הראיה — לפני שמשחררים לפרודקשן.",
    ctaTalk: "דברו איתנו",
    ctaPartner: "התחילו Design Partner",
    ctaProduct: "פתחו את המוצר",
    problemTitle: "הבעיה",
    problemBody:
      "צוותים רצים עם Cursor, CI, סורקים ו־LLMs — ואף אחד לא עונה באמינות: מה באמת נכון על התוכנה עכשיו?",
    solutionTitle: "הפתרון",
    solutionBody:
      "Atlas בונה Evidence Graph חי: קוד → בדיקות → תשתיות → פריסות → החלטות → סיכונים → מוכנות. העורכים נשארים איפה שהם; Atlas הוא אמת, QA וממשל.",
    flowTitle: "זרימת הליבה",
    flow:
      "DISCOVER → RECONCILE → CLAIMS → EVIDENCE → RISK → QA → SECURITY → COUNCIL → GATES → VERDICT",
    productVisualTitle: "איך זה נראה במוצר",
    productVisualBody:
      "Evidence Graph חי: קטגוריות נפרדות (קוד · בדיקות · אבטחה · פריסה) — בלי למזג שקט לבלוב אחד.",
    moatTitle: "המוט",
    moatBody:
      "לא ה־LLM. Evidence Graph + זיכרון הנדסי היסטורי — עם תוויות אפיסטמיות ותמיד העדפה ל־INSUFFICIENT_EVIDENCE על הזיה.",
    partnerTitle: "Design Partner",
    partnerBody:
      "אודיט מוכנות הנדסית על ריפו אחד בפרודקשן. מודדים סיכונים לא ידועים, חוסמים, וזמן שנחסך — ואז case study.",
    partnerCta: "ל־playbook",
    contactTitle: "יצירת קשר",
    contactBody: "משקיעים ושותפים — השאירו פרטים. נחזור עם דמו ומודל.",
    name: "שם",
    email: "אימייל",
    company: "חברה",
    role: "תפקיד",
    message: "הודעה",
    send: "שלחו",
    thanks: "ההודעה התקבלה. תודה.",
    footer: "למשקיעים ולשותפים",
  },
  en: {
    product: "Product",
    partners: "Design Partners",
    heroHeadline: "The engineering truth layer for AI-native teams",
    heroSupport:
      "Know what is verified, what is risky, and the evidence — before you ship.",
    ctaTalk: "Talk to us",
    ctaPartner: "Start Design Partner",
    ctaProduct: "Open the product",
    problemTitle: "The problem",
    problemBody:
      "Teams run Cursor, CI, scanners, and LLMs — yet none reliably answer: what is actually true about this software right now?",
    solutionTitle: "The solution",
    solutionBody:
      "Atlas builds a live Evidence Graph: code → tests → infra → deploys → decisions → risks → readiness. Editors stay put; Atlas owns truth, QA, and governance.",
    flowTitle: "Core flow",
    flow:
      "DISCOVER → RECONCILE → CLAIMS → EVIDENCE → RISK → QA → SECURITY → COUNCIL → GATES → VERDICT",
    productVisualTitle: "Product shape",
    productVisualBody:
      "A live Evidence Graph: distinct CODE · TESTS · SECURITY · DEPLOYMENT — never silently merged into one blob.",
    moatTitle: "The moat",
    moatBody:
      "Not the LLM. Evidence Graph + historical engineering memory — with epistemic labels and INSUFFICIENT_EVIDENCE over hallucination.",
    partnerTitle: "Design Partner",
    partnerBody:
      "One Engineering Readiness Audit on a production repo. Measure unknown risks, blockers, and time saved — then a case study.",
    partnerCta: "Open playbook",
    contactTitle: "Contact",
    contactBody: "Investors and partners — leave details. We follow up with a demo and model.",
    name: "Name",
    email: "Email",
    company: "Company",
    role: "Role",
    message: "Message",
    send: "Send",
    thanks: "Message received. Thank you.",
    footer: "For investors & partners",
  },
  ar: {
    product: "المنتج",
    partners: "Design Partners",
    heroHeadline: "طبقة الحقيقة الهندسية لفرق الذكاء الاصطناعي",
    heroSupport:
      "اعرف ما هو موثّق، وما هو خطر، وما الدليل — قبل الإطلاق للإنتاج.",
    ctaTalk: "تواصل معنا",
    ctaPartner: "ابدأ Design Partner",
    ctaProduct: "افتح المنتج",
    problemTitle: "المشكلة",
    problemBody:
      "الفرق تستخدم Cursor وCI وماسحات وLLMs — ولا أحد يجيب بموثوقية: ما الحقيقة الفعلية عن هذا البرنامج الآن؟",
    solutionTitle: "الحل",
    solutionBody:
      "يبني Atlas رسم أدلة حيّاً: شيفرة → اختبارات → بنية → نشر → قرارات → مخاطر → جاهزية. المحررات تبقى مكانها؛ Atlas يملك الحقيقة وQA والحوكمة.",
    flowTitle: "التدفق الأساسي",
    flow:
      "DISCOVER → RECONCILE → CLAIMS → EVIDENCE → RISK → QA → SECURITY → COUNCIL → GATES → VERDICT",
    productVisualTitle: "شكل المنتج",
    productVisualBody:
      "رسم أدلة حيّ: فئات منفصلة (شيفرة · اختبارات · أمن · نشر) — دون دمج صامت في كتلة واحدة.",
    moatTitle: "الخندق",
    moatBody:
      "ليس الـ LLM. رسم الأدلة + الذاكرة الهندسية التاريخية — مع تسميات معرفية وتفضيل INSUFFICIENT_EVIDENCE على الهلوسة.",
    partnerTitle: "Design Partner",
    partnerBody:
      "تدقيق جاهزية هندسية على مستودع إنتاج واحد. نقيس مخاطر مجهولة وعوائق ووقتاً موفّراً — ثم دراسة حالة.",
    partnerCta: "افتح الدليل",
    contactTitle: "تواصل",
    contactBody: "مستثمرون وشركاء — اتركوا التفاصيل. نعود بعرض توضيحي ونموذج.",
    name: "الاسم",
    email: "البريد",
    company: "الشركة",
    role: "الدور",
    message: "الرسالة",
    send: "إرسال",
    thanks: "وصلت الرسالة. شكراً.",
    footer: "للمستثمرين والشركاء",
  },
} as const;

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    color: "#F4F7F5",
    bgcolor: "rgba(255,255,255,0.06)",
    "& fieldset": { borderColor: "rgba(244,247,245,0.25)" },
  },
  "& .MuiInputLabel-root": { color: "rgba(244,247,245,0.7)" },
} as const;

export default function InvestorsPage() {
  const [lang, setLang] = useState<"he" | "en" | "ar">("he");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [message, setMessage] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);

  const t = copy[lang];
  const dir = lang === "en" ? "ltr" : "rtl";
  const productHref = lang === "en" ? "/en" : lang === "ar" ? "/ar" : "/he";

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

  const sectionPad = useMemo(
    () => ({ px: { xs: 2, md: 6 }, py: { xs: 7, md: 11 } }),
    [],
  );

  return (
    <Box
      dir={dir}
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
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
          },
        }}
      >
        <Typography
          component="p"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontWeight: 700,
            fontSize: "1.35rem",
            letterSpacing: "-0.03em",
          }}
        >
          ArletOS
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant={lang === "he" ? "contained" : "outlined"}
            color="secondary"
            onClick={() => setLang("he")}
            aria-pressed={lang === "he"}
          >
            עב
          </Button>
          <Button
            size="small"
            variant={lang === "en" ? "contained" : "outlined"}
            color="secondary"
            onClick={() => setLang("en")}
            aria-pressed={lang === "en"}
          >
            EN
          </Button>
          <Button
            size="small"
            variant={lang === "ar" ? "contained" : "outlined"}
            color="secondary"
            onClick={() => setLang("ar")}
            aria-pressed={lang === "ar"}
          >
            ع
          </Button>
          <Button
            component={Link}
            href={`${productHref}/partners`}
            size="small"
            sx={{ color: "#F4F7F5" }}
          >
            {t.partners}
          </Button>
          <Button component={Link} href={productHref} size="small" sx={{ color: "#F4F7F5" }}>
            {t.product}
          </Button>
        </Stack>
      </Box>

      {/* Hero — brand + one headline + one support + CTAs + full-bleed atmosphere */}
      <Box
        component="section"
        aria-label="Hero"
        sx={{
          minHeight: { xs: "85vh", md: "92vh" },
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          px: { xs: 2, md: 6 },
          pb: { xs: 7, md: 12 },
          pt: { xs: 10, md: 6 },
          position: "relative",
          overflow: "hidden",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 80% 55% at 70% 35%, rgba(196,92,38,0.35), transparent 60%), radial-gradient(circle at 20% 70%, rgba(15,61,62,0.5), transparent 45%)",
            animation: "pulseGlow 8s ease-in-out infinite alternate",
            "@keyframes pulseGlow": {
              from: { opacity: 0.65, transform: "scale(1)" },
              to: { opacity: 1, transform: "scale(1.04)" },
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
          },
          "&::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, transparent 30%, rgba(8,20,21,0.82) 100%)",
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
              fontSize: { xs: "clamp(2.8rem, 11vw, 5rem)", md: "5rem" },
              lineHeight: 0.92,
              letterSpacing: "-0.04em",
              mb: 2.5,
              animation: "rise 900ms ease both",
              "@keyframes rise": {
                from: { opacity: 0, transform: "translateY(28px)" },
                to: { opacity: 1, transform: "translateY(0)" },
              },
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }}
          >
            ArletOS
          </Typography>
          <Typography
            component="h1"
            sx={{
              fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
              fontWeight: 650,
              fontSize: { xs: "1.45rem", md: "1.85rem" },
              lineHeight: 1.25,
              maxWidth: 560,
              mb: 2,
              animation: "rise 900ms ease both",
              animationDelay: "100ms",
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }}
          >
            {t.heroHeadline}
          </Typography>
          <Typography
            sx={{
              maxWidth: 480,
              mb: 4,
              fontSize: { xs: "1.05rem", md: "1.15rem" },
              color: "rgba(244,247,245,0.82)",
              animation: "rise 900ms ease both",
              animationDelay: "180ms",
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }}
          >
            {t.heroSupport}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{
              animation: "rise 900ms ease both",
              animationDelay: "260ms",
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }}
          >
            <Button
              href="#contact"
              variant="contained"
              color="secondary"
              size="large"
              sx={{ minHeight: 48 }}
            >
              {t.ctaTalk}
            </Button>
            <Button
              component={Link}
              href={`${productHref}/partners`}
              variant="outlined"
              size="large"
              sx={{
                minHeight: 48,
                borderColor: "rgba(244,247,245,0.45)",
                color: "#F4F7F5",
              }}
            >
              {t.ctaPartner}
            </Button>
            <Button
              component={Link}
              href={productHref}
              variant="text"
              size="large"
              sx={{ minHeight: 48, color: "rgba(244,247,245,0.9)" }}
            >
              {t.ctaProduct}
            </Button>
          </Stack>
        </Box>
      </Box>

      <Box component="section" sx={{ ...sectionPad, borderTop: "1px solid rgba(244,247,245,0.12)" }}>
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {t.problemTitle}
        </Typography>
        <Typography sx={{ maxWidth: 640, color: "rgba(244,247,245,0.8)", lineHeight: 1.7, fontSize: "1.1rem" }}>
          {t.problemBody}
        </Typography>
      </Box>

      <Box component="section" sx={{ ...sectionPad, background: "rgba(0,0,0,0.22)" }}>
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {t.solutionTitle}
        </Typography>
        <Typography sx={{ maxWidth: 680, color: "rgba(244,247,245,0.8)", lineHeight: 1.7, fontSize: "1.1rem", mb: 4 }}>
          {t.solutionBody}
        </Typography>
        <Typography
          component="h3"
          sx={{ fontWeight: 650, mb: 1.5, letterSpacing: "0.02em" }}
        >
          {t.flowTitle}
        </Typography>
        <Typography
          sx={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: { xs: "0.78rem", md: "0.95rem" },
            color: "rgba(244,247,245,0.88)",
            lineHeight: 1.8,
            maxWidth: 900,
            whiteSpace: { xs: "normal", md: "pre-wrap" },
          }}
        >
          {t.flow}
        </Typography>
      </Box>

      <Box
        component="section"
        aria-labelledby="product-visual-heading"
        sx={{
          ...sectionPad,
          borderTop: "1px solid rgba(244,247,245,0.08)",
        }}
      >
        <Typography
          id="product-visual-heading"
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {t.productVisualTitle}
        </Typography>
        <Typography
          sx={{
            maxWidth: 640,
            color: "rgba(244,247,245,0.8)",
            lineHeight: 1.7,
            fontSize: "1.1rem",
            mb: 4,
          }}
        >
          {t.productVisualBody}
        </Typography>
        <Box
          component="svg"
          role="img"
          aria-label="Evidence Graph: Code, Tests, Security, Deployment → Verdict"
          viewBox="0 0 720 220"
          sx={{
            width: "100%",
            maxWidth: 720,
            height: "auto",
            display: "block",
            animation: "graphFade 1.1s ease both",
            "@keyframes graphFade": {
              from: { opacity: 0, transform: "translateY(12px)" },
              to: { opacity: 1, transform: "translateY(0)" },
            },
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
            },
          }}
        >
          <defs>
            <linearGradient id="egStroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#C45C26" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#F4F7F5" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          {[
            { x: 40, y: 40, label: "CODE" },
            { x: 200, y: 40, label: "TESTS" },
            { x: 360, y: 40, label: "SECURITY" },
            { x: 520, y: 40, label: "DEPLOY" },
          ].map((n) => (
            <g key={n.label}>
              <rect
                x={n.x}
                y={n.y}
                width={120}
                height={48}
                rx={2}
                fill="rgba(244,247,245,0.06)"
                stroke="url(#egStroke)"
                strokeWidth={1.5}
              />
              <text
                x={n.x + 60}
                y={n.y + 30}
                textAnchor="middle"
                fill="#F4F7F5"
                fontFamily="ui-monospace, Menlo, monospace"
                fontSize="13"
              >
                {n.label}
              </text>
            </g>
          ))}
          <path
            d="M100 88 L100 130 L360 130 L360 150"
            fill="none"
            stroke="rgba(196,92,38,0.65)"
            strokeWidth={2}
          />
          <path
            d="M260 88 L260 130"
            fill="none"
            stroke="rgba(244,247,245,0.35)"
            strokeWidth={1.5}
          />
          <path
            d="M420 88 L420 130"
            fill="none"
            stroke="rgba(244,247,245,0.35)"
            strokeWidth={1.5}
          />
          <path
            d="M580 88 L580 130 L360 130"
            fill="none"
            stroke="rgba(244,247,245,0.35)"
            strokeWidth={1.5}
          />
          <rect
            x={260}
            y={150}
            width={200}
            height={52}
            rx={2}
            fill="rgba(196,92,38,0.22)"
            stroke="#C45C26"
            strokeWidth={1.75}
          />
          <text
            x={360}
            y={182}
            textAnchor="middle"
            fill="#F4F7F5"
            fontFamily='"Fraunces", Georgia, serif'
            fontSize="16"
            fontWeight="700"
          >
            VERDICT
          </text>
        </Box>
      </Box>

      <Box component="section" sx={sectionPad}>
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {t.moatTitle}
        </Typography>
        <Typography sx={{ maxWidth: 640, color: "rgba(244,247,245,0.8)", lineHeight: 1.7, fontSize: "1.1rem" }}>
          {t.moatBody}
        </Typography>
      </Box>

      <Box
        component="section"
        sx={{
          ...sectionPad,
          background:
            "linear-gradient(120deg, rgba(196,92,38,0.18), transparent 55%), rgba(0,0,0,0.18)",
        }}
      >
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 2,
          }}
        >
          {t.partnerTitle}
        </Typography>
        <Typography sx={{ maxWidth: 640, color: "rgba(244,247,245,0.8)", lineHeight: 1.7, fontSize: "1.1rem", mb: 3 }}>
          {t.partnerBody}
        </Typography>
        <Button
          component={Link}
          href={`${productHref}/partners`}
          variant="contained"
          color="secondary"
          size="large"
          sx={{ minHeight: 48 }}
        >
          {t.partnerCta}
        </Button>
      </Box>

      <Box id="contact" component="section" sx={{ ...sectionPad, maxWidth: 640 }}>
        <Typography
          component="h2"
          sx={{
            fontFamily: '"Fraunces", "Frank Ruhl Libre", serif',
            fontSize: "1.75rem",
            fontWeight: 700,
            mb: 1,
          }}
        >
          {t.contactTitle}
        </Typography>
        <Typography sx={{ mb: 3, color: "rgba(244,247,245,0.75)" }}>
          {t.contactBody}
        </Typography>

        {sentId ? (
          <Alert severity="success">{t.thanks}</Alert>
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
              label={t.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              sx={fieldSx}
            />
            <TextField
              required
              type="email"
              label={t.email}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              sx={fieldSx}
            />
            <TextField
              label={t.company}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              fullWidth
              sx={fieldSx}
            />
            <TextField
              label={t.role}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              fullWidth
              sx={fieldSx}
            />
            <TextField
              required
              multiline
              minRows={4}
              label={t.message}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              fullWidth
              sx={fieldSx}
            />
            <Button
              type="submit"
              variant="contained"
              color="secondary"
              size="large"
              disabled={contact.isPending}
              sx={{ alignSelf: "flex-start", minHeight: 48 }}
            >
              {t.send}
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
        Atlas Core · ArletOS · {t.footer} ·{" "}
        <Link href={productHref} style={{ color: "inherit" }}>
          app
        </Link>
      </Box>
    </Box>
  );
}
