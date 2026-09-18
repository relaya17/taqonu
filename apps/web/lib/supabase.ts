import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { allowlistedAuditNext } from "@/lib/audit-return-path";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || key === "replace-me") {
    return null;
  }
  if (!browserClient) {
    browserClient = createClient(url, key, {
      auth: {
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return browserClient;
}

export function oauthRedirectTo(
  locale: string,
  next?: string | null,
): string {
  const origin =
    typeof window === "undefined"
      ? "http://localhost:3000"
      : window.location.origin;
  const base = `${origin}/${locale}/auth/callback`;
  const allowed = allowlistedAuditNext(next);
  return allowed ? `${base}?next=${encodeURIComponent(allowed)}` : base;
}
