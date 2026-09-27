import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["he", "en", "ar", "fr"],
  defaultLocale: "he",
  localePrefix: "always",
});

export type AppLocale = (typeof routing.locales)[number];

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return !!value && (routing.locales as readonly string[]).includes(value);
}

export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
