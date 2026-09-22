/**
 * Local API port. `API_PORT` is the only local override.
 * A parent-shell `PORT` (Next/Vercel leftovers) must not steal 4000 —
 * Vercel still uses `PORT` because that platform sets it as the listen port.
 */
export function resolveApiListenPort(fallback = 4000): number {
  const apiPort = process.env.API_PORT?.trim();
  const vercelPort =
    process.env.VERCEL || process.env.VERCEL_ENV
      ? process.env.PORT?.trim()
      : undefined;
  const raw = apiPort || vercelPort;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

/**
 * Local API bind. Vercel does not use this path.
 * When HOST is set (private-plane start uses 127.0.0.1), honor it.
 * When unset, dual-stack so Windows Chrome `localhost` (::1) still works.
 */
export function apiListenOptions(
  port: number,
  host = process.env["HOST"]?.trim() ?? "",
): { readonly port: number; readonly host: string } | { readonly port: number; readonly ipv6Only: false } {
  if (host.length > 0) {
    return { port, host };
  }
  return { port, ipv6Only: false };
}
