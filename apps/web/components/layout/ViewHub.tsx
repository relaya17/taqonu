"use client";

import type { ReactNode } from "react";
import { Box, Tab, Tabs } from "@mui/material";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/routing";

export interface HubView {
  readonly id: string;
  readonly label: string;
  readonly render: () => ReactNode;
}

/**
 * One destination, several views (like an editor's tabs): `?view=` selects the
 * view, the first one is the default. Other query params (e.g. `project`) are
 * kept, so links into a view behave exactly like the old standalone pages.
 */
export function ViewHub({
  views,
  ariaLabel,
}: {
  readonly views: readonly HubView[];
  readonly ariaLabel: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("view");
  const active = views.find((view) => view.id === requested) ?? views[0]!;

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === views[0]!.id) next.delete("view");
    else next.set("view", id);
    const query = next.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`);
  };

  return (
    <Box sx={{ minWidth: 0 }}>
      <Tabs
        value={active.id}
        onChange={(_, id: string) => select(id)}
        aria-label={ariaLabel}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 2.5,
          minHeight: 42,
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTab-root": { minHeight: 42, textTransform: "none", fontSize: 14 },
        }}
      >
        {views.map((view) => (
          <Tab key={view.id} value={view.id} label={view.label} />
        ))}
      </Tabs>
      {active.render()}
    </Box>
  );
}
