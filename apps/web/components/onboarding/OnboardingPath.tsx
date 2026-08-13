"use client";

import { Alert, Button, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

/** Shared “link folder → Workbench → E2E” onboarding path. */
export function OnboardingPath({
  missingRootCount = 0,
}: {
  missingRootCount?: number;
}) {
  const t = useTranslations("onboarding");

  return (
    <Alert
      severity={missingRootCount > 0 ? "warning" : "info"}
      sx={{ alignItems: "flex-start" }}
    >
      <Typography fontWeight={650} sx={{ mb: 0.5 }}>
        {t("title")}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {missingRootCount > 0
          ? t("bodyMissing", { count: missingRootCount })
          : t("body")}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button component={Link} href="/projects" size="small" variant="contained">
          {t("stepProjects")}
        </Button>
        <Button component={Link} href="/workbench" size="small" variant="outlined">
          {t("stepWorkbench")}
        </Button>
        <Button
          component={Link}
          href="/process-audit"
          size="small"
          variant="outlined"
        >
          {t("stepE2e")}
        </Button>
      </Stack>
    </Alert>
  );
}
