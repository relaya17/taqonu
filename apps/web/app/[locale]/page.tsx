"use client";

import { useTranslations } from "next-intl";
import { ViewHub } from "@/components/layout/ViewHub";
import { DashboardView } from "@/components/views/DashboardView";
import { ProjectsView } from "@/components/views/ProjectsView";
import { SystemsView } from "@/components/views/SystemsView";

export default function DashboardPage() {
  const nav = useTranslations("nav");
  const hub = useTranslations("hub");
  return (
    <ViewHub
      ariaLabel={nav("dashboard")}
      views={[
        { id: "overview", label: hub("overview"), render: () => <DashboardView /> },
        { id: "projects", label: nav("projects"), render: () => <ProjectsView /> },
        { id: "systems", label: nav("systems"), render: () => <SystemsView /> },
      ]}
    />
  );
}
