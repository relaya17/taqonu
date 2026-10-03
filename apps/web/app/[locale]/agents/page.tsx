"use client";

import { useTranslations } from "next-intl";
import { ViewHub } from "@/components/layout/ViewHub";
import { AgentsView } from "@/components/views/AgentsView";
import { ExpertsView } from "@/components/views/ExpertsView";
import { ModelsView } from "@/components/views/ModelsView";
import { ArtifactsView } from "@/components/views/ArtifactsView";

export default function AgentsPage() {
  const nav = useTranslations("nav");
  const hub = useTranslations("hub");
  return (
    <ViewHub
      ariaLabel={nav("agents")}
      views={[
        { id: "agents", label: nav("agents"), render: () => <AgentsView /> },
        { id: "experts", label: nav("experts"), render: () => <ExpertsView /> },
        { id: "models", label: nav("models"), render: () => <ModelsView /> },
        { id: "artifacts", label: hub("artifacts"), render: () => <ArtifactsView /> },
      ]}
    />
  );
}
