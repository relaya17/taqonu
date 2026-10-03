"use client";

import { HubRedirect } from "@/components/layout/HubRedirect";

/** Moved into a view of `/agents`; this route keeps old links working. */
export default function ArtifactsPage() {
  return <HubRedirect to="/agents" view="artifacts" />;
}
