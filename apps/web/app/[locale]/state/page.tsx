import { redirect } from "next/navigation";

/** Legacy orphan surface → Projects (per-project state lives under /projects/:id/state). */
export default async function StateRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/projects`);
}
