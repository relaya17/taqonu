"use client";

import { StudioSurfaceRedirect } from "@/components/studio/StudioSurfaceRedirect";

/** Lives in Studio Checks now; this route keeps old links working. */
export default function LegalMediaPage() {
  return <StudioSurfaceRedirect tab="checks" check="legal" />;
}
