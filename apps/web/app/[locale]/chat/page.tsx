import { redirect } from "next/navigation";

/** Legacy orphan chat → Workbench agent panel. */
export default async function ChatRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/workbench`);
}
