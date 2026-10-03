"use client";

import { HubRedirect } from "@/components/layout/HubRedirect";

/** Moved into a view of `/`; this route keeps old links working. */
export default function ProjectsPage() {
  return <HubRedirect to="/" view="projects" />;
}
