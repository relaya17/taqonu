/** Loopback hosts treated as equivalent for local CORS (localhost ↔ 127.0.0.1). */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** Atlas product (3000), Sentinel (3100), Owner Admin (3200). */
const ATLAS_DEV_SURFACE_PORTS = new Set(["3000", "3100", "3200"]);

/**
 * Allow the configured WEB_ORIGIN plus local loopback host aliases on the same
 * port/protocol — fixes empty client screens when the app is opened via
 * http://127.0.0.1:3000 while WEB_ORIGIN is http://localhost:3000.
 */
export function isAllowedWebOrigin(
  requestOrigin: string | undefined,
  webOrigin: string,
): boolean {
  if (!requestOrigin) return true;
  if (requestOrigin === webOrigin) return true;

  try {
    const allowed = new URL(webOrigin);
    const incoming = new URL(requestOrigin);
    if (
      LOOPBACK.has(allowed.hostname) &&
      LOOPBACK.has(incoming.hostname) &&
      allowed.protocol === incoming.protocol
    ) {
      if (allowed.port === incoming.port) return true;
      const incomingPort =
        incoming.port || (incoming.protocol === "https:" ? "443" : "80");
      if (ATLAS_DEV_SURFACE_PORTS.has(incomingPort)) return true;
    }
  } catch {
    return false;
  }
  return false;
}
