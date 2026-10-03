"use client";

import { StudioSurfaceRedirect } from "@/components/studio/StudioSurfaceRedirect";

/** Lives in Studio Checks now; this route keeps old links working. */
export default function GatesPage() {
  return <StudioSurfaceRedirect tab="checks" check="gates" />;
}
