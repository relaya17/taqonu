import { notFound, redirect } from "next/navigation";

/** Legacy catch-all aliases → real product surfaces (no more coming-soon stubs). */
const SECTION_REDIRECTS: Record<string, string> = {
  roadmap: "/",
  github: "/integrations",
  research: "/legal-media",
  knowledge: "/memory",
  activity: "/ops/metrics",
  security: "/health",
};

export default async function SectionRedirectPage({
  params,
}: {
  params: Promise<{ section: string; locale: string }>;
}) {
  const { section, locale } = await params;
  const target = SECTION_REDIRECTS[section];
  if (!target) {
    notFound();
  }
  const path = target === "/" ? `/${locale}` : `/${locale}${target}`;
  redirect(path);
}
