import { redirect } from "next/navigation";

/** Legacy single-agent page → Specialists fabric. */
export default async function AgentRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/agents`);
}
