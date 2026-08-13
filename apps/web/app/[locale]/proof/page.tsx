import { redirect } from "next/navigation";

/** Legacy proof page → Readiness certificate surface. */
export default async function ProofRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/readiness`);
}
