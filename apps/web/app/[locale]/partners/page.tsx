"use client";

import { HubRedirect } from "@/components/layout/HubRedirect";

/** Moved into a view of `/settings`; this route keeps old links working. */
export default function PartnersPage() {
  return <HubRedirect to="/settings" view="partners" />;
}
