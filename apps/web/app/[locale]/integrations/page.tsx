"use client";

import { HubRedirect } from "@/components/layout/HubRedirect";

/** Moved into a view of `/settings`; this route keeps old links working. */
export default function IntegrationsPage() {
  return <HubRedirect to="/settings" view="integrations" />;
}
