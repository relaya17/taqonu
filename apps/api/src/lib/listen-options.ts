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
