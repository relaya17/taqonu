import { redirect } from "next/navigation";

/** Public marketing alias → localized product landing. */
export default function MarketingAliasPage() {
  redirect("/he/welcome");
}
