import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { getSiteUrl } from "@/lib/site-url";

const LOCALES = routing.locales;
const PATHS = [
  "/",
  "/welcome",
  "/plan",
  "/partners",
  "/systems",
  "/legal-media",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const now = new Date();

  return PATHS.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: `${base}/${locale}${path === "/" ? "" : path}`,
      lastModified: now,
      changeFrequency: path === "/welcome" || path === "/" ? "weekly" : "monthly",
      priority: path === "/welcome" || path === "/" ? 1 : 0.7,
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((l) => [l, `${base}/${l}${path === "/" ? "" : path}`]),
        ),
      },
    })),
  );
}
