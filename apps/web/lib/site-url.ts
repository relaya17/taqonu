/** Public origin for canonical / Open Graph / sitemap. */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export function absoluteUrl(path: string): string {
  const prefix = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${prefix}`;
}
