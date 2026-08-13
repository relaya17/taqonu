"use client";

import { useEffect, useState } from "react";
import { Box, Tab, Tabs, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { MemoryPanel } from "@/app/[locale]/memory/page";
import { DecisionsPanel } from "@/app/[locale]/decisions/page";
import { PatchesPanel } from "@/app/[locale]/patches/page";

export type DeskTab = "memory" | "decisions" | "patches";

const TABS: DeskTab[] = ["memory", "decisions", "patches"];

function isDeskTab(value: string | null): value is DeskTab {
  return value === "memory" || value === "decisions" || value === "patches";
}

/** Personal area on the user dashboard: memory · decisions · patches. */
export function PersonalDesk({
  initialTab = "memory",
}: {
  initialTab?: DeskTab;
}) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("desk");
  const [tab, setTab] = useState<DeskTab>(
    isDeskTab(fromUrl) ? fromUrl : initialTab,
  );

  useEffect(() => {
    if (isDeskTab(fromUrl) && fromUrl !== tab) {
      setTab(fromUrl);
    }
  }, [fromUrl, tab]);

  const selectTab = (next: DeskTab) => {
    setTab(next);
    router.replace(`${pathname}?desk=${next}`);
  };

  return (
    <Box
      sx={{
        py: 3,
        borderTop: "1px solid rgba(26,31,42,0.14)",
      }}
    >
      <Typography fontWeight={700} sx={{ fontSize: "1.2rem" }}>
        {t("personalTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5 }}>
        {t("personalHelp")}
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, v: DeskTab) => selectTab(v)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
      >
        {TABS.map((id) => (
          <Tab key={id} value={id} label={t(`personalTab.${id}`)} />
        ))}
      </Tabs>
      {tab === "memory" ? <MemoryPanel embedded /> : null}
      {tab === "decisions" ? <DecisionsPanel embedded /> : null}
      {tab === "patches" ? <PatchesPanel embedded /> : null}
    </Box>
  );
}
