import { redirect } from "next/navigation";

/** Public entry — always open cinematic promo landing first. */
export default function RootPage() {
  redirect("/he/welcome");
}
