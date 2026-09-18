/** Allowlisted post-auth return destinations for the Partners/Experts audit door. */

export const ALLOWED_AUDIT_NEXT = ["/partners", "/experts"] as const;
export type AllowedAuditNext = (typeof ALLOWED_AUDIT_NEXT)[number];

export function allowlistedAuditNext(
  next: string | null | undefined,
): AllowedAuditNext | null {
  if (next === "/partners" || next === "/experts") return next;
  return null;
}

/** Locale-prefixed destination, or null so callers fall back to Studio. */
export function auditReturnPath(
  locale: string,
  next: string | null | undefined,
): string | null {
  const allowed = allowlistedAuditNext(next);
  return allowed ? `/${locale}${allowed}` : null;
}

export function authHrefWithNext(
  pathname: string,
  next: string | null | undefined,
): string {
  const allowed = allowlistedAuditNext(next);
  if (!allowed) return pathname;
  const sep = pathname.includes("?") ? "&" : "?";
  return `${pathname}${sep}next=${allowed}`;
}

export function inputDirForLocale(locale: string): "rtl" | "ltr" {
  return locale === "he" || locale === "ar" ? "rtl" : "ltr";
}
