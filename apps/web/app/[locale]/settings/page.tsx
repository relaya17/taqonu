"use client";

import { useTranslations } from "next-intl";
import { ViewHub } from "@/components/layout/ViewHub";
import { SettingsView } from "@/components/views/SettingsView";
import { PlanView } from "@/components/views/PlanView";
import { IntegrationsView } from "@/components/views/IntegrationsView";
import { PartnersView } from "@/components/views/PartnersView";

export default function SettingsPage() {
  const nav = useTranslations("nav");
  const hub = useTranslations("hub");
  return (
    <ViewHub
      ariaLabel={nav("settings")}
      views={[
        { id: "account", label: nav("settings"), render: () => <SettingsView /> },
        { id: "plan", label: hub("plan"), render: () => <PlanView /> },
        { id: "integrations", label: nav("integrations"), render: () => <IntegrationsView /> },
        { id: "partners", label: nav("partners"), render: () => <PartnersView /> },
      ]}
    />
  );
}
