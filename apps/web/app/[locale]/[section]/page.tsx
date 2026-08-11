"use client";

import { Stack, Typography } from "@mui/material";
import { useParams, notFound } from "next/navigation";
import { useTranslations } from "next-intl";

const SECTIONS = new Set([
  "roadmap",
  "github",
  "research",
  "knowledge",
  "activity",
  "security",
]);

export default function SectionPage() {
  const t = useTranslations("section");
  const params = useParams<{ section: string }>();
  const section = params.section;

  if (!section || !SECTIONS.has(section)) {
    notFound();
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h1" sx={{ fontSize: "2.2rem" }}>
        {t(`titles.${section}` as "titles.settings")}
      </Typography>
      <Typography color="text.secondary">{t("comingSoon")}</Typography>
    </Stack>
  );
}
