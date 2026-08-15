"use client";

import { Alert, Box, Button, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ResponsiveActions } from "@/components/layout/ResponsiveActions";

function StepLabel({ n, label }: { n: number; label: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.75,
      }}
    >
      <Box component="span" dir="ltr" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {n}.
      </Box>
      <Box component="span">{label}</Box>
    </Box>
  );
}

/** Shared “link folder → Workbench → E2E” onboarding path. */
export function OnboardingPath({
  missingRootCount = 0,
}: {
  missingRootCount?: number;
}) {
  const t = useTranslations("onboarding");

  return (
    <Alert severity={missingRootCount > 0 ? "warning" : "info"}>
      <Typography fontWeight={650} sx={{ mb: 0.5 }}>
        {t("title")}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.25 }}>
        {missingRootCount > 0
          ? t("bodyMissing", { count: missingRootCount })
          : t("body")}
      </Typography>
      <ResponsiveActions compact>
        <Button component={Link} href="/projects" size="small" variant="contained">
          <StepLabel n={1} label={t("stepProjects")} />
        </Button>
        <Button component={Link} href="/workbench" size="small" variant="outlined">
          <StepLabel n={2} label={t("stepWorkbench")} />
        </Button>
        <Button
          component={Link}
          href="/process-audit"
          size="small"
          variant="outlined"
        >
          <StepLabel n={3} label={t("stepE2e")} />
        </Button>
      </ResponsiveActions>
    </Alert>
  );
}
